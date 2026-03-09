import json
import logging
import re
import uuid
from typing import AsyncGenerator

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.chat_message import ChatMessage
from backend.models.saved_note import SavedNote
from backend.models.source import Source
from backend.services.ragflow_client import ragflow_client
from backend.services.qwen_client import qwen_client
from backend.services.query_router import route_query
from backend.services.excel_service import query_excel, get_table_schema

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an AI assistant that answers questions based on the provided source documents.
Follow these rules strictly:
1. Only answer based on the provided context. If the context doesn't contain enough information, say so.
2. Use inline citation markers like [1], [2], etc. to reference the source chunks.
3. Each citation number corresponds to a chunk from the context provided below.
4. Be concise and direct in your answers.
5. If the question is in Chinese, answer in Chinese. If in English, answer in English.
6. Format your answer using Markdown when appropriate (lists, bold, headers, etc.)."""


def _build_context_prompt(chunks: list[dict], sources_map: dict) -> tuple[str, list[dict]]:
    """Build context string and citation metadata from retrieved chunks."""
    if not chunks:
        return "", []

    context_parts: list[str] = []
    citations: list[dict] = []

    for i, chunk in enumerate(chunks, 1):
        text = chunk.get("content_with_weight", chunk.get("content", ""))
        doc_name = chunk.get("document_keyword", chunk.get("docnm_kwd", "unknown"))

        # Try to extract page/location info from chunk metadata
        location: dict = {}
        positions = chunk.get("positions", [])
        if positions and len(positions) > 0:
            pos = positions[0]
            if isinstance(pos, list) and len(pos) >= 5:
                location["page"] = pos[0]
            elif isinstance(pos, dict):
                location = {k: v for k, v in pos.items() if k in ("page", "slide", "paragraph")}

        # Find source_id from sources_map
        # Compare stems (without extension) to handle RAGFlow renaming .txt → .md
        source_id = ""
        file_type = "txt"
        doc_stem = doc_name.rsplit(".", 1)[0] if "." in doc_name else doc_name
        for sid, sinfo in sources_map.items():
            sinfo_stem = sinfo["filename"].rsplit(".", 1)[0] if "." in sinfo["filename"] else sinfo["filename"]
            if sinfo_stem == doc_stem or sinfo["filename"] in doc_name or doc_name in sinfo["filename"]:
                source_id = sid
                file_type = sinfo["file_type"]
                break

        context_parts.append(f"[{i}] (Source: {doc_name})\n{text}\n")
        citations.append({
            "index": i,
            "source_id": source_id,
            "filename": doc_name,
            "file_type": file_type,
            "location": location,
            "excerpt": text[:300] if text else "",
        })

    context = "\n---\n".join(context_parts)
    return context, citations


async def _get_source_dataset_ids(
    db: AsyncSession, notebook_id: uuid.UUID, source_ids: list[str] | None
) -> tuple[list[str], dict]:
    """Get RAGFlow dataset IDs and source info for retrieval."""
    query = select(Source).where(
        Source.notebook_id == notebook_id,
        Source.status == "ready",
    )
    if source_ids:
        query = query.where(Source.id.in_([uuid.UUID(sid) for sid in source_ids]))

    result = await db.execute(query)
    sources = list(result.scalars().all())

    dataset_ids = list(set(s.ragflow_dataset_id for s in sources if s.ragflow_dataset_id))
    sources_map = {
        str(s.id): {"filename": s.filename, "file_type": s.file_type}
        for s in sources
    }

    return dataset_ids, sources_map


async def stream_chat(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    user_id: uuid.UUID,
    message: str,
    source_ids: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    """Stream AI response with citations. Yields SSE-formatted data."""
    # 1. Save user message
    user_msg = ChatMessage(
        notebook_id=notebook_id,
        user_id=user_id,
        role="user",
        content=message,
        citations=[],
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    # Send user message event
    yield f"data: {json.dumps({'type': 'user_message', 'id': str(user_msg.id)})}\n\n"

    # 2. Retrieve from RAGFlow
    dataset_ids, sources_map = await _get_source_dataset_ids(db, notebook_id, source_ids)

    # Get Excel sources with duckdb paths (filtered by source_ids if provided)
    excel_query = select(Source).where(
        Source.notebook_id == notebook_id,
        Source.duckdb_path.isnot(None),
    )
    if source_ids:
        excel_query = excel_query.where(Source.id.in_([uuid.UUID(sid) for sid in source_ids]))
    excel_result = await db.execute(excel_query)
    excel_sources = list(excel_result.scalars().all())

    # Route Excel queries — try each matching Excel source
    sql_answer = None
    if excel_sources:
        for excel_src in excel_sources:
            schema = get_table_schema(excel_src.duckdb_path)
            route = await route_query(message, schema)

            if route != "sql":
                continue

            sql_gen_prompt = f"""Given this DuckDB table schema:
{schema}

The data comes from file: {excel_src.filename}

Generate a SQL query to answer: {message}

Rules:
- The table name is always "data"
- Return ONLY the SQL query, no explanation, no markdown
- Use standard SQL compatible with DuckDB"""

            sql_query = await qwen_client.generate(
                [{"role": "user", "content": sql_gen_prompt}]
            )
            sql_query = sql_query.strip()
            # Strip markdown code fences if present
            if sql_query.startswith("```"):
                sql_query = sql_query.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            try:
                sql_answer = query_excel(excel_src.duckdb_path, sql_query)
                logger.info("SQL query succeeded on %s: %s", excel_src.filename, sql_query)
                break  # Success — stop trying other files
            except Exception as e:
                logger.warning("SQL query failed on %s: %s\nQuery: %s", excel_src.filename, e, sql_query)
                # Don't set sql_answer on failure — fall through to RAG

    chunks: list[dict] = []
    if dataset_ids:
        chunks = await ragflow_client.retrieve(dataset_ids, message, top_k=6)

    context, citation_metadata = _build_context_prompt(chunks, sources_map)

    # 3. Build messages for Qwen
    if sql_answer is not None:
        user_content = f"""Question: {message}

Result from structured data query:
{sql_answer}

Provide a clear, concise answer based on these query results."""
    elif context:
        user_content = f"""Context from source documents:
{context}

Question: {message}

Answer the question based on the context above. Use [1], [2], etc. to cite specific sources."""
    else:
        user_content = f"""Question: {message}

Note: No source documents are available or the retrieval system is not connected.
Answer based on your general knowledge, but mention that you don't have access to specific source documents."""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    # 4. Stream response from Qwen
    full_response = ""
    async for token in qwen_client.stream_chat(messages):
        full_response += token
        yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

    # 5. Parse citation references from response
    used_indices = set(int(m) for m in re.findall(r'\[(\d+)\]', full_response))
    used_citations = [c for c in citation_metadata if c["index"] in used_indices]

    # 6. Save assistant message
    assistant_msg = ChatMessage(
        notebook_id=notebook_id,
        user_id=user_id,
        role="assistant",
        content=full_response,
        citations=used_citations,
    )
    db.add(assistant_msg)
    await db.commit()
    await db.refresh(assistant_msg)

    # 7. Send completion event with citations
    yield f"data: {json.dumps({'type': 'done', 'id': str(assistant_msg.id), 'citations': used_citations})}\n\n"


async def get_chat_history(
    db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID
) -> list[ChatMessage]:
    """Get chat history for a notebook (per-user)."""
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.notebook_id == notebook_id, ChatMessage.user_id == user_id)
        .order_by(ChatMessage.created_at.asc())
    )
    return list(result.scalars().all())


async def clear_chat_history(
    db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """Clear chat history for a notebook (per-user)."""
    # NULL out source_message_id on saved notes that reference these messages
    # to avoid FK violation when deleting chat messages
    from sqlalchemy import update as sql_update
    msg_ids_result = await db.execute(
        select(ChatMessage.id).where(
            ChatMessage.notebook_id == notebook_id,
            ChatMessage.user_id == user_id,
        )
    )
    msg_ids = [r[0] for r in msg_ids_result.fetchall()]
    if msg_ids:
        await db.execute(
            sql_update(SavedNote).where(SavedNote.source_message_id.in_(msg_ids)).values(source_message_id=None)
        )
    await db.execute(
        delete(ChatMessage).where(
            ChatMessage.notebook_id == notebook_id,
            ChatMessage.user_id == user_id,
        )
    )
    await db.commit()
