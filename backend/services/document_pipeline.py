import asyncio
import logging
import os
import uuid

from sqlalchemy import select

from backend.core.database import async_session
from backend.models.notebook import Notebook
from backend.services.event_bus import event_bus
from backend.services.excel_service import ingest_excel
from backend.services.mineru_client import mineru_client
from backend.services.ragflow_client import ragflow_client
from backend.services.source_service import get_source, update_source_status

logger = logging.getLogger(__name__)


async def _notify(
    notebook_id: str, source_id: str, status: str, error: str | None = None
) -> None:
    """Push status update via SSE."""
    await event_bus.publish(
        notebook_id,
        {
            "type": "source_status",
            "source_id": source_id,
            "status": status,
            "error": error,
        },
    )


async def _ensure_dataset(
    db: "AsyncSession", notebook_id: uuid.UUID  # noqa: F821
) -> str | None:
    """Ensure notebook has a RAGFlow dataset. Create if needed."""
    result = await db.execute(select(Notebook).where(Notebook.id == notebook_id))
    notebook = result.scalar_one_or_none()
    if notebook is None:
        return None

    if notebook.ragflow_dataset_id:
        return notebook.ragflow_dataset_id

    dataset_id = await ragflow_client.create_dataset(f"notebook-{notebook_id}")
    if dataset_id:
        notebook.ragflow_dataset_id = dataset_id
        await db.commit()
        return dataset_id
    return None


async def _read_text_file(file_path: str) -> str:
    """Read TXT/MD file directly."""
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


async def process_document(
    source_id: str,
    notebook_id: str,
    file_path: str,
    filename: str,
    file_type: str,
) -> None:
    """Main pipeline: parse document -> upload to RAGFlow -> trigger indexing."""
    sid = uuid.UUID(source_id)
    nid = uuid.UUID(notebook_id)

    async with async_session() as db:
        try:
            # Step 1: Update status to parsing
            await update_source_status(db, sid, "parsing")
            await _notify(notebook_id, source_id, "parsing")

            # Step 2: Route Excel/CSV to DuckDB pipeline (skip MinerU/RAGFlow)
            if file_type in ("xlsx", "xls", "csv"):
                duckdb_path = await ingest_excel(sid, file_path)
                await update_source_status(db, sid, "ready", duckdb_path=duckdb_path)
                await _notify(notebook_id, source_id, "ready")
                logger.info("Excel ingestion complete: %s", filename)
                return

            # Step 3: Parse document to markdown/text
            if file_type in ("txt", "md"):
                content = await _read_text_file(file_path)
            else:
                # Use MinerU for PDF, DOCX, PPTX
                content = await mineru_client.parse_document(file_path, filename)
                if content is None:
                    # Fallback: upload raw file to RAGFlow (it has built-in parsers)
                    logger.warning(
                        "MinerU unavailable, falling back to RAGFlow parsing for %s",
                        filename,
                    )
                    content = None  # Signal to upload raw file

            # Step 4: Upload to RAGFlow
            await update_source_status(db, sid, "vectorizing")
            await _notify(notebook_id, source_id, "vectorizing")

            dataset_id = await _ensure_dataset(db, nid)
            if dataset_id is None:
                # RAGFlow not available - mark as ready anyway for demo purposes
                logger.warning(
                    "RAGFlow unavailable, marking source as ready without vectorization"
                )
                await update_source_status(db, sid, "ready")
                await _notify(notebook_id, source_id, "ready")
                return

            # Upload to RAGFlow
            if content is not None:
                # Upload parsed markdown as .md file
                md_filename = os.path.splitext(filename)[0] + ".md"
                doc_id = await ragflow_client.upload_document(
                    dataset_id, md_filename, content.encode("utf-8")
                )
            else:
                # Upload raw file
                with open(file_path, "rb") as f:
                    doc_id = await ragflow_client.upload_document(
                        dataset_id, filename, f.read()
                    )

            if doc_id is None:
                raise Exception("Failed to upload document to RAGFlow")

            # Update source with RAGFlow IDs
            await update_source_status(
                db,
                sid,
                "vectorizing",
                ragflow_dataset_id=dataset_id,
                ragflow_doc_id=doc_id,
            )

            # Trigger RAGFlow parsing/chunking/embedding
            success = await ragflow_client.parse_document(dataset_id, doc_id)
            if not success:
                raise Exception("Failed to trigger RAGFlow parsing")

            # Poll for completion (max 5 minutes)
            for _ in range(60):
                await asyncio.sleep(5)
                doc_status = await ragflow_client.get_document_status(dataset_id, doc_id)
                if doc_status is None:
                    continue
                run = doc_status.get("run", "UNSTART")
                chunks = doc_status.get("chunk_count", 0)
                # RAGFlow v0.17 bug: run stays "RUNNING" after completion.
                # Use chunk_count > 0 as the real completion signal.
                if run in ("DONE", "SUCCEEDED") or chunks > 0:
                    logger.info("RAGFlow done for %s: run=%s, chunks=%d", filename, run, chunks)
                    break
                if run in ("FAIL", "FAILED", "CANCEL"):
                    raise Exception(
                        f"RAGFlow parsing failed with status: {run}"
                    )
            else:
                logger.warning(
                    "RAGFlow parsing timed out for %s, marking as ready", filename
                )

            # Step 5: Mark as ready
            await update_source_status(db, sid, "ready")
            await _notify(notebook_id, source_id, "ready")
            logger.info("Document processing complete: %s", filename)

        except Exception as e:
            logger.error("Document pipeline failed for %s: %s", filename, e)
            async with async_session() as err_db:
                await update_source_status(
                    err_db, sid, "failed", error_message=str(e)
                )
            await _notify(notebook_id, source_id, "failed", error=str(e))
