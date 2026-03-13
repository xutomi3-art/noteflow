import os
import uuid

from pydantic import BaseModel
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
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/flac': 'flac',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
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
    '.mp3': 'mp3',
    '.wav': 'wav',
    '.m4a': 'm4a',
    '.flac': 'flac',
    '.ogg': 'ogg',
    '.webm': 'webm',
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
        raise HTTPException(status_code=400, detail='Unsupported file type. Allowed: PDF, DOCX, PPTX, TXT, MD, XLSX, XLS, CSV, JPG, PNG, WEBP, MP3, WAV, M4A, FLAC, OGG, WEBM')

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


class UrlSourceRequest(BaseModel):
    url: str


@router.post('/url', response_model=SourceResponse)
async def add_url_source(
    notebook_id: str,
    body: UrlSourceRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SourceResponse:
    """Add a webpage URL as a source by scraping its content."""
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'upload'):
        raise HTTPException(status_code=403, detail='No permission to upload sources')

    from backend.services.web_scraper import scrape_url
    from urllib.parse import urlparse

    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail='URL is required')

    # Basic URL validation
    parsed = urlparse(url if '://' in url else 'https://' + url)
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail='Invalid URL')

    try:
        title, content = await scrape_url(url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'Failed to fetch URL: {str(e)}')

    # Save content as a .md file
    upload_dir = os.path.join(settings.UPLOAD_DIR, notebook_id)
    os.makedirs(upload_dir, exist_ok=True)

    source_id = str(uuid.uuid4())
    local_filename = f'{source_id}.md'
    file_path = os.path.join(upload_dir, local_filename)

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    file_size = len(content.encode('utf-8'))
    display_name = f'{title[:60]}.md' if len(title) > 60 else f'{title}.md'

    source = await source_service.create_source(
        db,
        notebook_id=uuid.UUID(notebook_id),
        uploaded_by=user.id,
        filename=display_name,
        file_type='md',
        file_size=file_size,
        storage_url=file_path,
    )

    background_tasks.add_task(
        process_document,
        source_id=str(source.id),
        notebook_id=notebook_id,
        file_path=file_path,
        filename=display_name,
        file_type='md',
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
    token: str | None = None,
    request: "Request" = None,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Serve source file. Accepts Bearer header OR ?token= query param for inline viewer."""
    from fastapi import Request
    from sqlalchemy import select as sa_select
    from backend.core.security import decode_token
    from backend.models.user import User as UserModel

    # Extract token from Bearer header or query param
    auth_token = token
    if not auth_token and request:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            auth_token = auth_header[7:]

    if not auth_token:
        raise HTTPException(status_code=401, detail='Authentication required')

    payload = decode_token(auth_token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail='Invalid token')

    user_id = payload.get("sub")
    result = await db.execute(sa_select(UserModel).where(UserModel.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail='User not found')

    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    source = await source_service.get_source(db, uuid.UUID(source_id))
    if source is None or str(source.notebook_id) != notebook_id:
        raise HTTPException(status_code=404, detail='Source not found')

    if not source.storage_url or not os.path.exists(source.storage_url):
        raise HTTPException(status_code=404, detail='File not found on disk')

    # For PPTX/DOCX: serve the converted PDF if available
    serve_path = source.storage_url
    if source.file_type in ('pptx', 'docx'):
        pdf_path = os.path.splitext(source.storage_url)[0] + '.pdf'
        if os.path.exists(pdf_path):
            serve_path = pdf_path

    # Determine media_type from the actual file being served
    ext = os.path.splitext(serve_path)[1].lower()
    mime_map = {
        '.pdf': 'application/pdf',
        '.txt': 'text/plain; charset=utf-8',
        '.md': 'text/plain; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.csv': 'text/csv; charset=utf-8',
    }
    media_type = mime_map.get(ext, 'application/octet-stream')

    from urllib.parse import quote
    encoded_name = quote(source.filename)
    return FileResponse(
        path=serve_path,
        media_type=media_type,
        headers={'Content-Disposition': f"inline; filename*=UTF-8''{encoded_name}"},
    )


@router.get('/{source_id}/content')
async def get_source_content(
    notebook_id: str,
    source_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return the parsed markdown content of a source."""
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, 'view'):
        raise HTTPException(status_code=403, detail='No access to this notebook')

    source = await source_service.get_source(db, uuid.UUID(source_id))
    if source is None or str(source.notebook_id) != notebook_id:
        raise HTTPException(status_code=404, detail='Source not found')

    if not source.storage_url:
        raise HTTPException(status_code=404, detail='Source file not found')

    # Try to find parsed content file
    base_path = os.path.splitext(source.storage_url)[0]

    # Check various parsed content locations
    parsed_paths = [
        base_path + "_parsed.md",  # Standard parsed content
        base_path + ".md",          # Image-extracted or original md
    ]

    # For txt/md files, the original file IS the content
    if source.file_type in ('txt', 'md'):
        parsed_paths.insert(0, source.storage_url)

    content = None
    for path in parsed_paths:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            break

    # Fallback: reconstruct content from RAGFlow chunks
    if content is None and source.ragflow_dataset_id and source.ragflow_doc_id:
        from backend.services.ragflow_client import ragflow_client
        chunks = await ragflow_client.list_chunks(
            source.ragflow_dataset_id, source.ragflow_doc_id
        )
        if chunks:
            content = "\n\n".join(
                c.get("content", "") for c in chunks if c.get("content")
            )
            # Cache for future requests
            if content:
                try:
                    md_path = base_path + "_parsed.md"
                    with open(md_path, "w", encoding="utf-8") as f:
                        f.write(content)
                except Exception:
                    pass

    if content is None:
        return {'content': None, 'message': 'Parsed content not available yet'}

    return {'content': content, 'filename': source.filename, 'file_type': source.file_type}


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
