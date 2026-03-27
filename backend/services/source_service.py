import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.source import Source
from backend.services.ragflow_client import ragflow_client


async def create_source(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    uploaded_by: uuid.UUID,
    filename: str,
    file_type: str,
    file_size: int,
    storage_url: str,
) -> Source:
    source = Source(
        notebook_id=notebook_id,
        uploaded_by=uploaded_by,
        filename=filename,
        file_type=file_type,
        file_size=file_size,
        storage_url=storage_url,
        status="uploading",
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


async def list_sources(db: AsyncSession, notebook_id: uuid.UUID) -> list[Source]:
    result = await db.execute(
        select(Source)
        .where(Source.notebook_id == notebook_id)
        .order_by(Source.created_at.desc())
    )
    return list(result.scalars().all())


async def get_source(db: AsyncSession, source_id: uuid.UUID) -> Source | None:
    result = await db.execute(select(Source).where(Source.id == source_id))
    return result.scalar_one_or_none()


async def update_source_status(
    db: AsyncSession,
    source_id: uuid.UUID,
    status: str,
    error_message: str | None = None,
    ragflow_dataset_id: str | None = None,
    ragflow_doc_id: str | None = None,
    duckdb_path: str | None = None,
    retry_count: int | None = None,
    progress: float | None = None,
) -> Source | None:
    source = await get_source(db, source_id)
    if source is None:
        return None
    source.status = status
    if progress is not None:
        source.progress = progress
    if error_message is not None:
        source.error_message = error_message
    if ragflow_dataset_id is not None:
        source.ragflow_dataset_id = ragflow_dataset_id
    if ragflow_doc_id is not None:
        source.ragflow_doc_id = ragflow_doc_id
    if duckdb_path is not None:
        source.duckdb_path = duckdb_path
    if retry_count is not None:
        source.retry_count = retry_count
    await db.commit()
    await db.refresh(source)
    return source


async def delete_source(db: AsyncSession, source_id: uuid.UUID) -> bool:
    source = await get_source(db, source_id)
    if source is None:
        return False
    # Remove from RAGFlow so deleted sources no longer appear in AI responses
    if source.ragflow_dataset_id and source.ragflow_doc_id:
        try:
            await ragflow_client.delete_document(source.ragflow_dataset_id, source.ragflow_doc_id)
        except Exception:
            pass  # Don't block deletion if RAGFlow call fails
    await db.delete(source)
    await db.commit()
    return True
