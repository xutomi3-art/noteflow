import asyncio
import logging
import os
import uuid

from sqlalchemy import select

from backend.core.database import async_session
from backend.models.notebook import Notebook
from backend.services.event_bus import event_bus
from backend.services.mineru_client import mineru_client
from backend.services.ragflow_client import ragflow_client
from backend.services.asr_service import asr_service, AUDIO_EXTENSIONS
from backend.services.qwen_client import qwen_client, IMAGE_EXTENSIONS
from backend.services.source_service import get_source, update_source_status

logger = logging.getLogger(__name__)

# Limit concurrent RAGFlow polling tasks to avoid exhausting the DB connection pool
_poll_semaphore = asyncio.Semaphore(5)

MAX_RETRIES = 3
RETRY_DELAYS = [60, 120, 240]  # seconds — exponential backoff


async def _maybe_trigger_raptor(notebook_id: uuid.UUID) -> None:
    """Trigger Raptor only when ALL sources in the notebook are ready.

    Raptor is a dataset-level full re-clustering operation, so running it
    before all sources are ready wastes resources — every subsequent run
    redoes the entire clustering from scratch.
    """
    from backend.models.source import Source

    try:
        async with async_session() as db:
            result = await db.execute(
                select(Source).where(Source.notebook_id == notebook_id)
            )
            sources = list(result.scalars().all())
            if not sources:
                return

            all_ready = all(s.status == "ready" for s in sources)
            if not all_ready:
                return

            dataset_id = next((s.ragflow_dataset_id for s in sources if s.ragflow_dataset_id), None)
            if not dataset_id:
                return

            logger.info("All %d sources ready in notebook %s, triggering Raptor...", len(sources), notebook_id)
            await event_bus.publish(str(notebook_id), {
                "type": "raptor_status", "status": "running",
            })
            task_id = await ragflow_client.run_raptor(dataset_id)
            if task_id:
                logger.info("Raptor task started: %s", task_id)
                # Poll for Raptor completion in background
                asyncio.create_task(_poll_raptor(str(notebook_id), dataset_id))
            else:
                logger.warning("Raptor not triggered for dataset %s (may already be running)", dataset_id)
                await event_bus.publish(str(notebook_id), {
                    "type": "raptor_status", "status": "idle",
                })
    except Exception as e:
        logger.error("_maybe_trigger_raptor failed: %s", e)


async def _poll_raptor(notebook_id: str, dataset_id: str) -> None:
    """Poll RAGFlow for Raptor task completion and notify frontend."""
    for _ in range(120):  # 120 * 30s = 1 hour max
        await asyncio.sleep(30)
        try:
            status = await ragflow_client.get_raptor_status(dataset_id)
            if status is None:
                continue
            if status in ("done", "completed"):
                logger.info("Raptor completed for dataset %s", dataset_id)
                await event_bus.publish(notebook_id, {
                    "type": "raptor_status", "status": "done",
                })
                return
            if status in ("failed", "error"):
                logger.warning("Raptor failed for dataset %s", dataset_id)
                await event_bus.publish(notebook_id, {
                    "type": "raptor_status", "status": "failed",
                })
                return
        except Exception as e:
            logger.warning("Raptor poll error: %s", e)

    # Timeout
    await event_bus.publish(notebook_id, {
        "type": "raptor_status", "status": "done",
    })


async def _retry_ragflow_upload(
    dataset_id: str,
    old_doc_id: str | None,
    filename: str,
    content: bytes | None,
    file_path: str | None,
    md_filename: str | None,
) -> str | None:
    """Delete failed doc from RAGFlow and re-upload. Returns new doc_id or None."""
    # Delete the old failed document
    if old_doc_id:
        await ragflow_client.delete_document(dataset_id, old_doc_id)
        logger.info("Deleted failed RAGFlow doc %s for retry", old_doc_id)

    # Re-upload
    if content is not None and md_filename:
        return await ragflow_client.upload_document(dataset_id, md_filename, content)
    elif file_path:
        with open(file_path, "rb") as f:
            return await ragflow_client.upload_document(dataset_id, filename, f.read())
    return None


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

            # Step 2: Excel/CSV — upload directly to RAGFlow (native Excel support)
            if file_type in ("xlsx", "xls", "csv"):
                # RAGFlow handles Excel parsing, chunking and vectorization natively
                # with html4excel enabled for better table structure preservation
                logger.info("Excel/CSV will be processed by RAGFlow: %s", filename)
                content = None  # Signal to upload original file to RAGFlow

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

            # Step 2c: Route images to vision LLM pipeline
            elif file_type in IMAGE_EXTENSIONS:
                logger.info("Processing image via vision LLM: %s", filename)
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
            elif file_type in ("pdf", "docx", "pptx"):
                # For PPTX/DOCX: convert to PDF first (MinerU only accepts PDF)
                parse_path = file_path
                if file_type in ("pptx", "docx"):
                    pdf_path = _convert_to_pdf(file_path)
                    if pdf_path:
                        parse_path = pdf_path

                # Use MinerU for high-quality document parsing
                logger.info("Parsing %s via MinerU...", filename)
                parse_name = os.path.splitext(filename)[0] + ".pdf" if parse_path != file_path else filename
                parsed = await mineru_client.parse_document(parse_path, parse_name)
                if parsed:
                    content = parsed
                    _save_parsed_content(file_path, content)
                    logger.info("MinerU parsed %s: %d chars", filename, len(content))
                else:
                    # MinerU failed — fall back to RAGFlow built-in parser
                    logger.warning("MinerU failed for %s, falling back to RAGFlow parser", filename)
                    content = None
            else:
                # Unknown type — upload raw file to RAGFlow
                logger.info("Using RAGFlow built-in parser for %s", filename)
                content = None

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
                await _maybe_trigger_raptor(nid)
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

            # Prepare upload args for potential retries
            upload_content = content.encode("utf-8") if content is not None else None
            upload_md_filename = os.path.splitext(filename)[0] + ".md" if content is not None else None

            # Trigger RAGFlow parsing/chunking/embedding with retry on failure
            retry_count = 0
            while True:
                success = await ragflow_client.parse_document(dataset_id, doc_id)
                if not success:
                    raise Exception("Failed to trigger RAGFlow parsing")

                # Poll for completion (initial wait up to 15 minutes)
                completed = False
                failed_status = None
                for _ in range(180):
                    await asyncio.sleep(5)
                    doc_status = await ragflow_client.get_document_status(dataset_id, doc_id)
                    if doc_status is None:
                        continue
                    run = doc_status.get("run", "UNSTART")
                    chunks = doc_status.get("chunk_count", 0)
                    if run in ("DONE", "SUCCEEDED") or chunks > 0:
                        logger.info("RAGFlow done for %s: run=%s, chunks=%d", filename, run, chunks)
                        completed = True
                        break
                    if run in ("FAIL", "FAILED", "CANCEL"):
                        failed_status = run
                        break

                if completed:
                    await update_source_status(db, sid, "ready")
                    await _notify(notebook_id, source_id, "ready")
                    logger.info("Document processing complete: %s", filename)
                    await _maybe_trigger_raptor(nid)
                    break
                elif failed_status:
                    # RAGFlow failed — retry with backoff if under limit
                    if retry_count < MAX_RETRIES:
                        delay = RETRY_DELAYS[retry_count]
                        retry_count += 1
                        logger.warning(
                            "RAGFlow FAIL for %s (retry %d/%d), waiting %ds before retry",
                            filename, retry_count, MAX_RETRIES, delay,
                        )
                        await update_source_status(
                            db, sid, "vectorizing", retry_count=retry_count,
                            error_message=f"Retrying ({retry_count}/{MAX_RETRIES})...",
                        )
                        await asyncio.sleep(delay)
                        # Delete failed doc and re-upload
                        new_doc_id = await _retry_ragflow_upload(
                            dataset_id, doc_id, filename,
                            upload_content, file_path, upload_md_filename,
                        )
                        if new_doc_id is None:
                            raise Exception(f"Failed to re-upload after retry {retry_count}")
                        doc_id = new_doc_id
                        await update_source_status(
                            db, sid, "vectorizing", ragflow_doc_id=doc_id,
                        )
                        continue  # retry the while loop
                    else:
                        raise Exception(
                            f"RAGFlow parsing failed with status: {failed_status} (after {MAX_RETRIES} retries)"
                        )
                else:
                    # Still processing after 15min — background poll
                    logger.info(
                        "RAGFlow still processing %s after 15min, continuing background poll", filename
                    )
                    asyncio.create_task(_background_poll(sid, dataset_id, doc_id, notebook_id, source_id, filename))
                    break

        except Exception as e:
            logger.error("Document pipeline failed for %s: %s", filename, e)
            async with async_session() as err_db:
                await update_source_status(
                    err_db, sid, "failed", error_message=str(e)
                )
            await _notify(notebook_id, source_id, "failed", error=str(e))


async def _background_poll(
    sid: uuid.UUID,
    dataset_id: str,
    doc_id: str,
    notebook_id: str,
    source_id: str,
    filename: str,
) -> None:
    """Continue polling RAGFlow for large files that exceed the initial 15-min wait.

    Polls every 60s for up to 2 hours. Uses semaphore to limit concurrent DB usage.
    """
    for _ in range(120):  # 120 * 60s = 2 hours
        await asyncio.sleep(60)
        async with _poll_semaphore:
            try:
                doc_status = await ragflow_client.get_document_status(dataset_id, doc_id)
                if doc_status is None:
                    continue
                run = doc_status.get("run", "UNSTART")
                chunks = doc_status.get("chunk_count", 0)
                if run in ("DONE", "SUCCEEDED") or chunks > 0:
                    async with async_session() as db:
                        await update_source_status(db, sid, "ready")
                    await _notify(notebook_id, source_id, "ready")
                    logger.info("Background poll: %s ready (chunks=%d)", filename, chunks)
                    await _maybe_trigger_raptor(uuid.UUID(notebook_id))
                    return
                if run in ("FAIL", "FAILED", "CANCEL"):
                    async with async_session() as db:
                        await update_source_status(db, sid, "failed", error_message=f"RAGFlow: {run}")
                    await _notify(notebook_id, source_id, "failed", error=f"RAGFlow: {run}")
                    logger.error("Background poll: %s failed (run=%s)", filename, run)
                    return
            except Exception as e:
                logger.warning("Background poll error for %s: %s", filename, e)

    # 2 hours exceeded — mark as failed
    async with _poll_semaphore:
        async with async_session() as db:
            await update_source_status(db, sid, "failed", error_message="RAGFlow processing timed out (2h)")
    await _notify(notebook_id, source_id, "failed", error="Processing timed out")
    logger.error("Background poll timed out for %s after 2 hours", filename)


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
                    await _maybe_trigger_raptor(source.notebook_id)
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

    for _ in range(20):  # 20 * 30s = 10 minutes
        await asyncio.sleep(30)
        async with _poll_semaphore:
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
                    await _maybe_trigger_raptor(source.notebook_id)
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
    async with _poll_semaphore:
        async with async_session() as fresh_db:
            await update_source_status(
                fresh_db, source.id, "failed", error_message="Recovery poll timed out"
            )
    logger.warning("Recovery poll timed out for %s", source.filename)
