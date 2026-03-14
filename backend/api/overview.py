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

CRITICAL LANGUAGE RULE: You MUST detect the primary language of the documents below and respond in that SAME language. If the documents are primarily in English, you MUST write your entire response in English. If the documents are primarily in Chinese, write in Chinese. Do NOT translate — match the source language exactly.

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
        if not source.storage_url:
            continue
        content = None
        try:
            if source.file_type in ("txt", "md"):
                with open(source.storage_url, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()[:8000]
            elif source.file_type in ("xlsx", "xls", "csv"):
                # Convert Excel/CSV to markdown for overview context
                content = excel_to_markdown(source.storage_url)[:8000]
            else:
                # For PDF/DOCX/PPTX: try reading the MinerU-parsed .md file
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
