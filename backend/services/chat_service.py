import json
import logging
import os
import re
import time
import uuid
from typing import AsyncGenerator

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.chat_log import ChatLog
from backend.models.chat_message import ChatMessage
from backend.models.saved_note import SavedNote
from backend.models.source import Source
from backend.core.config import settings
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
6. CRITICAL: Always respond in the SAME LANGUAGE as the user's question. If the user asks in English, you MUST answer in English even if the documents are in Chinese. If the user asks in Chinese, answer in Chinese.
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
            if (sinfo_stem.lower() == doc_stem.lower()
                    or sinfo_stem.lower() == doc_stem_clean.lower()
                    or sinfo["filename"].lower() in doc_name.lower()
                    or doc_name.lower() in sinfo["filename"].lower()):
                source_id = sid
                file_type = sinfo["file_type"]
                break

        # Fallback 1: match on version patterns like "20250228v9" or date patterns
        if not source_id:
            # Extract version-like patterns from doc_name (e.g., "20251121v1", "20250228v9")
            doc_versions = set(re.findall(r'\d{8}v\d+', doc_name.lower()))
            if doc_versions:
                for sid, sinfo in sources_map.items():
                    src_versions = set(re.findall(r'\d{8}v\d+', sinfo["filename"].lower()))
                    if doc_versions & src_versions:
                        source_id = sid
                        file_type = sinfo["file_type"]
                        logger.info("Version-pattern fallback: mapped '%s' → %s (%s)", doc_name, sinfo["filename"], sid)
                        break

        # Fallback 2: if only one source exists, assign it
        if not source_id and len(sources_map) == 1:
            sid, sinfo = next(iter(sources_map.items()))
            source_id = sid
            file_type = sinfo["file_type"]
            logger.info("Single-source fallback: mapped '%s' → %s", doc_name, sid)

        if not source_id:
            logger.warning("Citation mapping failed: doc_name='%s', sources_map keys=%s",
                          doc_name, {s: info["filename"] for s, info in sources_map.items()})

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
) -> tuple[list[str], list[str], dict]:
    """Get RAGFlow dataset IDs, document IDs, and source info for retrieval.

    Returns:
        (dataset_ids, document_ids, sources_map) where document_ids are the
        RAGFlow doc IDs used to scope retrieval to selected sources only.
    """
    query = select(Source).where(
        Source.notebook_id == notebook_id,
        Source.status == "ready",
    )
    if source_ids:
        query = query.where(Source.id.in_([uuid.UUID(sid) for sid in source_ids]))

    result = await db.execute(query)
    sources = list(result.scalars().all())

    dataset_ids = list(set(s.ragflow_dataset_id for s in sources if s.ragflow_dataset_id))
    document_ids = [s.ragflow_doc_id for s in sources if s.ragflow_doc_id]
    sources_map = {
        str(s.id): {"filename": s.filename, "file_type": s.file_type}
        for s in sources
    }

    return dataset_ids, document_ids, sources_map


async def stream_chat(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    user_id: uuid.UUID,
    message: str,
    source_ids: list[str] | None = None,
    web_search: bool = False,
) -> AsyncGenerator[str, None]:
    """Stream AI response with citations. Yields SSE-formatted data."""
    # Initialize timing variables
    t_start = time.time()
    t_ragflow_start = t_ragflow_end = None
    t_excel_start = t_excel_end = None
    t_llm_start = t_llm_end = None
    t_first_token = None
    sources_map: dict = {}
    chunks: list[dict] = []
    excel_sources: list = []
    full_response = ""

    try:
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

        # 2. Send heartbeat before slow RAGFlow retrieval
        yield ": keepalive\n\n"

        # Retrieve from RAGFlow
        t_ragflow_start = time.time()
        dataset_ids, document_ids, sources_map = await _get_source_dataset_ids(db, notebook_id, source_ids)

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

        # Step 2a: RAGFlow retrieval first — find relevant chunks across all sources
        excel_context = None
        sql_answer = None

        chunks = []
        if dataset_ids:
            filter_doc_ids = document_ids if source_ids and document_ids else None
            chunks = await ragflow_client.retrieve(dataset_ids, message, top_k=settings.RAG_TOP_K, document_ids=filter_doc_ids)
        t_ragflow_end = time.time()

        # Step 2b: If we have Excel sources, check if RAGFlow found relevant Excel chunks.
        # If so, send only those matched Excel tables in full to LLM.
        # For data computation questions, also try SQL on matched tables.
        t_excel_start = time.time()
        if excel_sources:
            # Build a map of Excel ragflow_doc_id → Source
            excel_by_doc_id: dict[str, "Source"] = {}
            excel_by_filename: dict[str, "Source"] = {}
            for src in excel_sources:
                if src.ragflow_doc_id:
                    excel_by_doc_id[src.ragflow_doc_id] = src
                # Also match by filename (RAGFlow chunk contains document_keyword = filename)
                base = os.path.splitext(src.filename)[0] + ".md"
                excel_by_filename[base.lower()] = src
                excel_by_filename[src.filename.lower()] = src

            # Find which Excel files appear in retrieved chunks
            matched_excel: dict[str, "Source"] = {}  # source_id → Source (deduplicated)
            for chunk in chunks:
                doc_name = chunk.get("document_keyword", chunk.get("docnm_kwd", "")).lower()
                doc_id = chunk.get("document_id", chunk.get("doc_id", ""))
                # Match by doc_id (exact)
                if doc_id in excel_by_doc_id:
                    src = excel_by_doc_id[doc_id]
                    matched_excel[str(src.id)] = src
                # Match by filename (exact match on full name or base name)
                if doc_name in excel_by_filename:
                    src = excel_by_filename[doc_name]
                    matched_excel[str(src.id)] = src

            logger.info("Excel matching: %d Excel sources, %d matched from %d chunks. Matched: %s",
                        len(excel_sources), len(matched_excel), len(chunks),
                        [s.filename for s in matched_excel.values()])

            truncated_excel: set[str] = set()
            if matched_excel:
                # Dynamic budget: generous with Qwen3.5-Plus 1M context
                n = len(matched_excel)
                if n == 1:
                    max_excel_chars = 200000   # ~100K tokens — full large table
                elif n == 2:
                    max_excel_chars = 300000   # 150K each
                else:
                    max_excel_chars = min(150000 * n, 600000)
                logger.info("Excel budget: %d matched tables, %d char limit", n, max_excel_chars)

                # Send matched Excel tables in full to LLM
                excel_parts = []
                total_chars = 0
                for src in matched_excel.values():
                    if not src.storage_url:
                        continue
                    try:
                        md = excel_to_markdown(src.storage_url)
                        if total_chars + len(md) <= max_excel_chars:
                            excel_parts.append(f"Data from file: {src.filename}\n\n{md}")
                            total_chars += len(md)
                            logger.info("Including matched Excel: %s (%d chars)", src.filename, len(md))
                        else:
                            truncated_excel.add(str(src.id))
                            logger.info("Skipping Excel %s (%d chars) — budget exceeded, will try SQL", src.filename, len(md))
                    except Exception as e:
                        logger.warning("Failed to convert %s: %s", src.filename, e)
                if excel_parts:
                    excel_context = "\n\n---\n\n".join(excel_parts)
                    logger.info("Excel context: %d matched tables, %d total chars", len(excel_parts), total_chars)

            # SQL fallback — only for Excel files that were too large to fit in context
            # Run in parallel with asyncio.gather for speed
            if sql_answer is None and truncated_excel:
                import asyncio

                async def _try_sql(src: "Source") -> str | None:
                    """Try SQL route for a single Excel source. Returns result or None."""
                    if str(src.id) not in truncated_excel or not src.duckdb_path:
                        return None
                    schema = get_table_schema(src.duckdb_path)
                    route = await route_query(message, schema)
                    if route != "sql":
                        return None
                    logger.info("SQL route matched for %s", src.filename)
                    sample = get_table_sample(src.duckdb_path)
                    sql_gen_prompt = f"""Given this DuckDB table schema:
{schema}

Sample data (first and last rows):
{sample}

The data comes from file: {src.filename}

Generate a SQL query to answer: {message}

Rules:
- The table name is always "data"
- Return ONLY the SQL query, no explanation, no markdown
- Use standard SQL compatible with DuckDB
- IMPORTANT: Use ASCII commas (,) not Chinese commas (，) in SQL
- IMPORTANT: Always quote column names with double quotes (e.g. "列名")
- IMPORTANT: Excel merged cells have been forward-filled.
- IMPORTANT: Exclude summary/total rows where primary identifier is NULL.
- Use ILIKE for case-insensitive string matching."""

                    sql_query = await qwen_client.generate(
                        [{"role": "user", "content": sql_gen_prompt}]
                    )
                    sql_query = sql_query.strip()
                    if sql_query.startswith("```"):
                        sql_query = sql_query.split("\n", 1)[1].rsplit("```", 1)[0].strip()
                    # Fix common LLM mistakes: Chinese punctuation → ASCII
                    sql_query = sql_query.replace("，", ",").replace("（", "(").replace("）", ")").replace("'", "'").replace("'", "'")
                    logger.info("Generated SQL: %s", sql_query)
                    try:
                        result = query_excel(src.duckdb_path, sql_query)
                        logger.info("SQL succeeded on %s", src.filename)
                        return result
                    except Exception as e:
                        logger.warning("SQL failed on %s: %s", src.filename, e)
                        return None

                results = await asyncio.gather(
                    *[_try_sql(src) for src in matched_excel.values()],
                    return_exceptions=True,
                )
                for r in results:
                    if isinstance(r, str) and r:
                        sql_answer = r
                        break
        t_excel_end = time.time()

        context, citation_metadata = _build_context_prompt(chunks, sources_map)

        # 3. Build messages for Qwen
        # Combine all available data sources into a single prompt
        has_excel = excel_context is not None or sql_answer is not None
        has_rag = bool(context)

        if has_excel and has_rag:
            # Both Excel and document sources — combine them
            excel_section = ""
            if excel_context is not None:
                excel_section = f"Spreadsheet data:\n{excel_context}"
            elif sql_answer is not None:
                excel_section = f"Structured data query result:\n{sql_answer}"

            user_content = f"""{excel_section}

Context from other source documents:
{context}

Question: {message}

Rules:
- Answer based on ALL the data above (both spreadsheet and documents).
- Use [1], [2], etc. to cite specific document sources.
- For spreadsheet data, be precise with numbers and show calculations if summing.
- If the data doesn't contain relevant information, say so."""
        elif excel_context is not None:
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
        elif context and web_search:
            user_content = f"""Context from source documents:
{context}

Question: {message}

Answer based on the context above if relevant (cite with [1], [2]). If the context does not contain relevant information, use web search to find the answer."""
        elif context:
            user_content = f"""Context from source documents:
{context}

Question: {message}

Answer the question ONLY based on the context above. Use [1], [2], etc. to cite specific sources. If the context does not contain relevant information to answer the question, say that the uploaded documents do not contain this information."""
        elif web_search:
            user_content = f"""Question: {message}

The uploaded documents do not contain information relevant to this question. Please use web search to find the answer."""
        else:
            user_content = f"""Question: {message}

The uploaded documents do not contain information relevant to this question. Please inform the user that you cannot find relevant content in the uploaded source documents, and suggest they upload additional documents or rephrase their question."""

        # Fetch conversation history — up to 30 rounds (60 messages) but capped at ~30K tokens (~60K chars)
        MAX_HISTORY_ROUNDS = 30
        MAX_HISTORY_CHARS = 60000
        history = await get_chat_history(db, notebook_id, user_id)
        history = [h for h in history if h.id != user_msg.id]
        recent = history[-(MAX_HISTORY_ROUNDS * 2):]
        history_messages = []
        history_chars = 0
        for h in reversed(recent):
            msg_chars = len(h.content)
            if history_chars + msg_chars > MAX_HISTORY_CHARS:
                break
            history_messages.append({"role": h.role, "content": h.content})
            history_chars += msg_chars
        history_messages.reverse()
        logger.info("Chat history: %d messages, %d chars", len(history_messages), history_chars)

        # Safety cap: Qwen3.5-Plus has 1M context.
        # Normal questions: cap at ~250K tokens (≤256K pricing tier)
        # Excel questions: cap at ~800K tokens (utilize 1M context)
        has_excel_data = excel_context is not None or sql_answer is not None
        MAX_TOTAL_CHARS = 1600000 if has_excel_data else 500000
        max_user_chars = MAX_TOTAL_CHARS - len(SYSTEM_PROMPT) - history_chars
        if len(user_content) > max_user_chars:
            logger.warning("User content too long (%d chars), truncating to %d (history=%d)", len(user_content), max_user_chars, history_chars)
            user_content = user_content[:max_user_chars - 200] + f"\n\n[Context truncated due to length]\n\nQuestion: {message}"

        if web_search:
            system_prompt = """You are an AI assistant that answers questions based on the provided source documents AND web search results.
Follow these rules strictly:
1. First check if the provided context contains relevant information. If it does, answer based on the context and cite with [1], [2], etc.
2. If the context does not contain relevant information, use your web search capability to find the answer from the internet.
3. When using web search results, clearly indicate that the information comes from the internet (e.g. "According to web search results:").
4. You may combine information from both uploaded documents and web search when appropriate.
5. Be concise and direct in your answers.
6. CRITICAL: Always respond in the SAME LANGUAGE as the user's question. If the user asks in English, you MUST answer in English even if the documents are in Chinese. If the user asks in Chinese, answer in Chinese.
7. Format your answer using Markdown when appropriate (lists, bold, headers, tables, etc.).
8. When presenting structured or tabular data, use Markdown tables (| col1 | col2 |) for clear formatting."""
        else:
            system_prompt = SYSTEM_PROMPT

        messages = [
            {"role": "system", "content": system_prompt},
            *history_messages,
            {"role": "user", "content": user_content},
        ]

        # 4. Stream response from LLM — send keepalive then stream tokens
        yield ": keepalive\n\n"
        full_response = ""
        t_llm_start = time.time()
        async for token in qwen_client.stream_chat(messages, enable_search=web_search):
            if token.startswith("\n\n[Error:") and "maximum context length" in token:
                friendly = "Selected sources contain too much data. Please select fewer sources and try again."
                yield f"data: {json.dumps({'type': 'error', 'message': friendly})}\n\n"
                return
            else:
                if t_first_token is None:
                    t_first_token = time.time()
                full_response += token
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
        t_llm_end = time.time()

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

        # Save chat log for diagnostics
        try:
            log = ChatLog(
                notebook_id=notebook_id,
                user_id=user_id,
                message_preview=message[:200],
                total_duration=round(time.time() - t_start, 2),
                ragflow_duration=round(t_ragflow_end - t_ragflow_start, 2) if t_ragflow_end else None,
                excel_duration=round(t_excel_end - t_excel_start, 2) if t_excel_end else None,
                llm_duration=round(t_llm_end - t_llm_start, 2) if t_llm_end else None,
                llm_first_token=round(t_first_token - t_llm_start, 2) if t_first_token else None,
                source_count=len(sources_map),
                chunk_count=len(chunks),
                thinking_mode=False,
                has_excel=bool(excel_sources),
                llm_model=settings.LLM_MODEL,
                token_count=len(full_response),  # approximate by char count
                status="ok",
            )
            db.add(log)
            await db.commit()
        except Exception as e:
            logger.warning("Failed to save chat log: %s", e)

        # 7. Send completion event with citations
        yield f"data: {json.dumps({'type': 'done', 'id': str(assistant_msg.id), 'citations': used_citations})}\n\n"

    except Exception as e:
        # Log error to ChatLog
        try:
            error_log = ChatLog(
                notebook_id=notebook_id,
                user_id=user_id,
                message_preview=message[:200],
                total_duration=round(time.time() - t_start, 2),
                status="error",
                error_message=str(e)[:500],
                thinking_mode=False,
            )
            db.add(error_log)
            await db.commit()
        except Exception:
            pass
        error_str = str(e)
        if "maximum context length" in error_str or "too many tokens" in error_str.lower():
            friendly = "Selected sources contain too much data. Please select fewer sources and try again."
            yield f"data: {json.dumps({'type': 'error', 'message': friendly})}\n\n"
        elif "data_inspection_failed" in error_str.lower() or "DataInspectionFailed" in error_str:
            friendly = "The AI content filter flagged this query. Please try rephrasing your question. (内容安全审核误拦截，请尝试换个方式提问)"
            yield f"data: {json.dumps({'type': 'error', 'message': friendly})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'error', 'message': error_str})}\n\n"


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
