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


async def _rewrite_query_for_retrieval(message: str) -> str:
    """Rewrite a conversational query into concise keywords for better RAG retrieval.

    Only rewrites if the query is conversational (>5 words). Uses a fast LLM call
    with Qwen-Turbo to minimize latency.
    """
    try:
        rewrite_messages = [
            {"role": "system", "content": (
                "You are a bilingual search query optimizer. Given a user question, output optimized search keywords.\n\n"
                "Rules:\n"
                "1. Extract the core intent as 3-6 concise keywords.\n"
                "2. Add synonyms and alternative expressions to improve recall.\n"
                "3. Output keywords in BOTH English AND Chinese for cross-language retrieval.\n"
                "4. Keep named entities (names, dates, organizations) intact in their original language.\n"
                "5. Output ONLY the keywords on one line, separated by spaces. No explanation.\n\n"
                "Examples:\n"
                "Q: When was SAS International School founded?\n"
                "A: SAS founded establishment year history 创立 建校 成立时间 历史\n\n"
                "Q: 项目风险管理的步骤有哪些？\n"
                "A: 项目风险管理 步骤 流程 方法 project risk management steps process\n\n"
                "Q: What are the key differences between agile and waterfall?\n"
                "A: agile waterfall differences comparison methodology 敏捷 瀑布 区别 对比 方法论"
            )},
            {"role": "user", "content": f"Q: {message}\nA:"},
        ]
        rewrite_model = settings.RAG_REWRITE_MODEL or None  # None = use default
        rewritten = await qwen_client.generate(
            rewrite_messages,
            model=rewrite_model,
            temperature=0.0,
            max_tokens=80,
        )
        rewritten = rewritten.strip().strip('"').strip("'")
        if rewritten and not rewritten.startswith("[Error"):
            logger.info("Query rewrite: [%s] -> [%s]", message, rewritten)
            return rewritten
    except Exception as e:
        logger.warning("Query rewrite failed, using original: %s", e)
    return message


REACT_SYSTEM_PROMPT = """You are a research assistant that finds answers by searching through documents step by step.

Use this EXACT format:

Thought: [your reasoning about what you need to find]
Search: [first search query — concise keywords]
Search: [second search query — different angle]
Search: [third search query — yet another angle]

After receiving search results, you MUST first update your research notes, then continue:

Notes: [cumulative summary of ALL facts learned so far, and what is still MISSING to answer the question]
Thought: [based on your notes, what should you search next?]
Search: [query 1]
Search: [query 2]
Search: [query 3]

OR if you have enough evidence:

Notes: [final summary of all evidence]
Thought: [your reasoning chain connecting the evidence to the answer]
Answer: [your complete answer with [1][2] citations]

Rules:
- ALWAYS include Notes: to track what you've learned across rounds. This is critical.
- Output EXACTLY 3 Search queries per round, each targeting DIFFERENT evidence.
- If direct search fails, think about what INDIRECT evidence could answer the question.
- Compare information across different time periods or documents to detect changes.
- In your Answer, use [1], [2] etc. to cite sources.
- CRITICAL: Always respond in the SAME LANGUAGE as the user's question.
- Even with partial evidence, reason from what you found and state your confidence level.
- Format your Answer using Markdown when appropriate."""

REACT_MAX_ROUNDS = settings.RAG_THINK_ROUNDS or 5


async def _react_step(messages: list[dict], model: str | None = None) -> str:
    """Run one ReAct step: get Thought + Search queries or Answer from LLM."""
    decompose_model = model or settings.RAG_DECOMPOSE_MODEL or None
    return await qwen_client.generate(
        messages,
        model=decompose_model,
        temperature=0.0,
        max_tokens=500,
    )


def _parse_react_output(text: str) -> tuple[str, str, list[str], str | None]:
    """Parse ReAct output into (notes, thought, search_queries, answer).

    Returns (notes, thought, [queries], None) if more search needed,
    or (notes, thought, [], answer) if final answer reached.
    """
    notes = ""
    thought = ""
    search_queries: list[str] = []
    answer = None

    lines = text.strip().split("\n")
    for line in lines:
        line_stripped = line.strip()
        if line_stripped.lower().startswith("notes:"):
            notes = line_stripped[len("Notes:"):].strip()
        elif line_stripped.lower().startswith("thought:"):
            thought = line_stripped[len("Thought:"):].strip()
        elif line_stripped.lower().startswith("search:"):
            q = line_stripped[len("Search:"):].strip()
            if q:
                search_queries.append(q)
        elif line_stripped.lower().startswith("answer:"):
            answer_start = text.lower().find("answer:")
            if answer_start >= 0:
                answer = text[answer_start + len("Answer:"):].strip()
            break

    return notes, thought, search_queries, answer


async def stream_chat(
    db: AsyncSession,
    notebook_id: uuid.UUID,
    user_id: uuid.UUID,
    message: str,
    source_ids: list[str] | None = None,
    web_search: bool = False,
    deep_thinking: bool = False,
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
        logger.info("Excel sources found: %d, source_ids: %s, deep_thinking: %s", len(excel_sources), source_ids, deep_thinking)

        # Step 2a: Query rewrite — convert conversational queries to keyword-focused for better retrieval
        retrieval_query = message
        if dataset_ids and len(message.split()) > 5:
            retrieval_query = await _rewrite_query_for_retrieval(message)

        # Step 2b: RAGFlow retrieval — find relevant chunks across all sources
        excel_context = None
        sql_answer = None

        chunks = []
        react_steps: list[dict] = []  # Track ReAct steps for logging
        if dataset_ids:
            filter_doc_ids = document_ids if source_ids and document_ids else None

            if deep_thinking:
                # ReAct loop: Thought → Search → Observation → ... → Answer
                all_chunks: dict[str, dict] = {}  # chunk_id → chunk (deduped)
                react_messages = [
                    {"role": "system", "content": REACT_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Question: {message}"},
                ]
                react_answer = None

                for round_num in range(1, REACT_MAX_ROUNDS + 1):
                    # Get LLM thought + action
                    step_output = await _react_step(react_messages)
                    logger.info("ReAct round %d raw output: %s", round_num, step_output[:500])
                    notes, thought, search_queries, answer = _parse_react_output(step_output)

                    # Force search in first 2 rounds — don't let LLM skip retrieval
                    if round_num <= 2 and (answer or not search_queries):
                        if not search_queries:
                            logger.info("ReAct round %d: no queries, forcing search from thought", round_num)
                            search_queries = [thought[:100] if thought else message]
                        answer = None

                    # Stream notes + thinking step to user
                    if notes:
                        yield f"data: {json.dumps({'type': 'thinking', 'step': round_num, 'thought': '📝 ' + notes})}\n\n"
                    if thought:
                        yield f"data: {json.dumps({'type': 'thinking', 'step': round_num, 'thought': thought})}\n\n"

                    if answer and round_num >= 3:
                        react_answer = answer
                        react_steps.append({"round": round_num, "thought": thought, "action": "answer"})
                        logger.info("ReAct round %d: answer reached", round_num)
                        break

                    if not search_queries:
                        react_steps.append({"round": round_num, "thought": thought, "action": "no_action"})
                        break

                    # Stream searching event — show all queries
                    query_display = " | ".join(search_queries[:3])
                    yield f"data: {json.dumps({'type': 'searching', 'step': round_num, 'query': query_display})}\n\n"

                    # Execute concurrent retrieval for all queries
                    import asyncio

                    async def _retrieve_one(q: str) -> list[dict]:
                        return await ragflow_client.retrieve(
                            dataset_ids, q, top_k=settings.RAG_TOP_K, document_ids=filter_doc_ids
                        )

                    retrieval_results = await asyncio.gather(*[_retrieve_one(q) for q in search_queries[:3]])

                    # Merge and deduplicate
                    round_total = 0
                    new_count = 0
                    for result_chunks in retrieval_results:
                        round_total += len(result_chunks)
                        for chunk in result_chunks:
                            chunk_id = chunk.get("id", chunk.get("chunk_id", ""))
                            if chunk_id not in all_chunks:
                                all_chunks[chunk_id] = chunk
                                new_count += 1

                    # Build observation summary from all results merged
                    all_round = []
                    for result_chunks in retrieval_results:
                        all_round.extend(result_chunks)
                    # Sort by similarity, take top excerpts
                    all_round.sort(key=lambda c: c.get("similarity", 0), reverse=True)
                    obs_parts = []
                    for idx, c in enumerate(all_round[:8], 1):
                        text = c.get("content_with_weight", c.get("content", ""))[:500]
                        doc = c.get("document_keyword", c.get("docnm_kwd", "unknown"))
                        obs_parts.append(f"  [{idx}] ({doc}): {text}")
                    observation = f"Found {round_total} results from {len(search_queries)} queries ({new_count} new unique). Top excerpts:\n" + "\n".join(obs_parts)

                    # Stream observation to user
                    yield f"data: {json.dumps({'type': 'observation', 'step': round_num, 'found': round_total, 'new': new_count})}\n\n"

                    react_steps.append({
                        "round": round_num, "thought": thought,
                        "searches": search_queries[:3], "found": round_total, "new": new_count,
                    })
                    logger.info("ReAct round %d: %d queries=%s, found=%d, new=%d, total=%d",
                                round_num, len(search_queries), search_queries[:3], round_total, new_count, len(all_chunks))

                    # Feed observation back to LLM with escalating strategy guidance
                    react_messages.append({"role": "assistant", "content": step_output})
                    max_rounds = REACT_MAX_ROUNDS
                    if round_num <= 2:
                        guidance = (
                            "Update your Notes: what facts did you learn? What is still MISSING to answer the question? "
                            "Based on your notes, output Thought + 3 Search queries targeting what's missing. "
                            "Do NOT give an Answer yet."
                        )
                    elif round_num < max_rounds:
                        guidance = (
                            "Update your Notes with new findings. Review what you know and what's still missing. "
                            "If you can reason to the answer from your accumulated evidence, provide your Answer. "
                            "Otherwise, output Thought + 3 Search queries for what's still missing."
                        )
                    else:
                        guidance = (
                            "Final round. Write your complete Notes summarizing ALL evidence. "
                            "Provide your Answer by reasoning from your notes. Show your reasoning chain."
                        )
                    react_messages.append({"role": "user", "content": f"Observation: {observation}\n\n{guidance}"})

                # Collect all unique chunks sorted by similarity, take top-15
                chunks = sorted(all_chunks.values(), key=lambda c: c.get("similarity", 0), reverse=True)[:15]
                logger.info("ReAct complete: %d rounds, %d total unique chunks -> top %d",
                            len(react_steps), len(all_chunks), len(chunks))
            else:
                chunks = await ragflow_client.retrieve(
                    dataset_ids, retrieval_query, top_k=settings.RAG_TOP_K, document_ids=filter_doc_ids
                )
        t_ragflow_end = time.time()

        # Step 2c: If we have Excel sources, check if RAGFlow found relevant Excel chunks.
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

        # Fetch conversation history — up to 10 rounds (20 messages) capped at ~10K tokens (~20K chars)
        # RAG best practice: 5-10 rounds. More history dilutes retrieval relevance.
        MAX_HISTORY_ROUNDS = 10
        MAX_HISTORY_CHARS = 20000
        history = await get_chat_history(db, notebook_id, user_id)
        history = [h for h in history if h.id != user_msg.id]
        # If last assistant message was an error, skip all history to avoid content filter loops
        last_assistant = next((h for h in reversed(history) if h.role == "assistant"), None)
        if last_assistant and last_assistant.content.strip().startswith("[Error:"):
            logger.info("Last response was an error — sending without chat history to avoid content filter loop")
            history = []
        else:
            # Filter out any error messages from history
            history = [h for h in history if not h.content.strip().startswith("[Error:")]
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

        # Dynamic context budget based on configured context window.
        # Reserve 25% for normal queries, 80% for Excel-heavy queries.
        # Convert tokens to chars (~2 chars per token).
        context_window = settings.LLM_CONTEXT_WINDOW
        has_excel_data = excel_context is not None or sql_answer is not None
        MAX_TOTAL_CHARS = int(context_window * 1.6) if has_excel_data else int(context_window * 0.5)
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

        # Deep Thinking: ReAct already did multi-round reasoning — final answer should synthesize
        if deep_thinking:
            system_prompt += """
9. DEEP THINKING MODE — these sources were gathered through multi-round research. Synthesize them:
   a. If the answer requires combining facts from multiple sources, show your reasoning:
      "Source [X] states A. Source [Y] states B. Combining these, we can conclude C."
   b. If information is partially available, say what CAN be determined and what cannot.
   c. Do NOT just summarize each source separately — synthesize and reason across them."""

        messages = [
            {"role": "system", "content": system_prompt},
            *history_messages,
            {"role": "user", "content": user_content},
        ]

        # Debug: log total prompt size and first 500 chars of user content
        total_chars = sum(len(m["content"]) for m in messages)
        logger.info("LLM prompt: %d messages, %d total chars, user_content[:500]=%s", len(messages), total_chars, user_content[:500])

        # 4. Stream response from LLM — send keepalive then stream tokens
        yield ": keepalive\n\n"
        full_response = ""
        t_llm_start = time.time()
        async for token in qwen_client.stream_chat(messages, enable_search=web_search):
            if token.startswith("\n\n[Error:"):
                # Don't save error tokens to full_response (prevents poisoning chat history)
                if "maximum context length" in token:
                    friendly = "Selected sources contain too much data. Please select fewer sources and try again."
                elif "内容安全审核" in token or "content filter" in token.lower():
                    friendly = "内容安全审核误拦截，请尝试换个方式提问或减少勾选的文档。"
                else:
                    friendly = token.replace("\n\n[Error: ", "").rstrip("]")
                # Save error to ChatLog so admin panel shows it correctly
                try:
                    err_log = ChatLog(
                        notebook_id=notebook_id,
                        user_id=user_id,
                        message_preview=message[:200],
                        total_duration=round(time.time() - t_start, 2),
                        status="error",
                        error_message=friendly[:500],
                        thinking_mode=deep_thinking,
                    )
                    db.add(err_log)
                    await db.commit()
                except Exception:
                    pass
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
                response_preview=full_response[:200] if full_response else None,
                response_full=full_response or None,
                message_id=assistant_msg.id,
                total_duration=round(time.time() - t_start, 2),
                ragflow_duration=round(t_ragflow_end - t_ragflow_start, 2) if t_ragflow_end else None,
                excel_duration=round(t_excel_end - t_excel_start, 2) if t_excel_end else None,
                llm_duration=round(t_llm_end - t_llm_start, 2) if t_llm_end else None,
                llm_first_token=round(t_first_token - t_llm_start, 2) if t_first_token else None,
                source_count=len(sources_map),
                chunk_count=len(chunks),
                thinking_mode=deep_thinking,
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
                thinking_mode=deep_thinking,
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
