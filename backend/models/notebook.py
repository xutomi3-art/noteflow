import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base


class Notebook(Base):
    __tablename__ = "notebooks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    emoji: Mapped[str] = mapped_column(String(10), default="📒")
    cover_color: Mapped[str] = mapped_column(String(20), default="#4A90D9")
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False)
    ragflow_dataset_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    overview_cache: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    overview_source_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    hotwords: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=None)
    shared_chat: Mapped[bool] = mapped_column(Boolean, default=True)
    custom_prompt: Mapped[str | None] = mapped_column(sa.Text, nullable=True, default=None)
    suggestion_level: Mapped[str] = mapped_column(String(10), default="medium")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    is_just_chat: Mapped[bool] = mapped_column(Boolean, default=False)
