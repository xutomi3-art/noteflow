"""add user_id to saved_notes

Revision ID: d3e697492b59
Revises: g1h2i3j4k5l6
Create Date: 2026-03-16 02:49:20.609128

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d3e697492b59"
down_revision: Union[str, None] = "g1h2i3j4k5l6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("saved_notes", sa.Column("user_id", sa.UUID(), nullable=True))
    op.create_foreign_key(None, "saved_notes", "users", ["user_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(None, "saved_notes", type_="foreignkey")
    op.drop_column("saved_notes", "user_id")
