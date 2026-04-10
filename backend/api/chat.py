import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from openai import AsyncOpenAI

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.chat_log import ChatLog
from backend.models.chat_message import ChatMessage
from backend.models.llm_model import LlmModel
from backend.models.user import User
from backend.schemas.chat import ChatRequest, ChatMessageResponse
from backend.services import chat_service, permission_service
from backend.services.serper_client import web_search

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/notebooks/{notebook_id}/chat', tags=['chat'])


async def _disconnect_aware_stream(request: Request, generator):
    """Wrap an SSE generator so that client disconnect cancels the LLM call.

    Every 5s checks request.is_disconnected() while waiting for the next chunk.
    When the client disconnects, cancels the pending LLM task and closes the
    generator to trigger cleanup (including response.close() in llm_client).
    """
    it = generator.__aiter__()
    chunk_task: asyncio.Task | None = None
    try:
        while True:
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
                    chunk_task = None
                    return
            try:
                yield chunk_task.result()
            except StopAsyncIteration:
                chunk_task = None
                return
            chunk_task = None
    except asyncio.CancelledError:
        logger.info("SSE stream task cancelled (client disconnect)")
        # Cancel the in-flight chunk task first so generator stops running
        if chunk_task and not chunk_task.done():
            chunk_task.cancel()
            try:
                await chunk_task
            except (asyncio.CancelledError, StopAsyncIteration):
                pass
    finally:
        try:
            await generator.aclose()
            logger.info("SSE generator closed successfully")
        except RuntimeError:
            logger.warning("SSE generator aclose() failed — forcing cleanup")
            # Generator still running, force close the underlying LLM connection
            # by closing the httpx client's open response
            pass


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

    session_uuid = uuid.UUID(req.session_id) if req.session_id else None
    generator = chat_service.stream_chat(
        db=db,
        notebook_id=uuid.UUID(notebook_id),
        user_id=user.id,
        message=req.message,
        source_ids=req.source_ids,
        web_search=req.web_search,
        deep_thinking=req.deep_thinking,
        session_id=session_uuid,
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
    session_id: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    # Check if shared_chat is enabled
    from backend.models.notebook import Notebook
    nb = await db.get(Notebook, uuid.UUID(notebook_id))
    shared = nb.shared_chat if nb else False

    session_uuid = uuid.UUID(session_id) if session_id else None
    messages = await chat_service.get_chat_history(db, uuid.UUID(notebook_id), user.id, shared=shared, session_id=session_uuid)

    # In shared mode, resolve user names for attribution
    user_names: dict[str, str] = {}
    if shared:
        from backend.models.user import User as UserModel
        user_ids = {m.user_id for m in messages}
        for uid in user_ids:
            u = await db.get(UserModel, uid)
            if u:
                user_names[str(uid)] = u.name or u.email.split("@")[0]

    return [
        ChatMessageResponse(
            id=str(m.id),
            notebook_id=str(m.notebook_id),
            user_id=str(m.user_id),
            role=m.role,
            content=m.content,
            citations=m.citations or [],
            created_at=m.created_at,
            user_name=user_names.get(str(m.user_id), "") if shared else "",
            metadata=m.msg_metadata,
        )
        for m in messages
    ]


@router.delete('/history')
async def clear_history(
    notebook_id: str,
    session_id: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    session_uuid = uuid.UUID(session_id) if session_id else None
    await chat_service.clear_chat_history(db, uuid.UUID(notebook_id), user.id, session_id=session_uuid)
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


@router.get('/models')
async def list_chat_models(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List available LLM models for multi-model chat (no API keys exposed)."""
    result = await db.execute(
        select(LlmModel).where(LlmModel.enabled == True).order_by(LlmModel.sort_order)
    )
    return [
        {"id": str(m.id), "name": m.name, "provider": m.provider}
        for m in result.scalars().all()
    ]


# ── Multi-model chat (Just Chat) ──────────────────────────────────

async def _call_model(model: LlmModel, messages: list[dict]) -> dict:
    """Call a single LLM model and return its response.

    Supports three API formats:
    - OpenAI Chat Completions (default)
    - Anthropic Messages (provider=anthropic, kie.ai Claude)
    - OpenAI Responses API (provider=openai_resp, kie.ai GPT-5)
    """
    import httpx as _httpx

    try:
        if model.provider == "anthropic":
            # Anthropic Messages format (kie.ai /claude/v1/messages)
            async with _httpx.AsyncClient(timeout=60.0) as client:
                # Convert OpenAI messages to Anthropic format
                system_msg = ""
                anthropic_msgs = []
                for m in messages:
                    if m["role"] == "system":
                        system_msg = m["content"]
                    else:
                        anthropic_msgs.append({"role": m["role"], "content": m["content"]})
                body: dict = {
                    "model": model.model_id,
                    "messages": anthropic_msgs,
                    "max_tokens": 2048,
                }
                if system_msg:
                    body["system"] = system_msg
                resp = await client.post(
                    f"{model.base_url.rstrip('/')}/claude/v1/messages",
                    headers={
                        "Authorization": f"Bearer {model.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()
                # Anthropic response: content is array of blocks
                content_blocks = data.get("content", [])
                text = ""
                for block in content_blocks:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text += block.get("text", "")
                    elif isinstance(block, str):
                        text += block
                return {"model_name": model.name, "model_id": str(model.id), "content": text or None, "error": None}

        elif model.provider == "openai_resp":
            # OpenAI Responses API (kie.ai /codex/v1/responses) — input as string
            async with _httpx.AsyncClient(timeout=60.0) as client:
                # Combine messages into a single string prompt
                prompt_parts = []
                for m in messages:
                    if m["role"] == "system":
                        prompt_parts.append(f"[System] {m['content']}")
                    else:
                        prompt_parts.append(m["content"])
                prompt_str = "\n\n".join(prompt_parts)
                resp = await client.post(
                    f"{model.base_url.rstrip('/')}/codex/v1/responses",
                    headers={
                        "Authorization": f"Bearer {model.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model.model_id,
                        "input": prompt_str,
                        "stream": False,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                # Extract text from output — try multiple structures
                text = ""
                for item in data.get("output", []):
                    item_type = item.get("type", "")
                    if item_type == "message":
                        for block in item.get("content", []):
                            if block.get("type") == "output_text":
                                text += block.get("text", "")
                    elif item_type == "output_text":
                        text += item.get("text", "")
                if not text:
                    # Fallback: check top-level keys
                    text = data.get("output_text", "") or data.get("text", "")
                if not text:
                    logger.warning("GPT-5 response has no text. Keys: %s, output types: %s",
                                   list(data.keys())[:8],
                                   [i.get("type") for i in data.get("output", [])])
                return {"model_name": model.name, "model_id": str(model.id), "content": text or None, "error": None}

        else:
            # Standard OpenAI Chat Completions
            client = AsyncOpenAI(api_key=model.api_key, base_url=model.base_url, timeout=60.0)
            response = await client.chat.completions.create(
                model=model.model_id,
                messages=messages,
                max_tokens=2048,
                temperature=0.7,
            )
            return {"model_name": model.name, "model_id": str(model.id), "content": response.choices[0].message.content, "error": None}

    except Exception as e:
        return {"model_name": model.name, "model_id": str(model.id), "content": None, "error": str(e)[:200]}


@router.post('/multi')
async def chat_multi(
    notebook_id: str,
    req: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send message to multiple LLMs in parallel (for Just Chat multi-model comparison)."""
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'chat'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    # Get enabled models
    if req.model_ids:
        model_uuids = [uuid.UUID(mid) for mid in req.model_ids]
        result = await db.execute(
            select(LlmModel).where(LlmModel.id.in_(model_uuids), LlmModel.enabled == True)
            .order_by(LlmModel.sort_order)
        )
    else:
        result = await db.execute(
            select(LlmModel).where(LlmModel.enabled == True)
            .order_by(LlmModel.sort_order)
        )
    models = list(result.scalars().all())
    if not models:
        raise HTTPException(status_code=400, detail='No LLM models configured. Ask admin to add models.')

    # Save user message
    session_uuid = uuid.UUID(req.session_id) if req.session_id else None
    user_msg = ChatMessage(
        notebook_id=uuid.UUID(notebook_id),
        user_id=user.id,
        role="user",
        content=req.message,
        citations=[],
        session_id=session_uuid,
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    # Web search context (if enabled)
    search_context = ""
    if req.web_search:
        search_context = await web_search(req.message)

    # RAG retrieval from notebook sources
    source_context = ""
    try:
        from backend.models.source import Source
        from backend.services.ragflow_client import ragflow_client
        from backend.core.config import settings

        if req.source_ids:
            src_uuids = [uuid.UUID(sid) for sid in req.source_ids]
            src_result = await db.execute(
                select(Source).where(Source.id.in_(src_uuids), Source.status == "ready")
            )
        else:
            src_result = await db.execute(
                select(Source).where(Source.notebook_id == uuid.UUID(notebook_id), Source.status == "ready")
            )
        sources = list(src_result.scalars().all())

        if sources:
            dataset_ids = list(set(s.ragflow_dataset_id for s in sources if s.ragflow_dataset_id))
            if dataset_ids:
                chunks = await ragflow_client.retrieve(
                    dataset_ids, req.message, top_k=settings.RAG_TOP_K,
                )
                if chunks:
                    context_parts = []
                    for i, chunk in enumerate(chunks, 1):
                        text = chunk.get("content_with_weight", chunk.get("content", ""))
                        doc_name = chunk.get("document_keyword", chunk.get("docnm_kwd", "unknown"))
                        context_parts.append(f"[{i}] ({doc_name}): {text}")
                    source_context = "\n\n".join(context_parts)
    except Exception as e:
        logger.warning("RAG retrieval failed in multi-chat: %s", e)

    # Build messages
    system_content = "You are a helpful AI assistant."
    if source_context:
        system_content += f"\n\nUse the following document excerpts to answer the user's question. Cite sources using [1][2] etc:\n{source_context[:15000]}"
    if search_context:
        system_content += f"\n\nWeb search results:\n{search_context}"

    # Check for image attachments
    has_images = req.attachments and any(a.type.startswith("image/") for a in (req.attachments or []))

    # Build user message content
    if has_images:
        user_content: list[dict] = []
        for att in (req.attachments or []):
            if att.type.startswith("image/"):
                user_content.append({"type": "image_url", "image_url": {"url": f"data:{att.type};base64,{att.data}"}})
        user_content.append({"type": "text", "text": req.message})
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]
        # For non-vision models, use vision model to extract image description first
        image_description = ""
        try:
            from backend.services.llm_client import llm_client
            import tempfile, base64 as b64_mod
            for att in (req.attachments or []):
                if att.type.startswith("image/"):
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                        tmp.write(b64_mod.b64decode(att.data))
                        tmp_path = tmp.name
                    desc = await llm_client.analyze_image(tmp_path, att.name)
                    if desc:
                        image_description += f"\n[Image: {att.name}]\n{desc}\n"
                    import os
                    os.unlink(tmp_path)
        except Exception as e:
            logger.warning("Image description extraction failed: %s", e)

        text_messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": req.message + (f"\n\nImage content description:\n{image_description}" if image_description else "")},
        ]
    else:
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": req.message},
        ]
        text_messages = messages

    # Call all models in parallel
    non_vision_providers = {"deepseek", "glm"}
    tasks = []
    for m in models:
        if has_images and m.provider in non_vision_providers:
            tasks.append(_call_model(m, text_messages))
        else:
            tasks.append(_call_model(m, messages))
    responses = await asyncio.gather(*tasks)

    # Save assistant responses as chat messages (first model's response as primary)
    for resp in responses:
        if resp["content"]:
            assistant_msg = ChatMessage(
                notebook_id=uuid.UUID(notebook_id),
                user_id=user.id,
                role="assistant",
                content=resp["content"],
                citations=[],
                session_id=session_uuid,
                msg_metadata={"type": "multi_model", "model_name": resp["model_name"], "model_id": resp["model_id"]},
            )
            db.add(assistant_msg)
    await db.commit()

    # Auto-rename session if first message
    session_name = None
    if session_uuid:
        try:
            from backend.models.session import Session as SessionModel
            from sqlalchemy import func as sa_func
            msg_count = (await db.execute(
                select(sa_func.count()).where(
                    ChatMessage.session_id == session_uuid,
                    ChatMessage.role == "user",
                )
            )).scalar() or 0
            if msg_count <= 1:
                from backend.services.llm_client import llm_client
                title_messages = [
                    {"role": "system", "content": "Generate a short title (max 6 words) for this chat session. Return ONLY the title, no quotes."},
                    {"role": "user", "content": req.message[:200]},
                ]
                title = await llm_client.generate(title_messages)
                title = title.strip().strip('"').strip("'")[:60]
                if title:
                    sess = await db.get(SessionModel, session_uuid)
                    if sess:
                        sess.name = title
                        await db.commit()
                        session_name = title
        except Exception as e:
            logger.warning("Failed to auto-name session in multi-chat: %s", e)

    return {
        "user_message_id": str(user_msg.id),
        "responses": responses,
        "session_name": session_name,
    }


# ── Multi-model streaming chat (Just Chat SSE) ──────────────────

import json as _json


async def _stream_model(model: LlmModel, messages: list[dict], queue: asyncio.Queue, model_id_str: str):
    """Stream tokens from a single LLM into an asyncio.Queue tagged by model_id."""
    import httpx as _httpx

    try:
        if model.provider == "anthropic":
            async with _httpx.AsyncClient(timeout=120.0) as client:
                system_msg = ""
                anthropic_msgs = []
                for m in messages:
                    if m["role"] == "system":
                        system_msg = m["content"]
                    else:
                        anthropic_msgs.append({"role": m["role"], "content": m["content"]})
                body: dict = {"model": model.model_id, "messages": anthropic_msgs, "max_tokens": 2048, "stream": True}
                if system_msg:
                    body["system"] = system_msg
                async with client.stream("POST", f"{model.base_url.rstrip('/')}/claude/v1/messages",
                    headers={"Authorization": f"Bearer {model.api_key}", "Content-Type": "application/json"},
                    json=body) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                break
                            try:
                                event = _json.loads(data)
                                delta = event.get("delta", {})
                                text = delta.get("text", "")
                                if text:
                                    await queue.put(("token", model_id_str, text))
                            except _json.JSONDecodeError:
                                pass

        elif model.provider == "openai_resp":
            # OpenAI Responses API — no streaming support, fall back to non-streaming
            async with _httpx.AsyncClient(timeout=60.0) as client:
                prompt_parts = []
                for m in messages:
                    if m["role"] == "system":
                        prompt_parts.append(f"[System] {m['content']}")
                    else:
                        prompt_parts.append(m["content"])
                resp = await client.post(
                    f"{model.base_url.rstrip('/')}/codex/v1/responses",
                    headers={"Authorization": f"Bearer {model.api_key}", "Content-Type": "application/json"},
                    json={"model": model.model_id, "input": "\n\n".join(prompt_parts), "stream": False},
                )
                resp.raise_for_status()
                data = resp.json()
                text = ""
                for item in data.get("output", []):
                    item_type = item.get("type", "")
                    if item_type == "message":
                        for block in item.get("content", []):
                            if block.get("type") == "output_text":
                                text += block.get("text", "")
                    elif item_type == "output_text":
                        text += item.get("text", "")
                if not text:
                    text = data.get("output_text", "") or data.get("text", "")
                if text:
                    await queue.put(("token", model_id_str, text))

        else:
            # Standard OpenAI Chat Completions — streaming
            client = AsyncOpenAI(api_key=model.api_key, base_url=model.base_url, timeout=120.0)
            stream = await client.chat.completions.create(
                model=model.model_id, messages=messages, max_tokens=2048, temperature=0.7, stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    await queue.put(("token", model_id_str, delta.content))

    except Exception as e:
        await queue.put(("error", model_id_str, str(e)[:200]))
    finally:
        await queue.put(("done", model_id_str, ""))


@router.post('/multi/stream')
async def chat_multi_stream(
    notebook_id: str,
    req: ChatRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream multi-model responses via SSE. Each event is tagged with model_id."""
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'chat'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    # Get enabled models
    if req.model_ids:
        model_uuids = [uuid.UUID(mid) for mid in req.model_ids]
        result = await db.execute(
            select(LlmModel).where(LlmModel.id.in_(model_uuids), LlmModel.enabled == True)
            .order_by(LlmModel.sort_order)
        )
    else:
        result = await db.execute(
            select(LlmModel).where(LlmModel.enabled == True).order_by(LlmModel.sort_order)
        )
    models = list(result.scalars().all())
    if not models:
        raise HTTPException(status_code=400, detail='No LLM models configured.')

    # Save user message
    session_uuid = uuid.UUID(req.session_id) if req.session_id else None
    user_msg = ChatMessage(
        notebook_id=uuid.UUID(notebook_id), user_id=user.id, role="user",
        content=req.message, citations=[], session_id=session_uuid,
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    # Web search context
    search_context = ""
    if req.web_search:
        search_context = await web_search(req.message)

    # RAG retrieval from notebook sources (same as regular chat)
    source_context = ""
    try:
        from backend.models.source import Source
        from backend.services.ragflow_client import ragflow_client
        from backend.core.config import settings

        # Get all ready sources in this notebook (or filter by source_ids if provided)
        if req.source_ids:
            src_uuids = [uuid.UUID(sid) for sid in req.source_ids]
            src_result = await db.execute(
                select(Source).where(Source.id.in_(src_uuids), Source.status == "ready")
            )
        else:
            src_result = await db.execute(
                select(Source).where(Source.notebook_id == uuid.UUID(notebook_id), Source.status == "ready")
            )
        sources = list(src_result.scalars().all())

        if sources:
            dataset_ids = list(set(s.ragflow_dataset_id for s in sources if s.ragflow_dataset_id))
            if dataset_ids:
                # Vector retrieval using the user's query
                chunks = await ragflow_client.retrieve(
                    dataset_ids, req.message, top_k=settings.RAG_TOP_K,
                )
                if chunks:
                    # Build context with source attribution
                    context_parts = []
                    for i, chunk in enumerate(chunks, 1):
                        text = chunk.get("content_with_weight", chunk.get("content", ""))
                        doc_name = chunk.get("document_keyword", chunk.get("docnm_kwd", "unknown"))
                        context_parts.append(f"[{i}] ({doc_name}): {text}")
                    source_context = "\n\n".join(context_parts)
    except Exception as e:
        logger.warning("RAG retrieval failed in multi-chat stream: %s", e)

    # Build messages
    system_content = "You are a helpful AI assistant."
    if source_context:
        system_content += f"\n\nUse the following document excerpts to answer the user's question. Cite sources using [1][2] etc:\n{source_context[:15000]}"
    if search_context:
        system_content += f"\n\nWeb search results:\n{search_context}"

    has_images = req.attachments and any(a.type.startswith("image/") for a in (req.attachments or []))
    if has_images:
        user_content: list[dict] = []
        for att in (req.attachments or []):
            if att.type.startswith("image/"):
                user_content.append({"type": "image_url", "image_url": {"url": f"data:{att.type};base64,{att.data}"}})
        user_content.append({"type": "text", "text": req.message})
        llm_messages = [{"role": "system", "content": system_content}, {"role": "user", "content": user_content}]
        text_messages = [{"role": "system", "content": system_content},
                         {"role": "user", "content": req.message + "\n\n(Images attached but this model does not support vision)"}]
    else:
        llm_messages = [{"role": "system", "content": system_content}, {"role": "user", "content": req.message}]
        text_messages = llm_messages

    non_vision_providers = {"deepseek", "glm"}
    queue: asyncio.Queue = asyncio.Queue()

    # Launch all model streams in parallel
    tasks = []
    model_map: dict[str, LlmModel] = {}
    for m in models:
        mid = str(m.id)
        model_map[mid] = m
        msgs = text_messages if (has_images and m.provider in non_vision_providers) else llm_messages
        tasks.append(asyncio.create_task(_stream_model(m, msgs, queue, mid)))

    # Collect full responses for DB save
    full_responses: dict[str, str] = {str(m.id): "" for m in models}
    done_count = 0
    total = len(models)

    async def event_generator():
        nonlocal done_count

        # Send user_message_id first
        yield f"data: {_json.dumps({'type': 'init', 'user_message_id': str(user_msg.id)})}\n\n"

        while done_count < total:
            if await request.is_disconnected():
                for t in tasks:
                    t.cancel()
                return

            try:
                event_type, model_id, text = await asyncio.wait_for(queue.get(), timeout=120.0)
            except asyncio.TimeoutError:
                break

            if event_type == "token":
                full_responses[model_id] += text
                yield f"data: {_json.dumps({'type': 'token', 'model_id': model_id, 'content': text})}\n\n"
            elif event_type == "error":
                yield f"data: {_json.dumps({'type': 'error', 'model_id': model_id, 'error': text})}\n\n"
                done_count += 1
            elif event_type == "done":
                yield f"data: {_json.dumps({'type': 'done', 'model_id': model_id})}\n\n"
                done_count += 1

        # Save all assistant responses to DB
        for mid, content in full_responses.items():
            if content:
                m = model_map[mid]
                assistant_msg = ChatMessage(
                    notebook_id=uuid.UUID(notebook_id), user_id=user.id, role="assistant",
                    content=content, citations=[], session_id=session_uuid,
                    msg_metadata={"type": "multi_model", "model_name": m.name, "model_id": mid},
                )
                db.add(assistant_msg)
        await db.commit()

        # Auto-rename session if first message
        session_name = None
        if session_uuid:
            try:
                from backend.models.session import Session as SessionModel
                from sqlalchemy import func as sa_func
                msg_count = (await db.execute(
                    select(sa_func.count()).where(
                        ChatMessage.session_id == session_uuid, ChatMessage.role == "user",
                    )
                )).scalar() or 0
                if msg_count <= 1:
                    from backend.services.llm_client import llm_client
                    title = await llm_client.generate([
                        {"role": "system", "content": "Generate a short title (max 6 words) for this chat session. Return ONLY the title, no quotes."},
                        {"role": "user", "content": req.message[:200]},
                    ])
                    title = title.strip().strip('"').strip("'")[:60]
                    if title:
                        sess = await db.get(SessionModel, session_uuid)
                        if sess:
                            sess.name = title
                            await db.commit()
                            session_name = title
            except Exception as e:
                logger.warning("Failed to auto-name session in multi-chat stream: %s", e)

        if session_name:
            yield f"data: {_json.dumps({'type': 'session_name', 'name': session_name})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
