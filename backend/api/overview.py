import hashlib
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.user import User
from backend.models.source import Source
from backend.services.qwen_client import qwen_client
from backend.services.excel_service import excel_to_markdown

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

# In-memory cache: notebook_id -> (source_hash, parsed_result)
_overview_cache: dict[str, tuple[str, dict]] = {}


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
    sources = await _get_ready_sources(db, uuid.UUID(notebook_id))
    if not sources:
        return {"overview": "", "suggested_questions": []}

    source_hash = _compute_source_hash(sources)

    # Return cached result if sources haven't changed
    cached = _overview_cache.get(notebook_id)
    if cached and cached[0] == source_hash:
        return cached[1]

    # Generate new overview
    context = await _get_source_context(sources)
    if not context:
        return {"overview": "", "suggested_questions": []}

    lang = _detect_language(context)
    prompt = OVERVIEW_PROMPT.format(context=context)
    messages = [
        {"role": "system", "content": f"You are a helpful assistant that analyzes documents. You MUST write your entire response in {lang}. Do NOT use any other language."},
        {"role": "user", "content": prompt},
    ]
    raw = await qwen_client.generate(messages, temperature=0.5, max_tokens=500)
    result = _parse_overview_response(raw)

    # Cache the result
    _overview_cache[notebook_id] = (source_hash, result)

    return result
