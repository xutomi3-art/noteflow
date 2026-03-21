import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, Float, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base


class ChatLog(Base):
    __tablename__ = "chat_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    message_preview: Mapped[str] = mapped_column(String(200), nullable=False)
    message_full: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timing (seconds)
    total_duration: Mapped[float] = mapped_column(Float, nullable=True)
    ragflow_duration: Mapped[float] = mapped_column(Float, nullable=True)
    excel_duration: Mapped[float] = mapped_column(Float, nullable=True)
    llm_duration: Mapped[float] = mapped_column(Float, nullable=True)
    llm_first_token: Mapped[float] = mapped_column(Float, nullable=True)  # time to first token

    # Metadata
    source_count: Mapped[int] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=True)
    thinking_mode: Mapped[bool] = mapped_column(default=False)
    has_excel: Mapped[bool] = mapped_column(default=False)
    llm_model: Mapped[str] = mapped_column(String(50), nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, nullable=True)  # response token count approx

    # Response
    response_preview: Mapped[str | None] = mapped_column(String(200), nullable=True)
    response_full: Mapped[str | None] = mapped_column(Text, nullable=True)

    # User feedback (thumbs up/down)
    feedback: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "up", "down", or null
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)  # links to chat_messages.id

    # Status
    status: Mapped[str] = mapped_column(String(20), default="ok")  # ok, error, timeout
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
