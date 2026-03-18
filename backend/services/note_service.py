import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.saved_note import SavedNote


async def create_note(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    content: str,
    user_id: uuid.UUID | None = None,
    source_message_id: uuid.UUID | None = None,
) -> SavedNote:
    note = SavedNote(
        notebook_id=notebook_id,
        user_id=user_id,
        source_message_id=source_message_id,
        content=content,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return note


async def list_notes(db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID) -> list[SavedNote]:
    result = await db.execute(
        select(SavedNote)
        .where(SavedNote.notebook_id == notebook_id, SavedNote.user_id == user_id)
        .order_by(SavedNote.created_at.desc())
    )
    return list(result.scalars().all())


async def update_note(db: AsyncSession, note_id: uuid.UUID, content: str) -> SavedNote | None:
    result = await db.execute(select(SavedNote).where(SavedNote.id == note_id))
    note = result.scalar_one_or_none()
    if note is None:
        return None
    note.content = content
    await db.commit()
    await db.refresh(note)
    return note


async def delete_note(db: AsyncSession, note_id: uuid.UUID) -> bool:
    result = await db.execute(select(SavedNote).where(SavedNote.id == note_id))
    note = result.scalar_one_or_none()
    if note is None:
        return False
    await db.delete(note)
    await db.commit()
    return True
