import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func, delete, literal, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.notebook import Notebook
from backend.models.notebook_member import NotebookMember
from backend.models.source import Source
from backend.schemas.notebook import NotebookCreate, NotebookUpdate, NotebookResponse


async def create_notebook(db: AsyncSession, owner_id: uuid.UUID, req: NotebookCreate) -> Notebook:
    notebook = Notebook(
        name=req.name,
        emoji=req.emoji,
        cover_color=req.cover_color,
        owner_id=owner_id,
        is_shared=req.is_team,
    )
    db.add(notebook)
    await db.commit()
    await db.refresh(notebook)
    return notebook


async def list_notebooks(db: AsyncSession, user_id: uuid.UUID) -> list[NotebookResponse]:
    # Subquery: member count per notebook
    member_count_subq = (
        select(NotebookMember.notebook_id, func.count(NotebookMember.user_id).label("member_count"))
        .group_by(NotebookMember.notebook_id)
        .subquery()
    )

    # Owned notebooks
    owned_stmt = (
        select(
            Notebook,
            func.count(Source.id).label("source_count"),
            literal("owner").label("user_role"),
            func.coalesce(member_count_subq.c.member_count, 1).label("member_count"),
        )
        .outerjoin(Source, Source.notebook_id == Notebook.id)
        .outerjoin(member_count_subq, member_count_subq.c.notebook_id == Notebook.id)
        .where(Notebook.owner_id == user_id)
        .group_by(Notebook.id, member_count_subq.c.member_count)
    )
    owned_result = await db.execute(owned_stmt)
    owned_rows = owned_result.all()

    # Shared notebooks (where user is a member but not owner)
    shared_stmt = (
        select(
            Notebook,
            func.count(Source.id).label("source_count"),
            NotebookMember.role.label("user_role"),
            func.coalesce(member_count_subq.c.member_count, 1).label("member_count"),
        )
        .join(NotebookMember, NotebookMember.notebook_id == Notebook.id)
        .outerjoin(Source, Source.notebook_id == Notebook.id)
        .outerjoin(member_count_subq, member_count_subq.c.notebook_id == Notebook.id)
        .where(NotebookMember.user_id == user_id)
        .group_by(Notebook.id, NotebookMember.role, member_count_subq.c.member_count)
    )
    shared_result = await db.execute(shared_stmt)
    shared_rows = shared_result.all()

    all_rows = owned_rows + shared_rows
    all_rows.sort(key=lambda row: row[0].updated_at, reverse=True)

    return [
        NotebookResponse(
            id=str(nb.id),
            name=nb.name,
            emoji=nb.emoji,
            cover_color=nb.cover_color,
            owner_id=str(nb.owner_id),
            is_shared=nb.is_shared,
            user_role=role,
            source_count=source_count,
            member_count=member_count,
            created_at=nb.created_at,
            updated_at=nb.updated_at,
        )
        for nb, source_count, role, member_count in all_rows
    ]


async def get_notebook(db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID) -> Notebook:
    """Get a notebook if user is owner or member."""
    # Check ownership first
    result = await db.execute(
        select(Notebook).where(Notebook.id == notebook_id, Notebook.owner_id == user_id)
    )
    notebook = result.scalar_one_or_none()
    if notebook:
        return notebook

    # Check membership
    result = await db.execute(
        select(Notebook)
        .join(NotebookMember, NotebookMember.notebook_id == Notebook.id)
        .where(Notebook.id == notebook_id, NotebookMember.user_id == user_id)
    )
    notebook = result.scalar_one_or_none()
    if not notebook:
        raise ValueError("Notebook not found")
    return notebook


async def update_notebook(db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID, req: NotebookUpdate) -> Notebook:
    notebook = await get_notebook(db, notebook_id, user_id)
    if req.name is not None:
        notebook.name = req.name
    if req.emoji is not None:
        notebook.emoji = req.emoji
    if req.cover_color is not None:
        notebook.cover_color = req.cover_color
    notebook.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(notebook)
    return notebook


async def delete_notebook(db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID) -> None:
    notebook = await get_notebook(db, notebook_id, user_id)
    await db.delete(notebook)
    await db.commit()
