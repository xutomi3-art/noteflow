from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import select, func, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.admin_deps import get_admin_user
from backend.models.user import User
from backend.schemas.admin import (
    DashboardStatsResponse,
    UserListResponse,
    UpdateUserRequest,
    SystemSettingItem,
    UpdateSettingsRequest,
)
from backend.services import admin_service, settings_service
from backend.services.usage_service import get_usage_stats
from backend.models.llm_model import LlmModel

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/dashboard", response_model=DashboardStatsResponse)
async def dashboard(
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.get_dashboard_stats(db)


@router.get("/users", response_model=UserListResponse)
async def list_users(
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.list_users(db, search=search, page=page, limit=limit)


@router.post("/users/batch-delete")
async def batch_delete_users(
    user_ids: list[str] = Body(..., embed=True),
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete users. Personal notebooks are deleted. Shared notebooks transfer ownership."""
    import uuid as _uuid
    from backend.models.notebook import Notebook
    from backend.models.source import Source
    from backend.models.chat_message import ChatMessage
    from backend.models.saved_note import SavedNote
    from backend.models.chat_log import ChatLog
    from backend.models.notebook_member import NotebookMember
    from backend.models.invite_link import InviteLink

    safe_ids = [uid for uid in user_ids if uid != str(admin.id)]
    if not safe_ids:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    uuids = [_uuid.UUID(uid) for uid in safe_ids]

    # Get all notebooks owned by these users
    nb_result = await db.execute(select(Notebook).where(Notebook.owner_id.in_(uuids)))
    notebooks = list(nb_result.scalars().all())

    personal_nb_ids = []
    for nb in notebooks:
        if nb.is_shared:
            # Shared notebook: transfer ownership to next member
            members_result = await db.execute(
                select(NotebookMember)
                .where(NotebookMember.notebook_id == nb.id, NotebookMember.user_id.notin_(uuids))
                .order_by(NotebookMember.joined_at)
            )
            next_member = members_result.scalars().first()
            if next_member:
                # Transfer ownership
                nb.owner_id = next_member.user_id
                next_member.role = "owner"
            else:
                # No other members — treat as personal, delete it
                personal_nb_ids.append(nb.id)
        else:
            personal_nb_ids.append(nb.id)

    # Delete data in personal notebooks
    if personal_nb_ids:
        await db.execute(delete(Source).where(Source.notebook_id.in_(personal_nb_ids)))
        await db.execute(delete(ChatMessage).where(ChatMessage.notebook_id.in_(personal_nb_ids)))
        await db.execute(delete(SavedNote).where(SavedNote.notebook_id.in_(personal_nb_ids)))
        await db.execute(delete(ChatLog).where(ChatLog.notebook_id.in_(personal_nb_ids)))
        await db.execute(delete(NotebookMember).where(NotebookMember.notebook_id.in_(personal_nb_ids)))
        await db.execute(delete(InviteLink).where(InviteLink.notebook_id.in_(personal_nb_ids)))
        await db.execute(delete(Notebook).where(Notebook.id.in_(personal_nb_ids)))

    # Remove user from shared notebooks they don't own
    await db.execute(delete(NotebookMember).where(NotebookMember.user_id.in_(uuids)))

    # Clean up user-level references
    await db.execute(delete(InviteLink).where(InviteLink.created_by.in_(uuids)))

    # For sources in shared notebooks uploaded by deleted users, transfer to new owner
    from sqlalchemy import update
    for nb in notebooks:
        if nb.is_shared and nb.id not in personal_nb_ids:
            await db.execute(
                update(Source)
                .where(Source.notebook_id == nb.id, Source.uploaded_by.in_(uuids))
                .values(uploaded_by=nb.owner_id)
            )

    await db.execute(update(SavedNote).where(SavedNote.user_id.in_(uuids)).values(user_id=None))
    await db.execute(delete(ChatLog).where(ChatLog.user_id.in_(uuids)))
    await db.execute(delete(ChatMessage).where(ChatMessage.user_id.in_(uuids)))

    # Finally delete users
    await db.execute(delete(User).where(User.id.in_(uuids)))
    await db.commit()
    return {"deleted": len(safe_ids)}


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    req: UpdateUserRequest,
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        updates = req.model_dump(exclude_none=True)
        return await admin_service.update_user(db, user_id, updates)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/settings", response_model=list[SystemSettingItem])
async def get_settings(
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await settings_service.get_all_settings(db)


@router.put("/settings")
async def update_settings(
    req: UpdateSettingsRequest,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    for key, value in req.settings.items():
        try:
            await settings_service.set_setting(db, key, value, admin.id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Settings updated"}


@router.get("/health")
async def health_check(
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.check_service_health(db)


@router.get("/resources")
async def get_resources(
    _admin: User = Depends(get_admin_user),
):
    """Get host and container resource usage (CPU, memory, disk)."""
    import asyncio
    host = await asyncio.to_thread(admin_service.get_host_resources)
    containers = await admin_service.get_container_resources()
    return {"host": host, "containers": containers}


@router.get("/usage")
async def get_usage(
    period: int = 7,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """Get usage statistics. period=7 or period=30."""
    if period not in (7, 30):
        period = 7
    return await get_usage_stats(db, period)


@router.get("/logs")
async def get_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    status: str | None = Query(None),
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Get chat operation logs for diagnostics."""
    from backend.models.chat_log import ChatLog
    from backend.models.user import User as UserModel
    from backend.models.notebook import Notebook

    query = select(
        ChatLog,
        UserModel.email,
        UserModel.name.label("user_name"),
        Notebook.name.label("notebook_name"),
    ).join(UserModel, ChatLog.user_id == UserModel.id).join(
        Notebook, ChatLog.notebook_id == Notebook.id
    )

    if status:
        query = query.where(ChatLog.status == status)

    # Count total
    count_query = select(func.count()).select_from(ChatLog)
    if status:
        count_query = count_query.where(ChatLog.status == status)
    total = (await db.execute(count_query)).scalar() or 0

    # Paginated results
    query = query.order_by(desc(ChatLog.created_at)).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    items = []
    for row in rows:
        log = row[0]
        items.append({
            "id": str(log.id),
            "user_email": row[1],
            "user_name": row[2],
            "notebook_name": row[3],
            "message_preview": log.message_preview,
            "message_full": log.message_full,
            "response_preview": log.response_preview,
            "response_full": log.response_full,
            "feedback": log.feedback,
            "total_duration": log.total_duration,
            "ragflow_duration": log.ragflow_duration,
            "excel_duration": log.excel_duration,
            "llm_duration": log.llm_duration,
            "llm_first_token": log.llm_first_token,
            "source_count": log.source_count,
            "chunk_count": log.chunk_count,
            "thinking_mode": log.thinking_mode,
            "has_excel": log.has_excel,
            "llm_model": log.llm_model,
            "token_count": log.token_count,
            "status": log.status,
            "error_message": log.error_message,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        })

    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/token-usage")
async def get_token_usage(
    period: int = Query(7, ge=1, le=90),
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Get per-user token consumption stats."""
    from datetime import datetime, timedelta, timezone
    from backend.models.chat_log import ChatLog
    from backend.models.user import User as UserModel

    since = datetime.now(timezone.utc) - timedelta(days=period)

    query = (
        select(
            ChatLog.user_id,
            UserModel.email,
            UserModel.name.label("user_name"),
            func.count(ChatLog.id).label("request_count"),
            func.coalesce(func.sum(ChatLog.token_count), 0).label("total_tokens"),
        )
        .join(UserModel, ChatLog.user_id == UserModel.id)
        .where(ChatLog.created_at >= since, ChatLog.status == "ok")
        .group_by(ChatLog.user_id, UserModel.email, UserModel.name)
        .order_by(desc("total_tokens"))
    )

    result = await db.execute(query)
    rows = result.all()

    def _estimate_cost(tokens: int) -> float:
        """Estimate cost in CNY based on Qwen3.5-Plus tiered pricing."""
        # Approximate: assume 80% input, 20% output
        input_tokens = tokens * 0.8
        output_tokens = tokens * 0.2
        # Simplified: use ≤128K tier (most common)
        input_cost = input_tokens / 1_000_000 * 0.8
        output_cost = output_tokens / 1_000_000 * 4.8
        return round(input_cost + output_cost, 2)

    users = []
    grand_total_tokens = 0
    for row in rows:
        total = int(row.total_tokens)
        grand_total_tokens += total
        users.append({
            "user_id": str(row.user_id),
            "email": row.email,
            "name": row.user_name,
            "request_count": row.request_count,
            "total_tokens": total,
            "avg_tokens_per_request": round(total / row.request_count) if row.request_count else 0,
            "estimated_cost": _estimate_cost(total),
        })

    return {
        "users": users,
        "total_tokens": grand_total_tokens,
        "total_cost": _estimate_cost(grand_total_tokens),
        "period_days": period,
    }


@router.get("/ragflow-models")
async def get_ragflow_models(
    _admin: User = Depends(get_admin_user),
):
    """Get RAGFlow internal model configuration (llm_id, embd_id, rerank_id)."""
    from backend.services.ragflow_config_service import get_ragflow_models as _get
    try:
        return await _get()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to read RAGFlow config: {e}")


@router.put("/ragflow-models")
async def update_ragflow_models(
    body: dict = Body(...),
    _admin: User = Depends(get_admin_user),
):
    """Update RAGFlow internal model configuration."""
    from backend.services.ragflow_config_service import update_ragflow_models as _update
    allowed = {"llm_id", "embd_id", "rerank_id"}
    filtered = {k: v for k, v in body.items() if k in allowed and isinstance(v, str) and v.strip()}
    if not filtered:
        raise HTTPException(status_code=400, detail="No valid fields provided")
    try:
        return await _update(**filtered)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to update RAGFlow config: {e}")


@router.get("/ragflow-providers")
async def get_ragflow_providers(
    _admin: User = Depends(get_admin_user),
):
    """Get RAGFlow model provider configs (embedding/rerank API bases)."""
    from backend.services.ragflow_config_service import get_ragflow_providers as _get
    try:
        return await _get()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to read RAGFlow providers: {e}")


@router.put("/ragflow-providers")
async def update_ragflow_provider(
    body: dict = Body(...),
    _admin: User = Depends(get_admin_user),
):
    """Update a RAGFlow model provider's api_base or api_key."""
    from backend.services.ragflow_config_service import update_ragflow_provider as _update
    llm_factory = body.get("llm_factory")
    llm_name = body.get("llm_name")
    if not llm_factory or not llm_name:
        raise HTTPException(status_code=400, detail="llm_factory and llm_name required")
    api_base = body.get("api_base")
    api_key = body.get("api_key")
    if api_base is None and api_key is None:
        raise HTTPException(status_code=400, detail="api_base or api_key required")
    try:
        return await _update(llm_factory, llm_name, api_base=api_base, api_key=api_key)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to update RAGFlow provider: {e}")


@router.get("/feedback")
async def list_feedback(
    status: str | None = Query(None),
    type: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """List all feedback with optional status/type filters and pagination."""
    from backend.models.feedback import Feedback
    from backend.models.user import User as UserModel

    query = select(
        Feedback,
        UserModel.name.label("user_name"),
        UserModel.email.label("user_email"),
    ).join(UserModel, Feedback.user_id == UserModel.id)

    count_query = select(func.count()).select_from(Feedback)

    if status:
        query = query.where(Feedback.status == status)
        count_query = count_query.where(Feedback.status == status)
    if type:
        query = query.where(Feedback.type == type)
        count_query = count_query.where(Feedback.type == type)

    total = (await db.execute(count_query)).scalar() or 0

    query = query.order_by(desc(Feedback.created_at)).offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    items = []
    for row in rows:
        fb = row[0]
        items.append({
            "id": str(fb.id),
            "user_name": row[1],
            "user_email": row[2],
            "type": fb.type,
            "content": fb.content,
            "screenshot_url": fb.screenshot_url,
            "status": fb.status,
            "created_at": fb.created_at.isoformat() if fb.created_at else None,
            "resolved_at": fb.resolved_at.isoformat() if fb.resolved_at else None,
        })

    return {"items": items, "total": total, "page": page, "limit": limit}


@router.patch("/feedback/{feedback_id}")
async def update_feedback_status(
    feedback_id: str,
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle feedback status between open and resolved."""
    import uuid as _uuid
    from backend.models.feedback import Feedback

    result = await db.execute(
        select(Feedback).where(Feedback.id == _uuid.UUID(feedback_id))
    )
    fb = result.scalar_one_or_none()
    if not fb:
        raise HTTPException(status_code=404, detail="Feedback not found")

    if fb.status == "open":
        fb.status = "resolved"
        fb.resolved_at = datetime.now(timezone.utc)
    else:
        fb.status = "open"
        fb.resolved_at = None

    await db.commit()
    return {"id": str(fb.id), "status": fb.status, "resolved_at": fb.resolved_at.isoformat() if fb.resolved_at else None}


# ── LLM Models CRUD (for Just Chat multi-model) ──────────────────

import uuid as _uuid
from pydantic import BaseModel as _BaseModel


class _LlmModelCreate(_BaseModel):
    name: str
    provider: str
    model_id: str
    base_url: str
    api_key: str
    supports_search: bool = False
    search_type: str = "serper"
    enabled: bool = True
    sort_order: int = 0


class _LlmModelUpdate(_BaseModel):
    name: str | None = None
    provider: str | None = None
    model_id: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    supports_search: bool | None = None
    search_type: str | None = None
    enabled: bool | None = None
    sort_order: int | None = None


def _model_to_dict(m: LlmModel) -> dict:
    return {
        "id": str(m.id), "name": m.name, "provider": m.provider,
        "model_id": m.model_id, "base_url": m.base_url,
        "api_key": m.api_key[:8] + "..." if m.api_key and len(m.api_key) > 8 else m.api_key,
        "supports_search": m.supports_search, "search_type": m.search_type,
        "enabled": m.enabled, "sort_order": m.sort_order,
    }


@router.get("/llm-models")
async def list_llm_models(
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(LlmModel).order_by(LlmModel.sort_order, LlmModel.created_at))
    return [_model_to_dict(m) for m in result.scalars().all()]


@router.post("/llm-models")
async def create_llm_model(
    body: _LlmModelCreate,
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    m = LlmModel(
        name=body.name, provider=body.provider, model_id=body.model_id,
        base_url=body.base_url, api_key=body.api_key,
        supports_search=body.supports_search, search_type=body.search_type,
        enabled=body.enabled, sort_order=body.sort_order,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _model_to_dict(m)


@router.patch("/llm-models/{model_id}")
async def update_llm_model(
    model_id: str,
    body: _LlmModelUpdate,
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    m = await db.get(LlmModel, _uuid.UUID(model_id))
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(m, field, val)
    await db.commit()
    await db.refresh(m)
    return _model_to_dict(m)


@router.delete("/llm-models/{model_id}")
async def delete_llm_model(
    model_id: str,
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    m = await db.get(LlmModel, _uuid.UUID(model_id))
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    await db.delete(m)
    await db.commit()
    return {"data": {"message": "Model deleted"}}
