import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.notebook import Notebook
from backend.models.session import Session
from backend.models.user import User
from backend.services import permission_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notebooks/{notebook_id}/sessions", tags=["sessions"])


class SessionCreate(BaseModel):
    name: str = "New Session"


class SessionUpdate(BaseModel):
    name: str


class SessionResponse(BaseModel):
    id: str
    name: str
    notebook_id: str
    created_by: str
    created_at: str

    model_config = {"from_attributes": True}


async def _ensure_default_session(
    db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID
) -> Session:
    """Create a default 'Chat 1' if no sessions exist for this notebook."""
    result = await db.execute(
        select(Session).where(Session.notebook_id == notebook_id).limit(1)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing

    # Get notebook owner_id to use as created_by
    nb = await db.get(Notebook, notebook_id)
    owner_id = nb.owner_id if nb else user_id

    session = Session(
        name="Chat 1",
        notebook_id=notebook_id,
        created_by=owner_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("")
async def list_sessions(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb_uuid = uuid.UUID(notebook_id)
    if not await permission_service.check_permission(db, nb_uuid, user.id, "view"):
        raise HTTPException(status_code=403, detail="No access to this notebook")

    result = await db.execute(
        select(Session)
        .where(Session.notebook_id == nb_uuid)
        .order_by(Session.created_at.asc())
    )
    sessions = list(result.scalars().all())

    # Auto-create default session if none exist
    if not sessions:
        default = await _ensure_default_session(db, nb_uuid, user.id)
        sessions = [default]

    return {
        "data": [
            SessionResponse(
                id=str(s.id),
                name=s.name,
                notebook_id=str(s.notebook_id),
                created_by=str(s.created_by),
                created_at=s.created_at.isoformat(),
            )
            for s in sessions
        ]
    }


@router.post("")
async def create_session(
    notebook_id: str,
    req: SessionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb_uuid = uuid.UUID(notebook_id)
    if not await permission_service.check_permission(db, nb_uuid, user.id, "chat"):
        raise HTTPException(status_code=403, detail="No access to this notebook")

    session = Session(
        name=req.name,
        notebook_id=nb_uuid,
        created_by=user.id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return {
        "data": SessionResponse(
            id=str(session.id),
            name=session.name,
            notebook_id=str(session.notebook_id),
            created_by=str(session.created_by),
            created_at=session.created_at.isoformat(),
        )
    }


@router.patch("/{session_id}")
async def rename_session(
    notebook_id: str,
    session_id: str,
    req: SessionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb_uuid = uuid.UUID(notebook_id)
    if not await permission_service.check_permission(db, nb_uuid, user.id, "chat"):
        raise HTTPException(status_code=403, detail="No access to this notebook")

    session = await db.get(Session, uuid.UUID(session_id))
    if not session or session.notebook_id != nb_uuid:
        raise HTTPException(status_code=404, detail="Session not found")

    session.name = req.name
    await db.commit()
    await db.refresh(session)

    return {
        "data": SessionResponse(
            id=str(session.id),
            name=session.name,
            notebook_id=str(session.notebook_id),
            created_by=str(session.created_by),
            created_at=session.created_at.isoformat(),
        )
    }


@router.delete("/{session_id}")
async def delete_session(
    notebook_id: str,
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb_uuid = uuid.UUID(notebook_id)
    if not await permission_service.check_permission(db, nb_uuid, user.id, "upload"):
        raise HTTPException(status_code=403, detail="No permission to delete sessions")

    session = await db.get(Session, uuid.UUID(session_id))
    if not session or session.notebook_id != nb_uuid:
        raise HTTPException(status_code=404, detail="Session not found")

    # Delete session (cascade will delete associated messages)
    await db.delete(session)
    await db.commit()

    return {"data": {"message": "Session deleted"}}
