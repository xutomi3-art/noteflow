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
            custom_prompt=notebook.custom_prompt,
            suggestion_level=notebook.suggestion_level,
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
            custom_prompt=notebook.custom_prompt,
            suggestion_level=notebook.suggestion_level,
            user_role=role or 'owner',
            source_count=0,
            created_at=notebook.created_at,
            updated_at=notebook.updated_at,
            is_just_chat=notebook.is_just_chat,
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
            custom_prompt=notebook.custom_prompt,
            suggestion_level=notebook.suggestion_level,
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


@router.post('/optimize-prompt')
async def optimize_prompt(
    body: dict,
    user: User = Depends(get_current_user),
):
    """Use LLM to optimize a user-written notebook prompt into a better system instruction."""
    raw_prompt = (body.get('prompt') or '').strip()
    if not raw_prompt:
        raise HTTPException(status_code=400, detail='Prompt is required')

    from backend.services.qwen_client import qwen_client

    meta_prompt = """You are an AI prompt engineer. The user has written a custom instruction for an AI knowledge-base assistant.
Your job is to rewrite it into a clear, effective system prompt that:
1. Preserves the user's original intent and role/persona
2. Is structured and unambiguous
3. Adds helpful constraints (tone, length, format) if not specified
4. Is written in the SAME LANGUAGE as the user's input
5. Is concise — no more than 200 words

IMPORTANT: Output ONLY the optimized prompt text. No explanation, no preamble, no markdown fencing."""

    messages = [
        {"role": "system", "content": meta_prompt},
        {"role": "user", "content": f"Please optimize this instruction:\n\n{raw_prompt}"},
    ]

    result = await qwen_client.generate(messages, temperature=0.3, max_tokens=500)

    if result.startswith("[Error"):
        raise HTTPException(status_code=502, detail='AI optimization failed')

    return {'optimized_prompt': result.strip()}


@router.delete('/{notebook_id}')
async def delete_notebook(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'delete'):
        raise HTTPException(status_code=403, detail='Only the owner can delete this notebook')
    from backend.models.notebook import Notebook
    nb = await db.get(Notebook, uuid.UUID(notebook_id))
    if nb and nb.is_just_chat:
        raise HTTPException(status_code=403, detail='Cannot delete Just Chat notebook')
    try:
        await notebook_service.delete_notebook(db, uuid.UUID(notebook_id), user.id)
        return {'data': {'message': 'Notebook deleted'}}
    except ValueError:
        raise HTTPException(status_code=404, detail='Notebook not found')
