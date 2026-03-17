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
    """Delete multiple users by ID. Cannot delete yourself."""
    safe_ids = [uid for uid in user_ids if uid != str(admin.id)]
    if not safe_ids:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    import uuid
    await db.execute(delete(User).where(User.id.in_([uuid.UUID(uid) for uid in safe_ids])))
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
