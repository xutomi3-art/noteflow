import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.user import User
from backend.schemas.chat import ChatRequest, ChatMessageResponse
from backend.services import chat_service, permission_service

router = APIRouter(prefix='/notebooks/{notebook_id}/chat', tags=['chat'])


@router.post('')
async def chat(
    notebook_id: str,
    req: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'chat'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    return StreamingResponse(
        chat_service.stream_chat(
            db=db,
            notebook_id=uuid.UUID(notebook_id),
            user_id=user.id,
            message=req.message,
            source_ids=req.source_ids,
            web_search=req.web_search,
        ),
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
