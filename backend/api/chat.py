import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.chat_log import ChatLog
from backend.models.user import User
from backend.schemas.chat import ChatRequest, ChatMessageResponse
from backend.services import chat_service, permission_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/notebooks/{notebook_id}/chat', tags=['chat'])


async def _disconnect_aware_stream(request: Request, generator):
    """Wrap an SSE generator so that client disconnect cancels the LLM call.

    Every 5s checks request.is_disconnected() while waiting for the next chunk.
    When the client disconnects, cancels the pending LLM task and closes the
    generator to trigger cleanup (including response.close() in qwen_client).
    """
    it = generator.__aiter__()
    try:
        while True:
            # Wrap __anext__ in a task so we can poll disconnect alongside it
            chunk_task = asyncio.ensure_future(it.__anext__())
            while not chunk_task.done():
                done, _ = await asyncio.wait({chunk_task}, timeout=5.0)
                if done:
                    break
                if await request.is_disconnected():
                    logger.info("Client disconnected during SSE stream, cancelling LLM task")
                    chunk_task.cancel()
                    try:
                        await chunk_task
                    except (asyncio.CancelledError, StopAsyncIteration):
                        pass
                    return
            try:
                yield chunk_task.result()
            except StopAsyncIteration:
                return
    except asyncio.CancelledError:
        logger.info("SSE stream task cancelled (client disconnect)")
    finally:
        try:
            await generator.aclose()
        except RuntimeError:
            pass  # generator already running/closed


@router.post('')
async def chat(
    notebook_id: str,
    req: ChatRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'chat'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    generator = chat_service.stream_chat(
        db=db,
        notebook_id=uuid.UUID(notebook_id),
        user_id=user.id,
        message=req.message,
        source_ids=req.source_ids,
        web_search=req.web_search,
        deep_thinking=req.deep_thinking,
    )

    return StreamingResponse(
        _disconnect_aware_stream(request, generator),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


@router.get('/history', response_model=list[ChatMessageResponse])
async def get_history(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    messages = await chat_service.get_chat_history(db, uuid.UUID(notebook_id), user.id)
    return [
        ChatMessageResponse(
            id=str(m.id),
            notebook_id=str(m.notebook_id),
            user_id=str(m.user_id),
            role=m.role,
            content=m.content,
            citations=m.citations or [],
            created_at=m.created_at,
        )
        for m in messages
    ]


@router.delete('/history')
async def clear_history(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    await chat_service.clear_chat_history(db, uuid.UUID(notebook_id), user.id)
    return {'data': {'message': 'Chat history cleared'}}


class FeedbackRequest(BaseModel):
    message_id: str
    vote: str  # "up", "down", or "none"
    comment: str | None = None  # user-provided correct answer


@router.post('/feedback')
async def submit_feedback(
    notebook_id: str,
    req: FeedbackRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit thumbs up/down feedback for a chat message."""
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    msg_uuid = uuid.UUID(req.message_id)
    feedback_value = req.vote if req.vote in ("up", "down") else None

    # Find ChatLog by message_id
    result = await db.execute(
        select(ChatLog).where(ChatLog.message_id == msg_uuid)
    )
    log = result.scalar_one_or_none()
    if log:
        log.feedback = feedback_value
        if req.comment is not None:
            log.feedback_comment = req.comment
        await db.commit()
    return {'data': {'ok': True}}
