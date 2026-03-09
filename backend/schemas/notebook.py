from datetime import datetime

from pydantic import BaseModel


class NotebookCreate(BaseModel):
    name: str
    emoji: str = "📒"
    cover_color: str = "#4A90D9"


class NotebookUpdate(BaseModel):
    name: str | None = None
    emoji: str | None = None
    cover_color: str | None = None


class NotebookResponse(BaseModel):
    id: str
    name: str
    emoji: str
    cover_color: str
    owner_id: str
    is_shared: bool
    user_role: str = "owner"
    source_count: int = 0
    member_count: int = 1
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
