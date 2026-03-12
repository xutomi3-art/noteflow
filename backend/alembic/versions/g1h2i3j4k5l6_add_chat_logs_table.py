"""Add chat_logs table

Revision ID: g1h2i3j4k5l6
Revises: f1a2b3c4d5e6
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "g1h2i3j4k5l6"
down_revision = "f1a2b3c4d5e6"


def upgrade():
    op.create_table(
        "chat_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("notebook_id", UUID(as_uuid=True), sa.ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("message_preview", sa.String(200), nullable=False),
        sa.Column("total_duration", sa.Float, nullable=True),
        sa.Column("ragflow_duration", sa.Float, nullable=True),
        sa.Column("excel_duration", sa.Float, nullable=True),
        sa.Column("llm_duration", sa.Float, nullable=True),
        sa.Column("llm_first_token", sa.Float, nullable=True),
        sa.Column("source_count", sa.Integer, nullable=True),
        sa.Column("chunk_count", sa.Integer, nullable=True),
        sa.Column("thinking_mode", sa.Boolean, default=False),
        sa.Column("has_excel", sa.Boolean, default=False),
        sa.Column("llm_model", sa.String(50), nullable=True),
        sa.Column("token_count", sa.Integer, nullable=True),
        sa.Column("status", sa.String(20), default="ok"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_chat_logs_created_at", "chat_logs", ["created_at"])
    op.create_index("ix_chat_logs_user_id", "chat_logs", ["user_id"])


def downgrade():
    op.drop_table("chat_logs")
