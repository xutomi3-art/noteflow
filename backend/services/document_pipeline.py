import asyncio
import logging
import os
import uuid

from sqlalchemy import select

from backend.core.database import async_session
from backend.models.notebook import Notebook
from backend.services.event_bus import event_bus
from backend.services.excel_service import ingest_excel, excel_to_markdown
from backend.services.mineru_client import mineru_client
from backend.services.ragflow_client import ragflow_client
from backend.services.asr_service import asr_service, AUDIO_EXTENSIONS
from backend.services.qwen_client import qwen_client, IMAGE_EXTENSIONS
from backend.services.source_service import get_source, update_source_status

logger = logging.getLogger(__name__)


def _save_parsed_content(file_path: str, content: str) -> str:
    """Save parsed markdown content alongside the source file."""
    md_path = os.path.splitext(file_path)[0] + "_parsed.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(content)
    logger.info("Saved parsed content to %s (%d chars)", md_path, len(content))
    return md_path


def _convert_to_pdf(file_path: str) -> str | None:
    """Convert PPTX/DOCX to PDF using LibreOffice. Returns PDF path or None."""
    import subprocess
    out_dir = os.path.dirname(file_path)
    try:
        result = subprocess.run(
            ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, file_path],
            capture_output=True, timeout=120,
        )
        if result.returncode == 0:
            pdf_path = os.path.splitext(file_path)[0] + ".pdf"
            if os.path.exists(pdf_path):
                logger.info("Converted %s to PDF: %s", file_path, pdf_path)
                return pdf_path
        logger.warning("LibreOffice conversion failed: %s", result.stderr.decode(errors="replace"))
    except Exception as e:
        logger.warning("LibreOffice conversion error: %s", e)
    return None


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

            # Step 2: Excel/CSV — dual track: DuckDB (SQL) + RAGFlow (semantic)
            if file_type in ("xlsx", "xls", "csv"):
                # Track 1: DuckDB for structured SQL queries
                duckdb_path = await ingest_excel(sid, file_path)
                await update_source_status(db, sid, "vectorizing", duckdb_path=duckdb_path)
                await _notify(notebook_id, source_id, "vectorizing")
                logger.info("Excel DuckDB ingestion complete: %s", filename)

                # Track 2: Convert to markdown for RAGFlow semantic search
                content = excel_to_markdown(file_path)
                logger.info("Excel to markdown: %s (%d chars)", filename, len(content))
                _save_parsed_content(file_path, content)
                # Fall through to RAGFlow upload below

            # Step 2b: Route audio to ASR pipeline
            elif file_type in AUDIO_EXTENSIONS:
                logger.info("Processing audio via ASR: %s", filename)
                transcript = await asr_service.transcribe_file(file_path)

                # Save transcript as markdown
                md_path = file_path.rsplit(".", 1)[0] + ".md"
                header = f"# Audio Transcript: {filename}\n\n"
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(header + transcript)

                content = header + transcript
                logger.info(
                    "ASR transcription complete: %s (%d chars)", filename, len(content)
                )

            # Step 2c: Route images to Qwen-VL pipeline
            elif file_type in IMAGE_EXTENSIONS:
                logger.info("Processing image via Qwen-VL: %s", filename)
                content = await qwen_client.analyze_image(file_path, filename)
                # Save extracted text as .md alongside the image
                md_path = file_path.rsplit(".", 1)[0] + ".md"
                header = f"# Image: {filename}\n\n"
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(header + content)
                # Continue to RAGFlow vectorization with the extracted text
                # (content variable is set, will be uploaded as .md)

            # Step 3: Parse document to markdown/text
            elif file_type in ("txt", "md"):
                content = await _read_text_file(file_path)
                _save_parsed_content(file_path, content)
            else:
                # Use MinerU for PDF, DOCX, PPTX
                content = await mineru_client.parse_document(file_path, filename)
                if content is not None:
                    _save_parsed_content(file_path, content)
                if content is None:
                    # Fallback: upload raw file to RAGFlow (it has built-in parsers)
                    logger.warning(
                        "MinerU unavailable, falling back to RAGFlow parsing for %s",
                        filename,
                    )
                    content = None  # Signal to upload raw file

            # Step 3b: Convert PPTX/DOCX to PDF for inline viewing
            if file_type in ("pptx", "docx"):
                _convert_to_pdf(file_path)

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


async def recover_stuck_sources() -> None:
    """Recover sources stuck in processing states after a backend restart.

    Checks RAGFlow for actual status and updates accordingly.
    """
    from backend.models.source import Source

    logger.info("recover_stuck_sources: checking for stuck sources...")
    async with async_session() as db:
        result = await db.execute(
            select(Source).where(Source.status.in_(["uploading", "parsing", "vectorizing"]))
        )
        stuck = list(result.scalars().all())
        if not stuck:
            logger.info("recover_stuck_sources: no stuck sources found")
            return

        logger.info("Found %d stuck sources, checking RAGFlow status...", len(stuck))
        for source in stuck:
            try:
                if not source.ragflow_dataset_id or not source.ragflow_doc_id:
                    # No RAGFlow IDs — was stuck before reaching RAGFlow, mark failed
                    await update_source_status(
                        db, source.id, "failed", error_message="Interrupted during processing"
                    )
                    logger.info("Marked %s as failed (no RAGFlow IDs)", source.filename)
                    continue

                doc_status = await ragflow_client.get_document_status(
                    source.ragflow_dataset_id, source.ragflow_doc_id
                )
                if doc_status is None:
                    await update_source_status(
                        db, source.id, "failed", error_message="RAGFlow document not found"
                    )
                    logger.info("Marked %s as failed (not found in RAGFlow)", source.filename)
                    continue

                run = doc_status.get("run", "UNSTART")
                chunks = doc_status.get("chunk_count", 0)

                if run in ("DONE", "SUCCEEDED") or chunks > 0:
                    await update_source_status(db, source.id, "ready")
                    logger.info("Recovered %s → ready (run=%s, chunks=%d)", source.filename, run, chunks)
                elif run in ("FAIL", "FAILED", "CANCEL"):
                    await update_source_status(
                        db, source.id, "failed", error_message=f"RAGFlow status: {run}"
                    )
                    logger.info("Marked %s as failed (RAGFlow %s)", source.filename, run)
                else:
                    # Still processing in RAGFlow — spawn a background poll
                    logger.info("Source %s still processing in RAGFlow (run=%s), spawning poll...", source.filename, run)
                    asyncio.create_task(_poll_and_update(source, db))
            except Exception as e:
                logger.error("Error recovering source %s: %s", source.filename, e)


async def _poll_and_update(source: "Source", db: "AsyncSession") -> None:
    """Poll RAGFlow for a stuck source until done or timeout."""
    from backend.models.source import Source

    for _ in range(60):
        await asyncio.sleep(5)
        try:
            doc_status = await ragflow_client.get_document_status(
                source.ragflow_dataset_id, source.ragflow_doc_id
            )
            if doc_status is None:
                continue
            run = doc_status.get("run", "UNSTART")
            chunks = doc_status.get("chunk_count", 0)
            if run in ("DONE", "SUCCEEDED") or chunks > 0:
                async with async_session() as fresh_db:
                    await update_source_status(fresh_db, source.id, "ready")
                logger.info("Poll recovered %s → ready", source.filename)
                return
            if run in ("FAIL", "FAILED", "CANCEL"):
                async with async_session() as fresh_db:
                    await update_source_status(
                        fresh_db, source.id, "failed", error_message=f"RAGFlow: {run}"
                    )
                return
        except Exception:
            pass

    # Timed out — mark as failed
    async with async_session() as fresh_db:
        await update_source_status(
            fresh_db, source.id, "failed", error_message="Recovery poll timed out"
        )
    logger.warning("Recovery poll timed out for %s", source.filename)
