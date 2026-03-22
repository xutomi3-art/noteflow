"""Add feedback_comment to chat_logs

Revision ID: l6m7n8o9p0q1
Revises: k5l6m7n8o9p0
"""
from alembic import op
import sqlalchemy as sa

revision = "l6m7n8o9p0q1"
down_revision = "k5l6m7n8o9p0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_logs", sa.Column("feedback_comment", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_logs", "feedback_comment")
