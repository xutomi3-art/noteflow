import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.user import User
from backend.schemas.note import SaveNoteRequest, UpdateNoteRequest, SavedNoteResponse
from backend.services import note_service, permission_service

router = APIRouter(prefix='/notebooks/{notebook_id}/notes', tags=['notes'])


@router.post('', response_model=SavedNoteResponse)
async def save_note(
    notebook_id: str,
    req: SaveNoteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    note = await note_service.create_note(
        db=db,
        notebook_id=uuid.UUID(notebook_id),
        user_id=user.id,
        content=req.content,
        source_message_id=uuid.UUID(req.source_message_id) if req.source_message_id else None,
    )
    return SavedNoteResponse(
        id=str(note.id),
        notebook_id=str(note.notebook_id),
        source_message_id=str(note.source_message_id) if note.source_message_id else None,
        content=note.content,
        created_at=note.created_at,
    )


@router.get('', response_model=list[SavedNoteResponse])
async def list_notes(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    notes = await note_service.list_notes(db, uuid.UUID(notebook_id), user.id)
    return [
        SavedNoteResponse(
            id=str(n.id),
            notebook_id=str(n.notebook_id),
            source_message_id=str(n.source_message_id) if n.source_message_id else None,
            content=n.content,
            created_at=n.created_at,
        )
        for n in notes
    ]


@router.patch('/{note_id}', response_model=SavedNoteResponse)
async def update_note(
    notebook_id: str,
    note_id: str,
    req: UpdateNoteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    note = await note_service.update_note(db, uuid.UUID(note_id), req.content)
    if not note:
        raise HTTPException(status_code=404, detail='Note not found')
    return SavedNoteResponse(
        id=str(note.id),
        notebook_id=str(note.notebook_id),
        source_message_id=str(note.source_message_id) if note.source_message_id else None,
        content=note.content,
        created_at=note.created_at,
    )


@router.delete('/{note_id}')
async def delete_note(
    notebook_id: str,
    note_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    success = await note_service.delete_note(db, uuid.UUID(note_id))
    if not success:
        raise HTTPException(status_code=404, detail='Note not found')
    return {'data': {'message': 'Note deleted'}}
