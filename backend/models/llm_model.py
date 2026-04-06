import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, Boolean, DateTime, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base


class LlmModel(Base):
    __tablename__ = "llm_models"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)  # Display name e.g. "GPT-4o"
    provider: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. "openai", "anthropic", "qwen", "glm"
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)  # API model ID e.g. "gpt-4o"
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)  # API base URL
    api_key: Mapped[str] = mapped_column(Text, nullable=False)  # API key
    supports_search: Mapped[bool] = mapped_column(Boolean, default=False)  # Whether model supports web search natively
    search_type: Mapped[str] = mapped_column(String(20), default="serper")  # "serper", "qwen", "glm", "none"
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
