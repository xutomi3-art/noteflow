from datetime import datetime

from pydantic import BaseModel


class SaveNoteRequest(BaseModel):
    content: str
    source_message_id: str | None = None


class SavedNoteResponse(BaseModel):
    id: str
    notebook_id: str
    source_message_id: str | None = None
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}
