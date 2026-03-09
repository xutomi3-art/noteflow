import os
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.user import User
from backend.schemas.source import SourceResponse
from backend.services import source_service, permission_service
from backend.services.document_pipeline import process_document
from backend.services.event_bus import event_bus

router = APIRouter(prefix='/notebooks/{notebook_id}/sources', tags=['sources'])

ALLOWED_TYPES = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    'text/csv': 'csv',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
}

EXT_MAP = {
    '.pdf': 'pdf',
    '.docx': 'docx',
    '.pptx': 'pptx',
    '.txt': 'txt',
    '.md': 'md',
    '.xlsx': 'xlsx',
    '.xls': 'xls',
    '.csv': 'csv',
    '.jpg': 'jpg',
    '.jpeg': 'jpg',
    '.png': 'png',
    '.webp': 'webp',
    '.gif': 'gif',
    '.bmp': 'bmp',
}


def _detect_file_type(filename: str, content_type: str | None) -> str | None:
    if content_type and content_type in ALLOWED_TYPES:
        return ALLOWED_TYPES[content_type]
    ext = os.path.splitext(filename)[1].lower()
    return EXT_MAP.get(ext)


@router.post('', response_model=SourceResponse)
async def upload_source(
    notebook_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SourceResponse:
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'upload'):
        raise HTTPException(status_code=403, detail='No permission to upload sources')

    file_type = _detect_file_type(file.filename or '', file.content_type)
    if file_type is None:
        raise HTTPException(status_code=400, detail='Unsupported file type. Allowed: PDF, DOCX, PPTX, TXT, MD, XLSX, XLS, CSV, JPG, PNG, WEBP')

    content = await file.read()
    file_size = len(content)

    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if file_size > max_bytes:
        raise HTTPException(status_code=400, detail=f'File too large. Maximum: {settings.MAX_FILE_SIZE_MB}MB')

    upload_dir = os.path.join(settings.UPLOAD_DIR, notebook_id)
    os.makedirs(upload_dir, exist_ok=True)

    source_id = str(uuid.uuid4())
    file_ext = os.path.splitext(file.filename or 'document')[1]
    local_filename = f'{source_id}{file_ext}'
    file_path = os.path.join(upload_dir, local_filename)

    with open(file_path, 'wb') as f:
        f.write(content)

    source = await source_service.create_source(
        db,
        notebook_id=uuid.UUID(notebook_id),
        uploaded_by=user.id,
        filename=file.filename or 'document',
        file_type=file_type,
        file_size=file_size,
        storage_url=file_path,
    )

    background_tasks.add_task(
        process_document,
        source_id=str(source.id),
        notebook_id=notebook_id,
        file_path=file_path,
        filename=file.filename or 'document',
        file_type=file_type,
    )

    return SourceResponse(
        id=str(source.id),
        notebook_id=str(source.notebook_id),
        filename=source.filename,
        file_type=source.file_type,
        file_size=source.file_size,
        status=source.status,
        error_message=source.error_message,
        created_at=source.created_at,
    )


@router.get('', response_model=list[SourceResponse])
async def list_sources(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SourceResponse]:
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    sources = await source_service.list_sources(db, uuid.UUID(notebook_id))
    return [
        SourceResponse(
            id=str(s.id),
            notebook_id=str(s.notebook_id),
            filename=s.filename,
            file_type=s.file_type,
            file_size=s.file_size,
            status=s.status,
            error_message=s.error_message,
            created_at=s.created_at,
        )
        for s in sources
    ]


@router.delete('/{source_id}')
async def delete_source(
    notebook_id: str,
    source_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'delete_source'):
        raise HTTPException(status_code=403, detail='No permission to delete sources')

    source = await source_service.get_source(db, uuid.UUID(source_id))
    if source is None or str(source.notebook_id) != notebook_id:
        raise HTTPException(status_code=404, detail='Source not found')

    if source.ragflow_dataset_id and source.ragflow_doc_id:
        from backend.services.ragflow_client import ragflow_client
        await ragflow_client.delete_document(source.ragflow_dataset_id, source.ragflow_doc_id)

    if source.storage_url and os.path.exists(source.storage_url):
        os.remove(source.storage_url)

    await source_service.delete_source(db, uuid.UUID(source_id))
    return {'data': {'message': 'Source deleted'}}


@router.get('/{source_id}/file')
async def get_source_file(
    notebook_id: str,
    source_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    source = await source_service.get_source(db, uuid.UUID(source_id))
    if source is None or str(source.notebook_id) != notebook_id:
        raise HTTPException(status_code=404, detail='Source not found')

    if not source.storage_url or not os.path.exists(source.storage_url):
        raise HTTPException(status_code=404, detail='File not found on disk')

    from urllib.parse import quote
    encoded_name = quote(source.filename)
    return FileResponse(
        path=source.storage_url,
        media_type='application/pdf',
        headers={'Content-Disposition': f"inline; filename*=UTF-8''{encoded_name}"},
    )


@router.get('/status')
async def source_status_stream(
    notebook_id: str,
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    return StreamingResponse(
        event_bus.stream(notebook_id),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )
