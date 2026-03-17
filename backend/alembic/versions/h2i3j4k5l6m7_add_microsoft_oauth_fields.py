"""add microsoft_id to users

Revision ID: h2i3j4k5l6m7
Revises: d3e697492b59
Create Date: 2026-03-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "h2i3j4k5l6m7"
down_revision: Union[str, None] = "d3e697492b59"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("microsoft_id", sa.String(255), nullable=True))
    op.create_unique_constraint("uq_users_microsoft_id", "users", ["microsoft_id"])
    op.create_index("ix_users_microsoft_id", "users", ["microsoft_id"])


def downgrade() -> None:
    op.drop_index("ix_users_microsoft_id", table_name="users")
    op.drop_constraint("uq_users_microsoft_id", "users", type_="unique")
    op.drop_column("users", "microsoft_id")
