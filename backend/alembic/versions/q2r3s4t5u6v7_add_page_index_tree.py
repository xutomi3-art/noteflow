"""Add page_index_tree JSONB column to sources

Revision ID: q2r3s4t5u6v7
Revises: p1q2r3s4t5u6
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "q2r3s4t5u6v7"
down_revision = "p1q2r3s4t5u6"


def upgrade() -> None:
    op.add_column("sources", sa.Column("page_index_tree", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("sources", "page_index_tree")
