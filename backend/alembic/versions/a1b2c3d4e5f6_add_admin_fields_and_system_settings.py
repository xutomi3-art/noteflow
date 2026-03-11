"""add admin fields and system_settings table

Revision ID: a1b2c3d4e5f6
Revises: ef38ccc0575d
Create Date: 2026-03-11 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'ef38ccc0575d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add admin fields to users table
    op.add_column('users', sa.Column('is_admin', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('users', sa.Column('is_disabled', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('users', sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True))

    # Create system_settings table
    op.create_table(
        'system_settings',
        sa.Column('key', sa.String(100), primary_key=True),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
        sa.Column('updated_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('system_settings')
    op.drop_column('users', 'last_active_at')
    op.drop_column('users', 'is_disabled')
    op.drop_column('users', 'is_admin')
