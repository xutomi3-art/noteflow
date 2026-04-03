import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import String, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar: Mapped[str | None] = mapped_column(String(500), nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    microsoft_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    auth_provider: Mapped[str] = mapped_column(String(20), default="local", server_default="local")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa.false())
    is_disabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa.false())
    ragflow_dataset_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
