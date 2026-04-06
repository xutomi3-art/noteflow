from datetime import datetime

from pydantic import BaseModel


class ChatAttachment(BaseModel):
    name: str
    type: str  # mime type
    data: str  # base64 data (no prefix)


class ChatRequest(BaseModel):
    message: str
    source_ids: list[str] | None = None
    web_search: bool = False
    deep_thinking: bool = False
    session_id: str | None = None
    model_ids: list[str] | None = None
    attachments: list[ChatAttachment] | None = None


class CitationSchema(BaseModel):
    index: int
    source_id: str
    filename: str
    file_type: str
    location: dict = {}
    excerpt: str = ""


class ChatMessageResponse(BaseModel):
    id: str
    notebook_id: str
    user_id: str
    role: str
    content: str
    citations: list[CitationSchema] = []
    created_at: datetime
    user_name: str = ""  # Populated in shared chat mode
    metadata: dict | None = None

    model_config = {"from_attributes": True}
