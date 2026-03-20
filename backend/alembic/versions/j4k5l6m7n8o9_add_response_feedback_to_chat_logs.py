"""Add response_preview, response_full, feedback, message_id to chat_logs

Revision ID: j4k5l6m7n8o9
Revises: i3j4k5l6m7n8
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "j4k5l6m7n8o9"
down_revision = "i3j4k5l6m7n8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_logs", sa.Column("response_preview", sa.String(200), nullable=True))
    op.add_column("chat_logs", sa.Column("response_full", sa.Text, nullable=True))
    op.add_column("chat_logs", sa.Column("feedback", sa.String(10), nullable=True))
    op.add_column("chat_logs", sa.Column("message_id", UUID(as_uuid=True), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_logs", "message_id")
    op.drop_column("chat_logs", "feedback")
    op.drop_column("chat_logs", "response_full")
    op.drop_column("chat_logs", "response_preview")
