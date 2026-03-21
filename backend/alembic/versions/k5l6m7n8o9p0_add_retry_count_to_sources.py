"""Add retry_count to sources

Revision ID: k5l6m7n8o9p0
Revises: j4k5l6m7n8o9
"""
from alembic import op
import sqlalchemy as sa

revision = "k5l6m7n8o9p0"
down_revision = "j4k5l6m7n8o9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sources", sa.Column("retry_count", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("sources", "retry_count")
