from datetime import datetime

from pydantic import BaseModel, field_validator

NAME_MAX_LENGTH = 100


class NotebookCreate(BaseModel):
    name: str
    emoji: str = "📒"
    cover_color: str = "#4A90D9"
    is_team: bool = False
    custom_prompt: str | None = None

    @field_validator('name')
    @classmethod
    def name_must_not_be_blank(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError('Notebook name must not be empty or whitespace-only')
        if len(stripped) > NAME_MAX_LENGTH:
            raise ValueError(f'Notebook name must not exceed {NAME_MAX_LENGTH} characters')
        return stripped


class NotebookUpdate(BaseModel):
    name: str | None = None
    emoji: str | None = None
    cover_color: str | None = None
    custom_prompt: str | None = None

    @field_validator('name')
    @classmethod
    def name_must_not_be_blank(cls, v: str | None) -> str | None:
        if v is None:
            return v
        stripped = v.strip()
        if not stripped:
            raise ValueError('Notebook name must not be empty or whitespace-only')
        if len(stripped) > NAME_MAX_LENGTH:
            raise ValueError(f'Notebook name must not exceed {NAME_MAX_LENGTH} characters')
        return stripped


class NotebookResponse(BaseModel):
    id: str
    name: str
    emoji: str
    cover_color: str
    owner_id: str
    is_shared: bool
    shared_chat: bool = False
    custom_prompt: str | None = None
    user_role: str = "owner"
    source_count: int = 0
    member_count: int = 1
    created_at: datetime
    updated_at: datetime
    joined_at: datetime | None = None

    model_config = {"from_attributes": True}
