import io
import json as json_lib
import os
import re
import tempfile
import urllib.parse
import uuid

from pydub import AudioSegment

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pptx import Presentation
from pptx.util import Inches
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.models.notebook import Notebook
from backend.models.source import Source
from backend.models.user import User
from backend.services.qwen_client import qwen_client
from backend.services.ragflow_client import ragflow_client
from backend.services import permission_service
from backend.services.tts_client import text_to_speech

router = APIRouter(prefix="/notebooks/{notebook_id}/studio", tags=["studio"])

PROMPTS = {
    "summary": """Based on the following document contents, write a comprehensive summary that covers all key topics and main points. Structure it with clear sections and bullet points. Write in the same language as the documents.

Formatting rules:
- Use ## for main section headers and ### for sub-sections. Do NOT use #### or deeper headings.
- Use bullet points (- ) for details under each section.
- Keep the structure flat and readable.

DOCUMENTS:
{context}""",
    "faq": """Based on the following document contents, generate a list of 8-10 frequently asked questions with detailed answers. Each Q&A should cover an important concept from the documents. Format as:

Q: [question]
A: [answer]

Write in the same language as the documents.

DOCUMENTS:
{context}""",
    "study_guide": """Based on the following document contents, create a comprehensive study guide that includes:
1. Key concepts and definitions
2. Important relationships between ideas
3. Summary of each major section
4. Review questions for self-assessment

Write in the same language as the documents.

DOCUMENTS:
{context}""",
    "action_items": """Based on the following document contents, extract all action items, tasks, to-dos, next steps, and follow-up items. For each action item, include:
- The specific task or action required
- Who is responsible (if mentioned)
- Deadline or timeline (if mentioned)
- Priority level (High/Medium/Low) based on context

Group related action items together under clear category headers. Write in the same language as the documents.

DOCUMENTS:
{context}""",
    "mindmap": """Generate a mind map JSON structure from the source documents.
Return ONLY valid JSON in this exact format:
{{
  "nodes": [
    {{"id": "root", "label": "Central Topic", "level": 0}},
    {{"id": "n1", "label": "Main Branch 1", "level": 1, "parent": "root"}},
    {{"id": "n1_1", "label": "Sub Topic", "level": 2, "parent": "n1"}}
  ]
}}

Rules:
1. Root node has level=0 and no parent field
2. Main branches have level=1 and parent="root"
3. Sub-topics have level=2 and parent=the level-1 node id
4. Max 5 level-1 nodes, max 3 level-2 nodes per level-1 node
5. Labels are concise (under 6 words)
6. Each node has a unique id string
7. Return ONLY valid JSON, no markdown fences or explanation

Source content:
{context}""",
}

PPT_PROMPT = """You are creating a PowerPoint presentation based on the source documents.
Generate a JSON structure for a presentation with the following format:
{{
  "title": "Presentation Title",
  "slides": [
    {{
      "title": "Slide Title",
      "bullets": ["Point 1", "Point 2", "Point 3"]
    }}
  ]
}}

Rules:
1. Generate 5-8 slides maximum
2. Each slide has 3-5 bullet points
3. Keep bullets concise (under 15 words each)
4. First slide is a title/overview slide
5. Return ONLY valid JSON, no markdown fences

Source content:
{context}"""

PODCAST_PROMPT = """Create a natural podcast dialogue between Host and Guest based on the source documents.
Format each line strictly as:
HOST: [what the host says]
GUEST: [what the guest says]

Rules:
1. Alternate between HOST and GUEST, starting with HOST
2. 8-12 exchanges total
3. HOST introduces the topic, GUEST provides insights
4. Keep each line under 50 words
5. Make it conversational and engaging
6. Return ONLY the dialogue, no titles or descriptions

Source content:
{context}"""

# Broad retrieval queries to get comprehensive coverage of all document content
# Bilingual to handle both English and Chinese documents
_RETRIEVAL_QUERIES = [
    "main topics key points overview 主要内容 关键要点 概述",
    "important details information content 重要信息 详细内容",
    "background context introduction 背景介绍 基本概念",
]


async def _get_source_context(db: AsyncSession, notebook_id: uuid.UUID) -> str:
    """Get document content for studio generation.

    Strategy:
    1. For TXT/MD: read directly from local storage (fast, no RAGFlow round-trip)
    2. For PDF/DOCX/PPTX: retrieve chunks from RAGFlow (MinerU-parsed content lives there)
    3. Combine both with deduplication
    """
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
    has_ragflow_sources = False

    # Step 1: Read TXT/MD files directly
    for source in sources:
        if source.file_type in ("txt", "md") and source.storage_url:
            try:
                with open(source.storage_url, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()[:8000]
                if content.strip():
                    context_parts.append(f"--- {source.filename} ---\n{content}")
            except Exception:
                pass
        elif source.ragflow_doc_id:
            has_ragflow_sources = True

    # Step 2: Retrieve chunks from RAGFlow for PDF/DOCX/PPTX sources
    if has_ragflow_sources:
        nb_result = await db.execute(
            select(Notebook).where(Notebook.id == notebook_id)
        )
        notebook = nb_result.scalar_one_or_none()
        dataset_id = notebook.ragflow_dataset_id if notebook else None

        if dataset_id:
            seen_texts: set[str] = set()
            all_chunks: list[dict] = []

            # Use multiple broad queries to get comprehensive coverage
            for query in _RETRIEVAL_QUERIES:
                try:
                    chunks = await ragflow_client.retrieve(
                        dataset_ids=[dataset_id],
                        question=query,
                        top_k=15,
                    )
                except Exception:
                    chunks = []
                for chunk in chunks:
                    text = chunk.get("content_with_weight", chunk.get("content", "")).strip()
                    if text and text not in seen_texts:
                        seen_texts.add(text)
                        all_chunks.append(chunk)

            if all_chunks:
                # Group chunks by source document
                doc_chunks: dict[str, list[str]] = {}
                for chunk in all_chunks:
                    doc_name = chunk.get("document_keyword", chunk.get("docnm_kwd", "document"))
                    text = chunk.get("content_with_weight", chunk.get("content", "")).strip()
                    if text:
                        doc_chunks.setdefault(doc_name, []).append(text)

                for doc_name, texts in doc_chunks.items():
                    combined = "\n\n".join(texts)[:10000]
                    context_parts.append(f"--- {doc_name} ---\n{combined}")

    return "\n\n".join(context_parts)


@router.post("/ppt")
async def generate_ppt(
    notebook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not await permission_service.check_permission(db, notebook_id, current_user.id, "view"):
        raise HTTPException(status_code=403, detail="No access to this notebook")
    context = await _get_source_context(db, notebook_id)
    if not context:
        raise HTTPException(status_code=400, detail="No source documents available")

    prompt = PPT_PROMPT.format(context=context[:8000])
    raw = await qwen_client.generate(
        [{"role": "system", "content": "Return only valid JSON."},
         {"role": "user", "content": prompt}]
    )

    # Strip markdown fences if present
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    try:
        data = json_lib.loads(raw)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse slide structure from AI")

    if not isinstance(data, dict) or "slides" not in data or not isinstance(data.get("slides"), list):
        raise HTTPException(status_code=500, detail="AI returned unexpected slide structure")

    raw_title = data.get('title', 'presentation')
    safe_title = re.sub(r'[^\w\s-]', '', raw_title).strip()
    safe_title = re.sub(r'[\s]+', '_', safe_title) or 'presentation'
    filename = f"{safe_title}.pptx"

    # Build .pptx in memory
    prs = Presentation()
    prs.slide_width = Inches(13.33)
    prs.slide_height = Inches(7.5)

    # Title slide
    title_slide = prs.slides.add_slide(prs.slide_layouts[0])
    title_slide.shapes.title.text = data.get("title", "Presentation")
    title_slide.placeholders[1].text = "Generated by Noteflow AI"

    # Content slides
    content_layout = prs.slide_layouts[1]  # title + content
    for slide_data in data.get("slides", []):
        slide = prs.slides.add_slide(content_layout)
        slide.shapes.title.text = slide_data.get("title", "")
        tf = slide.placeholders[1].text_frame
        tf.clear()
        bullets = slide_data.get("bullets", [])
        for i, bullet in enumerate(bullets):
            if i == 0:
                tf.paragraphs[0].text = bullet
            else:
                p = tf.add_paragraph()
                p.text = bullet
                p.level = 0

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{urllib.parse.quote(filename)}"}
    )


@router.post("/podcast")
async def generate_podcast(
    notebook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not await permission_service.check_permission(db, notebook_id, current_user.id, "view"):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not settings.ALIBABA_TTS_APPKEY or not settings.ALIBABA_TTS_TOKEN:
        raise HTTPException(status_code=501, detail="TTS service not configured")

    context = await _get_source_context(db, notebook_id)
    if not context:
        raise HTTPException(status_code=400, detail="No source documents available")

    # Generate dialogue
    prompt = PODCAST_PROMPT.format(context=context[:6000])
    dialogue = await qwen_client.generate(
        [{"role": "system", "content": "Generate engaging podcast dialogue. Follow the format exactly."},
         {"role": "user", "content": prompt}]
    )

    # Parse HOST:/GUEST: lines
    lines: list[tuple[str, str]] = []
    for line in dialogue.strip().split('\n'):
        line = line.strip()
        if line.upper().startswith('HOST:'):
            lines.append(('host', line[5:].strip()))
        elif line.upper().startswith('GUEST:'):
            lines.append(('guest', line[6:].strip()))

    if not lines:
        raise HTTPException(status_code=500, detail="Failed to generate dialogue structure")

    # Generate TTS for each line and merge
    host_voice = "ailun"    # Female Mandarin
    guest_voice = "aicheng"  # Male Mandarin
    silence = AudioSegment.silent(duration=400)  # 400ms pause between lines

    with tempfile.TemporaryDirectory() as tmpdir:
        segments: list[AudioSegment] = []
        for i, (speaker, text) in enumerate(lines):
            if not text:
                continue
            voice = host_voice if speaker == 'host' else guest_voice
            audio_bytes = await text_to_speech(
                text, voice,
                settings.ALIBABA_TTS_APPKEY,
                settings.ALIBABA_TTS_TOKEN,
            )
            seg_path = os.path.join(tmpdir, f"seg_{i}.mp3")
            with open(seg_path, 'wb') as f:
                f.write(audio_bytes)
            segments.append(AudioSegment.from_mp3(seg_path))
            segments.append(silence)

        if not segments:
            raise HTTPException(status_code=500, detail="No audio segments generated")

        combined = segments[0]
        for seg in segments[1:]:
            combined += seg

        out_path = os.path.join(tmpdir, "podcast.mp3")
        combined.export(out_path, format="mp3")
        with open(out_path, 'rb') as f:
            mp3_bytes = f.read()

    return StreamingResponse(
        io.BytesIO(mp3_bytes),
        media_type="audio/mpeg",
        headers={"Content-Disposition": 'attachment; filename="podcast.mp3"'}
    )


@router.post("/{content_type}")
async def generate_content(
    notebook_id: str,
    content_type: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not await permission_service.check_permission(db, uuid.UUID(notebook_id), user.id, "view"):
        raise HTTPException(status_code=403, detail="No access to this notebook")

    if content_type not in PROMPTS:
        raise HTTPException(status_code=400, detail=f"Invalid type. Allowed: {list(PROMPTS.keys())}")

    context = await _get_source_context(db, uuid.UUID(notebook_id))
    if not context:
        raise HTTPException(status_code=400, detail="No ready sources available for generation")

    prompt = PROMPTS[content_type].format(context=context)
    messages = [
        {"role": "system", "content": "You are an AI assistant that generates educational content from source documents."},
        {"role": "user", "content": prompt},
    ]
    content = await qwen_client.generate(messages)

    return {"content": content}
