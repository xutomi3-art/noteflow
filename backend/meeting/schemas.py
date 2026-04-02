from datetime import datetime
from pydantic import BaseModel


class MeetingCreate(BaseModel):
    """No fields needed — notebook_id comes from URL, user from auth."""
    pass


class SpeakerUpdate(BaseModel):
    speaker_map: dict[str, str]  # {"speaker_1": "Tommy", "speaker_2": "Alice"}


class UtteranceOut(BaseModel):
    id: str
    speaker_id: str
    text: str
    start_time_ms: int
    end_time_ms: int
    is_final: bool
    sequence: int
    provider: str = ""

    class Config:
        from_attributes = True


class MeetingOut(BaseModel):
    id: str
    notebook_id: str
    status: str
    speaker_map: dict[str, str]
    title: str | None
    source_id: str | None
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: int | None
    created_by: str | None = None

    class Config:
        from_attributes = True
