"""create feedback table

Revision ID: f1e2d3c4b5a6
Revises: d3e697492b59
Create Date: 2026-03-18 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f1e2d3c4b5a6'
down_revision: Union[str, None] = 'd3e697492b59'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'feedback',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', sa.String(10), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('screenshot_url', sa.String(500), nullable=True),
        sa.Column('status', sa.String(20), server_default='open', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_feedback_status', 'feedback', ['status'])
    op.create_index('ix_feedback_type', 'feedback', ['type'])


def downgrade() -> None:
    op.drop_index('ix_feedback_type', table_name='feedback')
    op.drop_index('ix_feedback_status', table_name='feedback')
    op.drop_table('feedback')
