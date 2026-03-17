"""add overview_cache to notebooks

Revision ID: i3j4k5l6m7n8
Revises: h2i3j4k5l6m7
Create Date: 2026-03-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "i3j4k5l6m7n8"
down_revision: Union[str, None] = "h2i3j4k5l6m7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notebooks", sa.Column("overview_cache", sa.Text(), nullable=True))
    op.add_column("notebooks", sa.Column("overview_source_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("notebooks", "overview_source_hash")
    op.drop_column("notebooks", "overview_cache")
