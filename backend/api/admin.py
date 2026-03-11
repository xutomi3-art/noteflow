from fastapi import APIRouter, Depends, HTTPException, Query
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
):
    return await admin_service.check_service_health()
