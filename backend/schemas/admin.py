from pydantic import BaseModel


class DashboardStatsResponse(BaseModel):
    total_users: int
    total_notebooks: int
    total_documents: int
    storage_bytes: int
    active_users_7d: int


class AdminUserItem(BaseModel):
    id: str
    email: str
    name: str
    avatar: str | None = None
    is_admin: bool
    is_disabled: bool
    created_at: str | None
    last_active_at: str | None
    notebook_count: int
    document_count: int


class UserListResponse(BaseModel):
    items: list[AdminUserItem]
    total: int
    page: int
    limit: int


class UpdateUserRequest(BaseModel):
    is_disabled: bool | None = None
    is_admin: bool | None = None
    name: str | None = None


class SystemSettingItem(BaseModel):
    key: str
    value: str
    source: str  # "db" or "env"
    updated_at: str | None


class UpdateSettingsRequest(BaseModel):
    settings: dict[str, str]


class ServiceHealthItem(BaseModel):
    status: str  # "ok" or "error"
    latency_ms: int
    message: str | None = None
