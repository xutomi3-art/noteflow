import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.chat_message import ChatMessage
from backend.models.notebook import Notebook
from backend.models.shared_minutes import SharedMinutes
from backend.models.user import User
from backend.services import permission_service

router = APIRouter(tags=["meeting-share"])


@router.post("/notebooks/{notebook_id}/chat/{message_id}/share-minutes")
async def create_share_link(
    notebook_id: str,
    message_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a public share link for a meeting minutes message."""
    nb_uuid = uuid.UUID(notebook_id)
    msg_uuid = uuid.UUID(message_id)

    if not await permission_service.check_permission(db, nb_uuid, user.id, "view"):
        raise HTTPException(status_code=403, detail="No access to this notebook")

    # Verify the message exists and is meeting_minutes type
    msg = await db.get(ChatMessage, msg_uuid)
    if not msg or msg.notebook_id != nb_uuid:
        raise HTTPException(status_code=404, detail="Message not found")
    if not msg.msg_metadata or msg.msg_metadata.get("type") != "meeting_minutes":
        raise HTTPException(status_code=400, detail="Only meeting minutes can be shared")

    # Check if already shared — return existing link
    result = await db.execute(
        select(SharedMinutes).where(SharedMinutes.message_id == msg_uuid)
    )
    existing = result.scalar_one_or_none()
    if existing and (not existing.expires_at or existing.expires_at > datetime.now(timezone.utc)):
        return {"data": {"token": existing.token, "view_count": existing.view_count}}

    # Create new share link (30 day expiry)
    link = SharedMinutes(
        message_id=msg_uuid,
        notebook_id=nb_uuid,
        created_by=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)

    return {"data": {"token": link.token, "view_count": 0}}


@router.delete("/notebooks/{notebook_id}/chat/{message_id}/share-minutes")
async def revoke_share_link(
    notebook_id: str,
    message_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a meeting minutes share link."""
    nb_uuid = uuid.UUID(notebook_id)
    msg_uuid = uuid.UUID(message_id)

    if not await permission_service.check_permission(db, nb_uuid, user.id, "view"):
        raise HTTPException(status_code=403, detail="No access to this notebook")

    result = await db.execute(
        select(SharedMinutes).where(
            SharedMinutes.message_id == msg_uuid,
            SharedMinutes.notebook_id == nb_uuid,
        )
    )
    link = result.scalar_one_or_none()
    if link:
        await db.delete(link)
        await db.commit()

    return {"data": {"message": "Share link revoked"}}


@router.get("/public/meeting-minutes/{token}")
async def get_public_meeting_minutes(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint — no auth required. View shared meeting minutes."""
    result = await db.execute(
        select(SharedMinutes).where(SharedMinutes.token == token)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")

    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Share link has expired")

    # Fetch message
    msg = await db.get(ChatMessage, link.message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Meeting minutes not found")

    # Fetch notebook name
    nb = await db.get(Notebook, link.notebook_id)
    notebook_name = nb.name if nb else ""

    # Fetch creator name
    creator = await db.get(User, link.created_by)
    created_by_name = creator.name or creator.email.split("@")[0] if creator else ""

    # Increment view count
    link.view_count = (link.view_count or 0) + 1
    await db.commit()

    # Strip markdown code fences if present
    content = msg.content
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content
    if content.endswith("```"):
        content = content.rsplit("\n", 1)[0] if "\n" in content else content

    return {
        "title": (msg.msg_metadata or {}).get("title", "Meeting Minutes"),
        "content": content,
        "notebook_name": notebook_name,
        "created_by": created_by_name,
        "created_at": msg.created_at.isoformat(),
        "view_count": link.view_count,
    }
