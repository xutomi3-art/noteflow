import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.notebook import Notebook
from backend.models.notebook_member import NotebookMember


async def get_user_role(db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    """Get user's role for a notebook. Returns 'owner', 'editor', 'viewer', or None."""
    # Check if owner
    result = await db.execute(
        select(Notebook).where(Notebook.id == notebook_id, Notebook.owner_id == user_id)
    )
    if result.scalar_one_or_none():
        return "owner"

    # Check membership
    result = await db.execute(
        select(NotebookMember).where(
            NotebookMember.notebook_id == notebook_id,
            NotebookMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    return member.role if member else None


async def check_permission(
    db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID, action: str
) -> bool:
    """Check if user has permission for an action on a notebook.

    Actions: view, chat, upload, rename, share, delete, manage_members, transfer
    """
    role = await get_user_role(db, notebook_id, user_id)
    if role is None:
        return False

    PERMISSIONS = {
        "view": {"owner", "editor", "viewer"},
        "chat": {"owner", "editor", "viewer"},
        "upload": {"owner", "editor"},
        "delete_source": {"owner", "editor"},
        "rename": {"owner", "editor"},
        "share": {"owner", "editor"},
        "delete": {"owner"},
        "manage_members": {"owner"},
        "transfer": {"owner"},
    }

    allowed_roles = PERMISSIONS.get(action, set())
    return role in allowed_roles
