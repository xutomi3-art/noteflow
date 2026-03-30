"""Add hotwords column to notebooks

Revision ID: n8o9p0q1r2s3
Revises: m7n8o9p0q1r2
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "n8o9p0q1r2s3"
down_revision = "m7n8o9p0q1r2"


def upgrade() -> None:
    op.add_column("notebooks", sa.Column("hotwords", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("notebooks", "hotwords")
