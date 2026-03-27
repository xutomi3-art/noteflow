from datetime import datetime

from pydantic import BaseModel


class SourceResponse(BaseModel):
    id: str
    notebook_id: str
    filename: str
    file_type: str
    file_size: int | None = None
    status: str
    error_message: str | None = None
    progress: float | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
