"""Add sessions table and session_id to chat_messages

Revision ID: o9p0q1r2s3t4
Revises: n8o9p0q1r2s3
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "o9p0q1r2s3t4"
down_revision = "n8o9p0q1r2s3"


def upgrade() -> None:
    # 1. Create sessions table
    op.create_table(
        "sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, server_default="New Session"),
        sa.Column(
            "notebook_id",
            UUID(as_uuid=True),
            sa.ForeignKey("notebooks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # 2. Add session_id column to chat_messages (nullable)
    op.add_column(
        "chat_messages",
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )

    # 3. For each existing notebook, create a default "Session 1" and assign messages
    conn = op.get_bind()
    notebooks = conn.execute(
        sa.text("SELECT id, owner_id FROM notebooks")
    ).fetchall()

    for nb_id, owner_id in notebooks:
        import uuid
        session_id = str(uuid.uuid4())
        conn.execute(
            sa.text(
                "INSERT INTO sessions (id, name, notebook_id, created_by, created_at) "
                "VALUES (:sid, 'Session 1', :nid, :uid, NOW())"
            ),
            {"sid": session_id, "nid": str(nb_id), "uid": str(owner_id)},
        )
        conn.execute(
            sa.text(
                "UPDATE chat_messages SET session_id = :sid WHERE notebook_id = :nid"
            ),
            {"sid": session_id, "nid": str(nb_id)},
        )

    # Create index on session_id for faster lookups
    op.create_index("ix_chat_messages_session_id", "chat_messages", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_session_id", table_name="chat_messages")
    op.drop_column("chat_messages", "session_id")
    op.drop_table("sessions")
