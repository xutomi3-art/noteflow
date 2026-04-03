"""Add ragflow_dataset_id to users

Revision ID: m7n8o9p0q1r2
Revises: l6m7n8o9p0q1
"""
from alembic import op
import sqlalchemy as sa

revision = "m7n8o9p0q1r2"
down_revision = "l6m7n8o9p0q1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("ragflow_dataset_id", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "ragflow_dataset_id")
