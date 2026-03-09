import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.user import User
from backend.models.source import Source
from backend.services.qwen_client import qwen_client

router = APIRouter(prefix="/notebooks/{notebook_id}/overview", tags=["overview"])

OVERVIEW_PROMPT = """Based on the following document contents, write:

1. A brief overview (2-3 sentences) describing what these documents are about.
2. Exactly 3 suggested questions that a user might want to ask about these documents. The questions should be specific, insightful, and directly related to the content.

Format your response EXACTLY as follows (use this exact format, no extra text):
OVERVIEW:
<your overview text here>

QUESTIONS:
1. <first question>
2. <second question>
3. <third question>

Write in the same language as the documents.

DOCUMENTS:
{context}"""


async def _get_source_context(db: AsyncSession, notebook_id: uuid.UUID) -> str:
    result = await db.execute(
        select(Source).where(
            Source.notebook_id == notebook_id,
            Source.status == "ready",
        )
    )
    sources = list(result.scalars().all())
    if not sources:
        return ""

    context_parts: list[str] = []
    for source in sources:
        if source.storage_url and source.file_type in ("txt", "md"):
            try:
                with open(source.storage_url, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()[:8000]
                context_parts.append(f"--- {source.filename} ---\n{content}")
            except Exception:
                pass
        elif source.storage_url:
            context_parts.append(f"--- {source.filename} (binary file) ---")

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
        # Fallback: use entire text as overview
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
    context = await _get_source_context(db, uuid.UUID(notebook_id))
    if not context:
        return {"overview": "", "suggested_questions": []}

    prompt = OVERVIEW_PROMPT.format(context=context)
    messages = [
        {"role": "system", "content": "You are a helpful assistant that analyzes documents."},
        {"role": "user", "content": prompt},
    ]
    raw = await qwen_client.generate(messages, temperature=0.5, max_tokens=500)
    return _parse_overview_response(raw)
