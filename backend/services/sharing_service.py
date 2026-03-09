import uuid
import secrets
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.notebook import Notebook
from backend.models.notebook_member import NotebookMember
from backend.models.invite_link import InviteLink
from backend.models.user import User


async def create_invite_link(
    db: AsyncSession, notebook_id: uuid.UUID, created_by: uuid.UUID, role: str = "viewer"
) -> InviteLink:
    """Create an invite link for a notebook."""
    link = InviteLink(
        notebook_id=notebook_id,
        token=secrets.token_urlsafe(32),
        role=role,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        created_by=created_by,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def get_invite_links(db: AsyncSession, notebook_id: uuid.UUID) -> list[InviteLink]:
    """Get all invite links for a notebook."""
    result = await db.execute(
        select(InviteLink)
        .where(InviteLink.notebook_id == notebook_id)
        .order_by(InviteLink.created_at.desc())
    )
    return list(result.scalars().all())


async def revoke_invite_link(db: AsyncSession, link_id: uuid.UUID) -> bool:
    """Revoke an invite link."""
    result = await db.execute(select(InviteLink).where(InviteLink.id == link_id))
    link = result.scalar_one_or_none()
    if link is None:
        return False
    await db.delete(link)
    await db.commit()
    return True


async def join_via_token(db: AsyncSession, token: str, user_id: uuid.UUID) -> dict | None:
    """Join a notebook via invite token. Returns notebook info or None."""
    result = await db.execute(select(InviteLink).where(InviteLink.token == token))
    link = result.scalar_one_or_none()
    if link is None:
        return None

    # Check expiry
    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        return None

    notebook_id = link.notebook_id

    # Check if already a member or owner
    result = await db.execute(
        select(Notebook).where(Notebook.id == notebook_id, Notebook.owner_id == user_id)
    )
    if result.scalar_one_or_none():
        # Already owner
        result2 = await db.execute(select(Notebook).where(Notebook.id == notebook_id))
        nb = result2.scalar_one()
        return {"notebook_id": str(nb.id), "name": nb.name, "already_member": True}

    result = await db.execute(
        select(NotebookMember).where(
            NotebookMember.notebook_id == notebook_id,
            NotebookMember.user_id == user_id,
        )
    )
    if result.scalar_one_or_none():
        result2 = await db.execute(select(Notebook).where(Notebook.id == notebook_id))
        nb = result2.scalar_one()
        return {"notebook_id": str(nb.id), "name": nb.name, "already_member": True}

    # Add as member
    member = NotebookMember(
        notebook_id=notebook_id,
        user_id=user_id,
        role=link.role,
    )
    db.add(member)

    # Mark notebook as shared
    result = await db.execute(select(Notebook).where(Notebook.id == notebook_id))
    notebook = result.scalar_one()
    notebook.is_shared = True
    await db.commit()

    return {"notebook_id": str(notebook.id), "name": notebook.name, "already_member": False}


async def get_members(db: AsyncSession, notebook_id: uuid.UUID) -> list[dict]:
    """Get all members (including owner) of a notebook."""
    result = await db.execute(select(Notebook).where(Notebook.id == notebook_id))
    notebook = result.scalar_one_or_none()
    if notebook is None:
        return []

    members = []

    # Add owner
    result = await db.execute(select(User).where(User.id == notebook.owner_id))
    owner = result.scalar_one_or_none()
    if owner:
        members.append({
            "user_id": str(owner.id),
            "name": owner.name,
            "email": owner.email,
            "avatar": owner.avatar,
            "role": "owner",
            "joined_at": notebook.created_at,
        })

    # Add other members
    result = await db.execute(
        select(NotebookMember, User)
        .join(User, NotebookMember.user_id == User.id)
        .where(NotebookMember.notebook_id == notebook_id)
        .order_by(NotebookMember.joined_at.asc())
    )
    for member, user in result.all():
        members.append({
            "user_id": str(user.id),
            "name": user.name,
            "email": user.email,
            "avatar": user.avatar,
            "role": member.role,
            "joined_at": member.joined_at,
        })

    return members


async def update_member_role(
    db: AsyncSession, notebook_id: uuid.UUID, target_user_id: uuid.UUID, new_role: str
) -> bool:
    """Update a member's role."""
    result = await db.execute(
        select(NotebookMember).where(
            NotebookMember.notebook_id == notebook_id,
            NotebookMember.user_id == target_user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        return False
    member.role = new_role
    await db.commit()
    return True


async def remove_member(db: AsyncSession, notebook_id: uuid.UUID, target_user_id: uuid.UUID) -> bool:
    """Remove a member from a notebook."""
    result = await db.execute(
        select(NotebookMember).where(
            NotebookMember.notebook_id == notebook_id,
            NotebookMember.user_id == target_user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        return False
    await db.delete(member)
    await db.commit()

    # Check if notebook should become personal again
    result = await db.execute(
        select(func.count()).select_from(NotebookMember).where(
            NotebookMember.notebook_id == notebook_id
        )
    )
    count = result.scalar()
    if count == 0:
        result = await db.execute(select(Notebook).where(Notebook.id == notebook_id))
        notebook = result.scalar_one()
        notebook.is_shared = False
        await db.commit()

    return True


async def leave_notebook(db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Leave a shared notebook (non-owner)."""
    return await remove_member(db, notebook_id, user_id)


async def transfer_ownership(
    db: AsyncSession, notebook_id: uuid.UUID, current_owner_id: uuid.UUID, new_owner_id: uuid.UUID
) -> bool:
    """Transfer notebook ownership to another member."""
    # Verify new owner is a member
    result = await db.execute(
        select(NotebookMember).where(
            NotebookMember.notebook_id == notebook_id,
            NotebookMember.user_id == new_owner_id,
        )
    )
    new_member = result.scalar_one_or_none()
    if new_member is None:
        return False

    # Get notebook
    result = await db.execute(select(Notebook).where(Notebook.id == notebook_id))
    notebook = result.scalar_one()

    # Remove new owner from members table
    await db.delete(new_member)

    # Add old owner as editor
    old_owner_member = NotebookMember(
        notebook_id=notebook_id,
        user_id=current_owner_id,
        role="editor",
    )
    db.add(old_owner_member)

    # Transfer ownership
    notebook.owner_id = new_owner_id
    await db.commit()
    return True


async def stop_sharing(db: AsyncSession, notebook_id: uuid.UUID) -> None:
    """Stop sharing a notebook — remove all members."""
    await db.execute(
        delete(NotebookMember).where(NotebookMember.notebook_id == notebook_id)
    )
    await db.execute(
        delete(InviteLink).where(InviteLink.notebook_id == notebook_id)
    )
    result = await db.execute(select(Notebook).where(Notebook.id == notebook_id))
    notebook = result.scalar_one()
    notebook.is_shared = False
    await db.commit()
