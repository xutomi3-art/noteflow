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
from backend.services.excel_service import query_excel, get_table_schema, get_table_sample, excel_to_markdown

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an AI assistant that answers questions STRICTLY based on the provided source documents.
Follow these rules strictly:
1. ONLY answer based on the provided context. NEVER use your general knowledge or training data.
2. If the context doesn't contain enough information to answer the question, clearly state that the uploaded documents do not contain this information. Do NOT guess or supplement with outside knowledge.
3. Use inline citation markers like [1], [2], etc. to reference the source chunks.
4. Each citation number corresponds to a chunk from the context provided below.
5. Be concise and direct in your answers.
6. If the question is in Chinese, answer in Chinese. If in English, answer in English.
7. Format your answer using Markdown when appropriate (lists, bold, headers, tables, etc.).
8. When presenting structured or tabular data, use Markdown tables (| col1 | col2 |) for clear formatting."""


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
        # Compare stems (without extension) to handle RAGFlow renaming:
        #   .txt → .md, or appending (2)/(3) suffixes for duplicates
        source_id = ""
        file_type = "txt"
        doc_stem = doc_name.rsplit(".", 1)[0] if "." in doc_name else doc_name
        # Strip RAGFlow's duplicate suffix like "(2)", "(3)" etc.
        doc_stem_clean = re.sub(r'\(\d+\)$', '', doc_stem).strip()
        for sid, sinfo in sources_map.items():
            sinfo_stem = sinfo["filename"].rsplit(".", 1)[0] if "." in sinfo["filename"] else sinfo["filename"]
            if (sinfo_stem == doc_stem or sinfo_stem == doc_stem_clean
                    or sinfo["filename"] in doc_name or doc_name in sinfo["filename"]):
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
    thinking: bool = False,
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
    logger.info("Excel sources found: %d, source_ids: %s", len(excel_sources), source_ids)

    # Handle Excel queries — LLM-native approach preferred (send markdown to LLM directly)
    # qwen-plus supports 128K context, so we can handle fairly large spreadsheets
    # ~60000 chars ≈ 200-300 rows × 8-10 columns, well within context limits
    # For very large files: fall back to SQL generation via DuckDB
    MAX_LLM_NATIVE_CHARS = 60000
    excel_context = None
    sql_answer = None
    if excel_sources:
        # First pass: try LLM-native approach for all Excel sources (no routing needed)
        for excel_src in excel_sources:
            if excel_src.storage_url:
                try:
                    md_content = excel_to_markdown(excel_src.storage_url)
                    if len(md_content) <= MAX_LLM_NATIVE_CHARS:
                        excel_context = f"Data from file: {excel_src.filename}\n\n{md_content}"
                        logger.info("Using LLM-native approach for %s (%d chars)", excel_src.filename, len(md_content))
                        break
                    else:
                        logger.info("Excel markdown too large (%d chars), will try SQL for %s", len(md_content), excel_src.filename)
                except Exception as e:
                    logger.warning("Failed to convert %s to markdown: %s", excel_src.filename, e)

        # Second pass: SQL fallback for large files (only if LLM-native didn't work)
        if excel_context is None:
            for excel_src in excel_sources:
                schema = get_table_schema(excel_src.duckdb_path)
                route = await route_query(message, schema)
                logger.info("Query route for '%s' on %s: %s", message[:50], excel_src.filename, route)

                if route != "sql":
                    continue

                sample = get_table_sample(excel_src.duckdb_path)
                sql_gen_prompt = f"""Given this DuckDB table schema:
{schema}

Sample data (first and last rows):
{sample}

The data comes from file: {excel_src.filename}

Generate a SQL query to answer: {message}

Rules:
- The table name is always "data"
- Return ONLY the SQL query, no explanation, no markdown
- Use standard SQL compatible with DuckDB
- IMPORTANT: Excel merged cells have been forward-filled. If a category/topic spans multiple rows, ALL those rows now share the same category value. When asked about a budget/total for a category, use SUM() to aggregate all matching rows.
- IMPORTANT: Excel files often have summary/total rows at the bottom (rows where key identifier columns like ID, name, PO number are NULL). When aggregating (SUM, COUNT, AVG), EXCLUDE these summary rows by filtering out rows where the primary identifier column IS NULL.
- If the user asks for a total and a summary row already contains it, you can SELECT that value directly instead of re-summing.
- Use ILIKE for string matching to be case-insensitive. Use '%keyword%' patterns for partial matching."""

                sql_query = await qwen_client.generate(
                    [{"role": "user", "content": sql_gen_prompt}]
                )
                sql_query = sql_query.strip()
                # Strip markdown code fences if present
                if sql_query.startswith("```"):
                    sql_query = sql_query.split("\n", 1)[1].rsplit("```", 1)[0].strip()
                logger.info("Generated SQL: %s", sql_query)

                try:
                    sql_answer = query_excel(excel_src.duckdb_path, sql_query)
                    logger.info("SQL query succeeded on %s", excel_src.filename)
                    break
                except Exception as e:
                    logger.warning("SQL query failed on %s: %s\nQuery: %s", excel_src.filename, e, sql_query)
                    # Don't set sql_answer on failure — fall through to RAG

    chunks: list[dict] = []
    if dataset_ids:
        chunks = await ragflow_client.retrieve(dataset_ids, message, top_k=6)

    context, citation_metadata = _build_context_prompt(chunks, sources_map)

    # 3. Build messages for Qwen
    if excel_context is not None:
        user_content = f"""The following is the complete content of a spreadsheet file. Read it carefully and answer the question based on this data.

{excel_context}

Question: {message}

Rules:
- Answer based ONLY on the data above.
- If the question involves a category/item that spans multiple rows (merged cells), sum up all related rows.
- Be precise with numbers. Show your calculation if summing multiple values.
- If the data doesn't contain relevant information, say so."""
    elif sql_answer is not None:
        user_content = f"""Question: {message}

Result from structured data query:
{sql_answer}

Provide a clear, concise answer based on these query results."""
    elif context:
        user_content = f"""Context from source documents:
{context}

Question: {message}

Answer the question ONLY based on the context above. Use [1], [2], etc. to cite specific sources. If the context does not contain relevant information to answer the question, say that the uploaded documents do not contain this information."""
    else:
        user_content = f"""Question: {message}

The uploaded documents do not contain information relevant to this question. Please inform the user that you cannot find relevant content in the uploaded source documents, and suggest they upload additional documents or rephrase their question."""

    # Fetch conversation history for context (last 10 messages = 5 exchanges)
    history = await get_chat_history(db, notebook_id, user_id)
    # Exclude the user message we just saved
    history = [h for h in history if h.id != user_msg.id]
    history_messages = [
        {"role": h.role, "content": h.content}
        for h in history[-10:]
    ]

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *history_messages,
        {"role": "user", "content": user_content},
    ]

    # 4. Stream response from LLM
    full_response = ""
    async for token in qwen_client.stream_chat(messages, thinking=thinking):
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
