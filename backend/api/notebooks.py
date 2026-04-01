import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.user import User
from backend.schemas.notebook import NotebookCreate, NotebookUpdate, NotebookResponse
from backend.services import notebook_service, permission_service

router = APIRouter(prefix='/notebooks', tags=['notebooks'])


@router.post('', response_model=NotebookResponse)
async def create_notebook(
    req: NotebookCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    notebook = await notebook_service.create_notebook(db, user.id, req)
    return NotebookResponse(
        id=str(notebook.id),
        name=notebook.name,
        emoji=notebook.emoji,
        cover_color=notebook.cover_color,
        owner_id=str(notebook.owner_id),
        is_shared=notebook.is_shared,
            shared_chat=notebook.shared_chat,
        user_role='owner',
        source_count=0,
        created_at=notebook.created_at,
        updated_at=notebook.updated_at,
    )


@router.get('', response_model=list[NotebookResponse])
async def list_notebooks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await notebook_service.list_notebooks(db, user.id)


@router.get('/{notebook_id}', response_model=NotebookResponse)
async def get_notebook(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        notebook = await notebook_service.get_notebook(db, uuid.UUID(notebook_id), user.id, touch=True)
        role = await permission_service.get_user_role(db, uuid.UUID(notebook_id), user.id)
        return NotebookResponse(
            id=str(notebook.id),
            name=notebook.name,
            emoji=notebook.emoji,
            cover_color=notebook.cover_color,
            owner_id=str(notebook.owner_id),
            is_shared=notebook.is_shared,
            shared_chat=notebook.shared_chat,
            user_role=role or 'owner',
            source_count=0,
            created_at=notebook.created_at,
            updated_at=notebook.updated_at,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail='Notebook not found')


@router.patch('/{notebook_id}', response_model=NotebookResponse)
async def update_notebook(
    notebook_id: str,
    req: NotebookUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'rename'):
        raise HTTPException(status_code=403, detail='No permission to rename this notebook')
    try:
        notebook = await notebook_service.update_notebook(db, uuid.UUID(notebook_id), user.id, req)
        role = await permission_service.get_user_role(db, uuid.UUID(notebook_id), user.id)
        return NotebookResponse(
            id=str(notebook.id),
            name=notebook.name,
            emoji=notebook.emoji,
            cover_color=notebook.cover_color,
            owner_id=str(notebook.owner_id),
            is_shared=notebook.is_shared,
            shared_chat=notebook.shared_chat,
            user_role=role or 'owner',
            source_count=0,
            created_at=notebook.created_at,
            updated_at=notebook.updated_at,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail='Notebook not found')


@router.patch('/{notebook_id}/shared-chat')
async def toggle_shared_chat(
    notebook_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle shared chat mode for a notebook."""
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'share'):
        raise HTTPException(status_code=403, detail='No permission')
    from backend.models.notebook import Notebook
    nb = await db.get(Notebook, uuid.UUID(notebook_id))
    if not nb:
        raise HTTPException(status_code=404, detail='Notebook not found')
    nb.shared_chat = bool(body.get('enabled', False))
    await db.commit()
    return {'shared_chat': nb.shared_chat}


@router.delete('/{notebook_id}')
async def delete_notebook(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'delete'):
        raise HTTPException(status_code=403, detail='Only the owner can delete this notebook')
    try:
        await notebook_service.delete_notebook(db, uuid.UUID(notebook_id), user.id)
        return {'data': {'message': 'Notebook deleted'}}
    except ValueError:
        raise HTTPException(status_code=404, detail='Notebook not found')
