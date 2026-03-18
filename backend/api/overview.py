import hashlib
import json
import logging
import os
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.notebook import Notebook
from backend.models.user import User
from backend.models.source import Source
from backend.services.qwen_client import qwen_client
from backend.services.excel_service import excel_to_markdown

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notebooks/{notebook_id}/overview", tags=["overview"])


def _detect_language(text: str) -> str:
    """Detect if text is primarily Chinese or English based on character ratio."""
    cjk_count = sum(1 for ch in text if '\u4e00' <= ch <= '\u9fff')
    return "Chinese" if cjk_count > len(text) * 0.05 else "English"

OVERVIEW_PROMPT = """Based on the following document contents, write:

1. A brief overview (2-3 sentences) describing what these documents are about.
2. Exactly 3 practical suggested questions that a user might want to ask. Keep them simple, useful, and beginner-friendly.

Format your response EXACTLY as follows (use this exact format, no extra text):
OVERVIEW:
<your overview text here>

QUESTIONS:
1. <first question>
2. <second question>
3. <third question>

DOCUMENTS:
{context}"""


def _compute_source_hash(sources: list[Source]) -> str:
    """Hash of sorted ready source IDs — changes when sources are added/removed."""
    ids = sorted(str(s.id) for s in sources if s.status == "ready")
    return hashlib.md5(",".join(ids).encode()).hexdigest()


async def _get_ready_sources(db: AsyncSession, notebook_id: uuid.UUID) -> list[Source]:
    result = await db.execute(
        select(Source).where(
            Source.notebook_id == notebook_id,
            Source.status == "ready",
        )
    )
    return list(result.scalars().all())


async def _get_source_context(sources: list[Source]) -> str:
    if not sources:
        return ""

    context_parts: list[str] = []
    for source in sources:
        if not source.storage_url:
            continue
        content = None
        try:
            if source.file_type in ("txt", "md"):
                with open(source.storage_url, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()[:8000]
            elif source.file_type in ("xlsx", "xls", "csv"):
                content = excel_to_markdown(source.storage_url)[:8000]
            else:
                md_path = source.storage_url.rsplit(".", 1)[0] + ".md"
                if os.path.isfile(md_path):
                    with open(md_path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()[:8000]
        except Exception:
            pass

        if content:
            context_parts.append(f"--- {source.filename} ---\n{content}")
        else:
            context_parts.append(f"--- {source.filename} ---")

    return "\n\n".join(context_parts)


def _parse_overview_response(text: str) -> dict:
    """Parse the structured overview response from Qwen."""
    overview = ""
    questions: list[str] = []

    if "OVERVIEW:" in text and "QUESTIONS:" in text:
        parts = text.split("QUESTIONS:")
        overview_part = parts[0].replace("OVERVIEW:", "").strip()
        overview = overview_part

        questions_part = parts[1].strip()
        for line in questions_part.split("\n"):
            line = line.strip()
            if line and (line[0].isdigit() and ". " in line):
                q = line.split(". ", 1)[1].strip()
                if q:
                    questions.append(q)
    else:
        overview = text.strip()

    return {
        "overview": overview,
        "suggested_questions": questions[:3],
    }


@router.get("")
async def get_overview(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    nb_uuid = uuid.UUID(notebook_id)

    # Check DB cache first (before expensive source queries)
    nb_result = await db.execute(select(Notebook).where(Notebook.id == nb_uuid))
    notebook = nb_result.scalar_one_or_none()

    sources = await _get_ready_sources(db, nb_uuid)
    source_hash = _compute_source_hash(sources) if sources else ""

    # Return cached overview if hash matches OR if it's a demo notebook
    if notebook and notebook.overview_cache:
        is_demo = notebook.overview_source_hash == "_demo_"
        cache_valid = notebook.overview_source_hash == source_hash or is_demo
        if cache_valid:
            try:
                cached = json.loads(notebook.overview_cache)
                # Upgrade demo hash to real hash once sources are ready (so future uploads invalidate correctly)
                if is_demo and source_hash:
                    notebook.overview_source_hash = source_hash
                    await db.commit()
                return cached
            except (json.JSONDecodeError, TypeError):
                pass

    if not sources:
        return {"overview": "", "suggested_questions": []}

    # Generate new overview via LLM
    t_start = time.time()
    context = await _get_source_context(sources)
    t_context = time.time()
    if not context:
        return {"overview": "", "suggested_questions": []}

    logger.info("Overview: context read %.1fs, %d chars, %d sources", t_context - t_start, len(context), len(sources))

    lang = _detect_language(context)
    prompt = OVERVIEW_PROMPT.format(context=context)
    messages = [
        {"role": "system", "content": f"You are a helpful assistant that analyzes documents. You MUST write your entire response in {lang}. Do NOT use any other language."},
        {"role": "user", "content": prompt},
    ]
    raw = await qwen_client.generate(messages, temperature=0.5, max_tokens=500)
    t_llm = time.time()
    result = _parse_overview_response(raw)

    logger.info("Overview: LLM generation %.1fs, total %.1fs", t_llm - t_context, t_llm - t_start)

    # Save to DB cache
    if notebook:
        notebook.overview_cache = json.dumps(result)
        notebook.overview_source_hash = source_hash
        await db.commit()

    return result
