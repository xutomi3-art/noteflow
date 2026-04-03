import asyncio
import logging
import os
import uuid

from sqlalchemy import select

from backend.core.config import settings
from backend.core.database import async_session
from backend.models.notebook import Notebook
from backend.models.source import Source
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

            if not settings.RAPTOR_ENABLED:
                logger.info("Raptor disabled, skipping for notebook %s", notebook_id)
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


def _inject_pdf_page_markers(markdown: str, pdf_path: str) -> str:
    """Inject <!-- page:N --> markers into markdown based on PDF page text anchors.

    Uses PyMuPDF to extract unique text anchors from each PDF page, then finds
    where each page's content starts in the markdown and inserts page markers.
    This allows downstream RAGFlow chunks to carry accurate PDF page numbers.
    """
    try:
        import fitz
        import re
    except ImportError:
        logger.warning("PyMuPDF not installed, skipping page marker injection")
        return markdown

    try:
        doc = fitz.open(pdf_path)
        if len(doc) <= 1:
            doc.close()
            return f"<!-- page:1 -->\n{markdown}"

        # Extract unique text anchors from each page (first meaningful line)
        page_anchors: list[tuple[int, str]] = []  # (page_num_1based, anchor_text)
        for page_idx in range(len(doc)):
            page_text = doc[page_idx].get_text()
            # Find the first meaningful line (4+ word chars, not just numbers/spaces)
            for line in page_text.split("\n"):
                clean = line.strip()
                words = [w for w in clean.split() if len(w) >= 3]
                if len(words) >= 2:
                    page_anchors.append((page_idx + 1, clean))
                    break
        doc.close()

        if not page_anchors:
            return markdown

        # Find each anchor's position in the markdown and insert page markers
        # Process from last to first to preserve earlier positions
        insertions: list[tuple[int, int]] = []  # (position_in_markdown, page_num)
        md_lower = markdown.lower()
        for page_num, anchor in page_anchors:
            # Normalize anchor for fuzzy matching
            anchor_words = [w.lower() for w in anchor.split() if len(w) >= 3][:5]
            if not anchor_words:
                continue
            # Search for the first occurrence of anchor words sequence in markdown
            # Use a sliding window approach
            pattern = r".*?".join(re.escape(w) for w in anchor_words)
            match = re.search(pattern, md_lower)
            if match:
                # Find the start of the line containing this match
                line_start = markdown.rfind("\n", 0, match.start())
                pos = line_start + 1 if line_start >= 0 else 0
                insertions.append((pos, page_num))

        # Deduplicate and sort by position (ascending)
        seen_pages: set[int] = set()
        unique_insertions: list[tuple[int, int]] = []
        for pos, page_num in sorted(insertions):
            if page_num not in seen_pages:
                seen_pages.add(page_num)
                unique_insertions.append((pos, page_num))

        # Insert markers from last to first
        result = markdown
        for pos, page_num in reversed(unique_insertions):
            marker = f"<!-- page:{page_num} -->\n"
            result = result[:pos] + marker + result[pos:]

        # Ensure page 1 marker exists at the very start
        if 1 not in seen_pages:
            result = "<!-- page:1 -->\n" + result

        injected_count = len(unique_insertions) + (1 if 1 not in seen_pages else 0)
        logger.info("Injected %d page markers into markdown (%d PDF pages)", injected_count, len(page_anchors))
        return result

    except Exception as e:
        logger.warning("Failed to inject page markers: %s", e)
        return markdown


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


async def _render_and_analyze_pages(pdf_path: str) -> list[str]:
    """Render each PDF page as an image and analyze with Vision LLM.

    Best for PPTX: captures tables/charts pasted as images that
    PyMuPDF extract_image() misses.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("PyMuPDF not installed, skipping page rendering")
        return []

    descriptions: list[str] = []
    try:
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        logger.info("Rendering %d pages for vision analysis: %s", total_pages, pdf_path)

        for page_num in range(total_pages):
            page = doc[page_num]
            # Render at 2x resolution for better OCR
            mat = fitz.Matrix(2.0, 2.0)
            pix = page.get_pixmap(matrix=mat)
            temp_path = f"/tmp/page_render_{page_num}.png"

            try:
                pix.save(temp_path)
                import time as _time
                t_start = _time.time()
                desc = await qwen_client.analyze_image(
                    temp_path,
                    f"slide_{page_num + 1}.png",
                )
                elapsed = round(_time.time() - t_start, 1)

                if desc and len(desc.strip()) > 20 and "analysis failed" not in desc:
                    descriptions.append(
                        f"<!-- page:{page_num + 1} -->\n### Slide {page_num + 1}\n{desc}"
                    )
                    logger.info("Page %d/%d analyzed: %d chars (%.1fs)", page_num + 1, total_pages, len(desc), elapsed)
            except Exception as e:
                logger.warning("Failed to analyze page %d: %s", page_num + 1, e)
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)

        doc.close()
        logger.info("Page rendering complete: %d/%d pages analyzed", len(descriptions), total_pages)
    except Exception as e:
        logger.error("Page rendering failed: %s", e)

    return descriptions


def _extract_pdf_text(pdf_path: str) -> str:
    """Extract text from PDF using PyMuPDF (fallback when MinerU fails)."""
    try:
        import fitz
        doc = fitz.open(pdf_path)
        parts = []
        for page_num in range(len(doc)):
            text = doc[page_num].get_text().strip()
            if text:
                parts.append(f"<!-- page:{page_num + 1} -->\n{text}")
        doc.close()
        result = "\n\n".join(parts)
        if result:
            logger.info("PyMuPDF extracted %d chars of text from %s", len(result), pdf_path)
        return result
    except Exception as e:
        logger.warning("PyMuPDF text extraction failed: %s", e)
        return ""


async def _extract_and_analyze_pdf_images(
    pdf_path: str,
    progress_callback=None,
    max_images: int = 0,
) -> list[str]:
    """Extract large VISIBLE images from PDF and analyze with Vision LLM.

    Uses get_image_info(xrefs=True) to find only VISIBLE images on each page.
    Only images covering >10% of the page are sent to vision LLM.
    Same xref analyzed at most once (dedup across pages).

    progress_callback: async callable(fraction) where fraction is 0.0-1.0 of image analysis progress.
    max_images: stop after analyzing this many images (0 = unlimited).
    """
    try:
        import fitz
    except ImportError:
        logger.warning("PyMuPDF not installed, skipping PDF image extraction")
        return []

    MIN_PAGE_RATIO = 0.20  # Only analyze images covering >20% of page (charts, diagrams, not icons)

    descriptions: list[str] = []
    try:
        import asyncio
        import time as _time

        doc = fitz.open(pdf_path)
        analyzed_xrefs: set[int] = set()
        skipped_small = 0
        total_visible = 0

        # Phase 1: Collect all eligible images (fast, no API calls)
        pending: list[tuple[int, int, float, str]] = []  # (page_num, xref, ratio, temp_path)

        for page_num in range(len(doc)):
            page = doc[page_num]
            page_area = page.rect.width * page.rect.height
            if page_area <= 0:
                continue

            for img_info in page.get_image_info(xrefs=True):
                bbox = img_info.get("bbox")
                info_xref = img_info.get("xref", 0)
                if not bbox or not info_xref:
                    continue

                total_visible += 1

                if info_xref in analyzed_xrefs:
                    continue

                w = bbox[2] - bbox[0]
                h = bbox[3] - bbox[1]
                ratio = (w * h) / page_area
                if ratio < MIN_PAGE_RATIO:
                    skipped_small += 1
                    continue

                try:
                    base_image = doc.extract_image(info_xref)
                except Exception:
                    continue

                image_bytes = base_image["image"]
                if len(image_bytes) < 5000:  # Skip tiny images (< 5KB)
                    skipped_small += 1
                    continue

                if max_images and len(analyzed_xrefs) >= max_images:
                    logger.info("Reached max_images=%d, stopping collection", max_images)
                    break

                analyzed_xrefs.add(info_xref)
                ext = base_image.get("ext", "png")
                temp_path = f"/tmp/pdf_img_{page_num}_{info_xref}.{ext}"
                with open(temp_path, "wb") as f:
                    f.write(image_bytes)
                pending.append((page_num, info_xref, ratio, temp_path))

            if max_images and len(analyzed_xrefs) >= max_images:
                break

        # Phase 1b: Detect pages with vector charts (little text, no embedded images)
        # These pages likely contain charts/graphs drawn as vector paths — render as image
        pages_with_images = {p[0] for p in pending}  # pages already covered by embedded images
        rendered_pages = 0
        for page_num in range(len(doc)):
            if page_num in pages_with_images:
                continue
            page = doc[page_num]
            text = page.get_text("text").strip()
            # Skip pages with substantial text (>200 chars = mostly text content)
            # or completely empty pages
            if len(text) > 200 or len(text) < 10:
                continue
            # This page has very little text — likely a chart/diagram page
            # Render page as image at 150 DPI for Vision analysis
            try:
                pix = page.get_pixmap(dpi=150)
                temp_path = f"/tmp/pdf_page_{page_num}_rendered.png"
                pix.save(temp_path)
                if os.path.getsize(temp_path) > 20000:  # Skip tiny renders
                    pending.append((page_num, 0, 1.0, temp_path))
                    rendered_pages += 1
                else:
                    os.remove(temp_path)
            except Exception as e:
                logger.warning("Failed to render page %d: %s", page_num + 1, e)

        if rendered_pages:
            logger.info("Rendered %d chart-likely pages as images for Vision analysis", rendered_pages)

        doc.close()
        logger.info("PDF image collection: %d to analyze (%d rendered pages), %d skipped, %d visible total",
                     len(pending), rendered_pages, skipped_small, total_visible)

        # Phase 2: Analyze images concurrently (5 at a time)
        CONCURRENCY = 5
        completed = 0

        async def _analyze_one(page_num: int, xref: int, ratio: float, temp_path: str) -> str | None:
            nonlocal completed
            try:
                t_start = _time.time()
                desc = await qwen_client.analyze_image(
                    temp_path, f"page{page_num + 1}_img{xref}.{ext}",
                )
                elapsed = round(_time.time() - t_start, 1)

                if desc and len(desc.strip()) > 20 and "analysis failed" not in desc:
                    logger.info("PDF image p%d xref=%d (%.0f%% of page) analyzed: %d chars (%.1fs)",
                                page_num + 1, xref, ratio * 100, len(desc), elapsed)
                    return f"<!-- page:{page_num + 1} -->\n### Image from Page {page_num + 1}\n{desc}"
                else:
                    logger.info("PDF image p%d xref=%d skipped (empty/failed)", page_num + 1, xref)
                    return None
            except Exception as e:
                logger.warning("Failed to analyze PDF image p%d xref=%d: %s", page_num + 1, xref, e)
                return None
            finally:
                completed += 1
                if os.path.exists(temp_path):
                    os.remove(temp_path)

        # Process in batches of CONCURRENCY
        for i in range(0, len(pending), CONCURRENCY):
            batch = pending[i:i + CONCURRENCY]
            results = await asyncio.gather(*[_analyze_one(*item) for item in batch])
            for r in results:
                if r:
                    descriptions.append(r)

            if progress_callback:
                frac = min(completed / len(pending), 0.95) if pending else 0
                try:
                    await progress_callback(frac)
                except Exception:
                    pass

        logger.info("PDF image extraction: %d analyzed, %d skipped (small), %d visible total",
                     len(descriptions), skipped_small, total_visible)
    except Exception as e:
        logger.error("PDF image extraction failed: %s", e)

    return descriptions


async def _notify(
    notebook_id: str, source_id: str, status: str,
    error: str | None = None, progress: float | None = None,
) -> None:
    """Push status update via SSE."""
    progress_pct = round(progress * 100, 1) if progress is not None else None
    payload: dict = {
        "type": "source_status",
        "source_id": source_id,
        "status": status,
        "error": error,
    }
    if progress_pct is not None:
        payload["progress"] = progress_pct
    await event_bus.publish(notebook_id, payload)


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
            await update_source_status(db, sid, "parsing", progress=5.0)
            await _notify(notebook_id, source_id, "parsing", progress=0.05)

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
                await update_source_status(db, sid, "parsing", progress=10.0)
                await _notify(notebook_id, source_id, "parsing", progress=0.10)
                parse_name = os.path.splitext(filename)[0] + ".pdf" if parse_path != file_path else filename
                parsed = await mineru_client.parse_document(parse_path, parse_name)
                await update_source_status(db, sid, "parsing", progress=15.0)
                await _notify(notebook_id, source_id, "parsing", progress=0.15)

                # Progress callback for image analysis (maps image progress to 15%-85% range)
                # Image analysis is the slowest step, give it most of the progress bar
                async def _img_progress(frac: float) -> None:
                    pct = 15.0 + frac * 70.0  # 15% -> 85%
                    await update_source_status(db, sid, "parsing", progress=pct)
                    await _notify(notebook_id, source_id, "parsing", progress=pct / 100.0)

                if parsed:
                    # Inject PDF page markers into markdown for accurate citation page numbers
                    content = _inject_pdf_page_markers(parsed, parse_path)
                    # Analyze large images with Vision LLM (MinerU extracts text but can't understand charts/diagrams)
                    # Cap at 10 images to avoid 30+ min delays on image-heavy docs
                    image_texts = []
                    if settings.VISION_ENABLED:
                        image_texts = await _extract_and_analyze_pdf_images(
                            parse_path, progress_callback=_img_progress,
                        )
                    if image_texts:
                        content += "\n\n" + "\n\n".join(image_texts)
                        logger.info("Added %d image descriptions to %s", len(image_texts), filename)
                    _save_parsed_content(file_path, content)
                    await update_source_status(db, sid, "parsing", progress=85.0)
                    await _notify(notebook_id, source_id, "parsing", progress=0.85)
                    logger.info("MinerU parsed %s: %d chars", filename, len(content))
                else:
                    # MinerU returned empty — extract text + analyze large images from PDF
                    logger.warning("MinerU returned empty for %s", filename)
                    await update_source_status(db, sid, "parsing", progress=32.0)
                    await _notify(notebook_id, source_id, "parsing", progress=0.32)
                    parts = []

                    # Extract text from PDF (titles, headings, etc.)
                    if parse_path and os.path.exists(parse_path):
                        pdf_text = _extract_pdf_text(parse_path)
                        if pdf_text:
                            parts.append(pdf_text)

                    await update_source_status(db, sid, "parsing", progress=35.0)
                    await _notify(notebook_id, source_id, "parsing", progress=0.35)

                    # Progress callback for fallback image analysis (maps to 35%-40% range)
                    async def _fallback_img_progress(frac: float) -> None:
                        pct = 35.0 + frac * 5.0  # 35% -> 40%
                        await update_source_status(db, sid, "parsing", progress=pct)
                        await _notify(notebook_id, source_id, "parsing", progress=pct / 100.0)

                    # Analyze large visible images with vision LLM
                    if settings.VISION_ENABLED and parse_path and os.path.exists(parse_path):
                        image_texts = await _extract_and_analyze_pdf_images(parse_path, progress_callback=_fallback_img_progress)
                        if image_texts:
                            parts.extend(image_texts)
                            logger.info("Vision extracted %d images for %s", len(image_texts), filename)

                    if parts:
                        content = "\n\n".join(parts)
                        _save_parsed_content(file_path, content)
                        logger.info("Fallback extracted %d chars for %s (text + vision)", len(content), filename)
                    else:
                        content = None
            else:
                # Unknown type — upload raw file to RAGFlow
                logger.info("Using RAGFlow built-in parser for %s", filename)
                content = None

            # Step 4: Upload to RAGFlow
            await update_source_status(db, sid, "vectorizing", progress=88.0)
            await _notify(notebook_id, source_id, "vectorizing", progress=0.88)

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
                # Upload parsed content as .md
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
                last_progress = -1.0
                for _ in range(180):
                    await asyncio.sleep(5)
                    doc_status = await ragflow_client.get_document_status(dataset_id, doc_id)
                    if doc_status is None:
                        continue
                    run = doc_status.get("run", "UNSTART")
                    chunks = doc_status.get("chunk_count", 0)
                    progress = doc_status.get("progress", 0)
                    # Send progress update if changed (avoid spamming)
                    # Scale RAGFlow 0-1 to overall 0.88-1.0 range
                    if isinstance(progress, (int, float)) and progress != last_progress:
                        last_progress = progress
                        overall = 0.88 + progress * 0.12
                        await _notify(notebook_id, source_id, "vectorizing", progress=overall)
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
                    # No RAGFlow IDs — was stuck before reaching RAGFlow
                    # Re-trigger processing instead of marking failed
                    if source.storage_url and os.path.exists(source.storage_url):
                        await update_source_status(db, source.id, "uploading", error_message=None, progress=0)
                        logger.info("Re-triggering pipeline for %s (interrupted before RAGFlow)", source.filename)
                        asyncio.create_task(process_document(
                            source_id=str(source.id),
                            notebook_id=str(source.notebook_id),
                            file_path=source.storage_url,
                            filename=source.filename,
                            file_type=source.file_type,
                        ))
                    else:
                        await update_source_status(
                            db, source.id, "failed", error_message="File missing after restart"
                        )
                        logger.info("Marked %s as failed (file missing)", source.filename)
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
    """Poll RAGFlow for a stuck source until done or timeout.

    Uses same timeout as _background_poll (2 hours) to handle large files.
    """
    from backend.models.source import Source

    source_id = str(source.id)
    notebook_id = str(source.notebook_id)

    for _ in range(120):  # 120 * 60s = 2 hours (matches _background_poll)
        await asyncio.sleep(60)
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
                    await _notify(notebook_id, source_id, "ready")
                    logger.info("Poll recovered %s → ready (chunks=%d)", source.filename, chunks)
                    await _maybe_trigger_raptor(source.notebook_id)
                    return
                if run in ("FAIL", "FAILED", "CANCEL"):
                    async with async_session() as fresh_db:
                        await update_source_status(
                            fresh_db, source.id, "failed", error_message=f"RAGFlow: {run}"
                        )
                    await _notify(notebook_id, source_id, "failed", error=f"RAGFlow: {run}")
                    return
            except Exception:
                pass

    # Timed out — mark as failed
    async with _poll_semaphore:
        async with async_session() as fresh_db:
            await update_source_status(
                fresh_db, source.id, "failed", error_message="Recovery poll timed out (2h)"
            )
    await _notify(notebook_id, source_id, "failed", error="Processing timed out")
    logger.warning("Recovery poll timed out for %s after 2 hours", source.filename)
