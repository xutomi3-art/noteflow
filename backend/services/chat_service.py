import json
import logging
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

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an AI assistant that answers questions STRICTLY based on the provided source documents.
Follow these rules strictly:
1. ONLY answer based on the provided context. NEVER use your general knowledge or training data.
2. If the context does not directly answer the question, DO NOT simply say "not found". Instead:
   - Present any related or indirect information from the context that is relevant to the topic.
   - Synthesize and connect the related information to address the question as thoroughly as possible.
   - Only if there is truly NO related content at all, state that the documents do not contain this information.
3. Use inline citation markers like [1], [2], etc. to reference the source chunks.
4. Each citation number corresponds to a chunk from the context provided below.
5. Be thorough — provide comprehensive answers that draw from all relevant context, not just the most obvious match.
   When the question asks about a specific date, carefully scan ALL chunks for that exact date (in any format: YYYY/MM/DD, DD/MM/YYYY, Month DD YYYY, etc.) and prioritize chunks containing that date.
6. CRITICAL: Always respond in the SAME LANGUAGE as the user's question. If the user asks in English, you MUST answer in English even if the documents are in Chinese. If the user asks in Chinese, answer in Chinese.
7. Format your answer using Markdown when appropriate (lists, bold, headers, tables, etc.).
8. When presenting structured or tabular data, use Markdown tables (| col1 | col2 |) for clear formatting."""


_PAGE_MARKER_RE = re.compile(r"<!--\s*page:(\d+)\s*-->")


def _extract_page_from_content(text: str) -> int | None:
    """Extract PDF page number from <!-- page:N --> markers in chunk content.

    These markers are injected during document parsing by _inject_pdf_page_markers.
    Returns the last page marker found (closest to the actual content), or None.
    """
    matches = _PAGE_MARKER_RE.findall(text)
    if matches:
        return int(matches[0])  # first marker = page where this chunk starts
    return None


def _extract_page_from_positions(positions: list) -> int | None:
    """Extract page number from RAGFlow positions field (fallback).

    Note: RAGFlow positions use markdown virtual pages, not PDF page numbers.
    Prefer _extract_page_from_content() which uses injected page markers.
    """
    if not positions:
        return None
    pos = positions[0]
    if isinstance(pos, list) and len(pos) >= 5:
        return pos[0]
    if isinstance(pos, dict) and "page" in pos:
        return pos["page"]
    return None


def _build_context_prompt(chunks: list[dict], sources_map: dict) -> tuple[str, list[dict]]:
    """Build context string and citation metadata from retrieved chunks."""
    if not chunks:
        return "", []

    context_parts: list[str] = []
    citations: list[dict] = []

    for i, chunk in enumerate(chunks, 1):
        text = chunk.get("content_with_weight", chunk.get("content", ""))
        doc_name = chunk.get("document_keyword", chunk.get("docnm_kwd", "unknown"))

        location: dict = {}
        # Try to get accurate PDF page from injected <!-- page:N --> markers
        page = _extract_page_from_content(text)
        # Fallback to RAGFlow positions (less accurate for PDFs)
        if page is None:
            page = _extract_page_from_positions(chunk.get("positions", []))
        if page is not None:
            location["page"] = page

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
    """Extract keywords from query for better RAG retrieval.

    Follows RAGFlow's keyword extraction approach: extract important
    keywords/phrases and append them to the original query.
    """
    try:
        rewrite_messages = [
            {"role": "system", "content": (
                "You are a search query optimizer for cross-language document retrieval.\n"
                "Given a user question, output exactly THREE lines:\n"
                "Line 1: Translate the question into the OTHER language (Chinese→English, English→Chinese).\n"
                "Line 2: 3-5 English synonyms/related terms, comma-separated.\n"
                "Line 3: 3-5 Chinese synonyms/related terms, comma-separated.\n\n"
                "RULES:\n"
                "- If input is Chinese, Line 1 MUST be in English. If input is English, Line 1 MUST be in Chinese.\n"
                "- Line 2 is ALWAYS English keywords only.\n"
                "- Line 3 is ALWAYS Chinese keywords only.\n"
                "- Keep Line 1 as a natural sentence.\n"
                "- If the input contains abbreviations, slang, or informal terms, expand them to their full form in the translation.\n"
                "- ALWAYS output all 3 lines, even if unsure. Best-effort translation is better than nothing.\n"
                "- Output NOTHING else.\n\n"
                "Example 1:\n"
                "Input: 上海美国学校的学费与其他学校相比如何？\n"
                "Output:\n"
                "How does SAS tuition compare to other schools in the Shanghai market?\n"
                "tuition, fees, cost, comparison, schools\n"
                "学费, 费用, 对比, 学校, 国际学校\n\n"
                "Example 2:\n"
                "Input: When was SAS founded?\n"
                "Output:\n"
                "上海美国学校是什么时候成立的？\n"
                "founded, established, establishment, year\n"
                "成立, 创办, 创立, 建校"
            )},
            {"role": "user", "content": message},
        ]
        rewrite_model = settings.RAG_REWRITE_MODEL or None  # None = use default
        rewritten = await qwen_client.generate(
            rewrite_messages,
            model=rewrite_model,
            temperature=0.0,
            max_tokens=300,
        )
        rewritten = rewritten.strip().strip('"').strip("'")
        if rewritten and not rewritten.startswith("[Error"):
            logger.info("Query rewrite: [%s] -> [%r]", message, rewritten)
            return rewritten
    except Exception as e:
        logger.warning("Query rewrite failed, using original: %s", e)
    return message


REACT_SYSTEM_PROMPT = """You are an expert research analyst. You answer complex questions by systematically searching through documents in multiple rounds, building a comprehensive analysis.

FORMAT — follow exactly:

Notes:
- KNOWN: [bullet list of facts found so far with source references]
- GAPS: [bullet list of what you still NEED to find]
- SUB-QUESTIONS: [break the main question into 2-4 specific sub-questions that would fully answer it]

Thought: [your reasoning — which gaps are most important, what search strategy to use next, what angles haven't been explored]

Search: [query 1 — target a specific sub-question or gap]
Search: [query 2 — different angle or sub-question]
Search: [query 3 — yet another dimension]

When you have enough evidence (usually after 3+ rounds):

Notes:
- KNOWN: [complete bullet list of all findings]
- SYNTHESIS: [how the pieces connect to form a complete answer]

Thought: [your analytical reasoning connecting evidence across sources]
Answer: [comprehensive answer with [1][2] citations, organized with headers and bullet points]

RULES:
1. DECOMPOSE the question into sub-questions first. A question like "How does X compare to Y?" needs: (a) what metrics exist, (b) X's values, (c) Y's values, (d) qualitative differences.
2. Notes accumulate — NEVER discard earlier findings. Each round ADDS to Notes.
3. Output exactly 3 Search queries per round. Each MUST target DIFFERENT sub-questions or gaps.
4. VARY your search terms aggressively: use synonyms, related concepts, specific names, numbers, table headers. If "benchmark" doesn't work, try "comparison", "peer", "ranking", "versus", specific school names.
5. Search for SPECIFIC data: numbers, percentages, names, dates. Vague queries get vague results.
6. If a search returns no new info, CHANGE your approach completely — try different keywords, search for table/chart descriptions, or search for the specific document that would contain the data.
7. Respond in the SAME LANGUAGE as the user's question.
8. In your Answer, cite sources with [1], [2] etc. Use Markdown with headers, tables, and bullet points.
9. Provide a confidence assessment and note any gaps in the available evidence."""

REACT_MAX_ROUNDS = settings.RAG_THINK_ROUNDS or 5


async def _react_step(messages: list[dict], model: str | None = None) -> str:
    """Run one ReAct step: get Thought + Search queries or Answer from LLM."""
    decompose_model = model or settings.RAG_DECOMPOSE_MODEL or None
    return await qwen_client.generate(
        messages,
        model=decompose_model,
        temperature=0.0,
        max_tokens=1000,
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
        dataset_ids, document_ids, sources_map = await _get_source_dataset_ids(db, notebook_id, source_ids)

        # Step 2a: Query rewrite — convert conversational queries to keyword-focused for better retrieval
        # Combine original question (for vector/semantic search) with rewritten keywords (for BM25)
        retrieval_query = message
        t_rewrite_start = time.time()
        if settings.QUERY_REWRITE_ENABLED and dataset_ids and len(message.strip()) > 2:
            rewritten = await _rewrite_query_for_retrieval(message)
            if rewritten != message:
                retrieval_query = f"{message}\n{rewritten}"
        t_rewrite_duration = time.time() - t_rewrite_start

        # Step 2b: RAGFlow retrieval — find relevant chunks across all sources
        t_ragflow_start = time.time()
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
                    for idx, c in enumerate(all_round[:12], 1):
                        text = c.get("content_with_weight", c.get("content", ""))[:800]
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
                    if round_num == 1:
                        guidance = "Update Notes with KNOWN facts and remaining GAPS. Identify sub-questions. Search for what's still missing. Do NOT Answer yet."
                    elif round_num == 2:
                        guidance = "Update Notes. Check: have you found SPECIFIC data (numbers, names, dates) for each sub-question? If not, try DIFFERENT search terms — synonyms, specific names, table headers. Do NOT Answer yet."
                    elif round_num < REACT_MAX_ROUNDS:
                        guidance = "Update Notes. You should have substantial evidence by now. If key gaps remain, search with very specific terms (exact names, numbers). If you have enough evidence for most sub-questions, you may Answer with what you have."
                    else:
                        guidance = "Final round. Synthesize ALL your accumulated Notes into a comprehensive Answer. Organize by theme/sub-question. Include specific data points. Acknowledge any remaining gaps."
                    react_messages.append({"role": "user", "content": f"Observation: {observation}\n\n{guidance}"})

                # Collect all unique chunks sorted by similarity, take top-15
                chunks = sorted(all_chunks.values(), key=lambda c: c.get("similarity", 0), reverse=True)[:15]
                logger.info("ReAct complete: %d rounds, %d total unique chunks -> top %d",
                            len(react_steps), len(all_chunks), len(chunks))

                # If ReAct accumulated Notes with findings but didn't produce
                # a final Answer, inject the Notes as a synthetic "research
                # summary" chunk so the LLM sees the consolidated evidence
                # (the observations contain data that may not survive the
                # top-15 similarity filter).
                if not react_answer and react_steps:
                    # Extract the last Notes from the ReAct conversation
                    last_notes = ""
                    for msg in reversed(react_messages):
                        if msg.get("role") == "assistant" and "Notes:" in msg.get("content", ""):
                            content = msg["content"]
                            notes_start = content.find("Notes:")
                            if notes_start >= 0:
                                last_notes = content[notes_start:]
                            break
                    if last_notes and len(last_notes) > 100:
                        chunks.insert(0, {
                            "id": "react_research_summary",
                            "chunk_id": "react_research_summary",
                            "content": f"[Research Summary from deep analysis]\n{last_notes}",
                            "content_with_weight": f"[Research Summary from deep analysis]\n{last_notes}",
                            "similarity": 1.0,
                            "document_keyword": "Deep Thinking Research Notes",
                            "docnm_kwd": "Deep Thinking Research Notes",
                        })
                        logger.info("ReAct: injected research summary (%d chars) as top chunk", len(last_notes))
            else:
                # Dual retrieval: search with original message AND translated
                # query separately, then merge. Concatenating them into one query
                # causes the Chinese text to interfere with English BM25 scoring.
                import asyncio as _aio

                async def _retrieve(q: str) -> list[dict]:
                    return await ragflow_client.retrieve(
                        dataset_ids, q, top_k=settings.RAG_TOP_K, document_ids=filter_doc_ids
                    )

                # Parse rewrite output: line 1 = translation, line 2 = EN keywords, line 3 = CN keywords
                rewrite_text = retrieval_query.replace(message + "\n", "").strip() if retrieval_query != message else ""
                rewrite_lines = [l.strip() for l in rewrite_text.split("\n") if l.strip()] if rewrite_text else []

                translated = rewrite_lines[0] if rewrite_lines else ""
                en_keywords = rewrite_lines[1] if len(rewrite_lines) > 1 else ""
                cn_keywords = rewrite_lines[2] if len(rewrite_lines) > 2 else ""

                # Detect if original message is Chinese
                import unicodedata
                cn_chars = sum(1 for c in message if unicodedata.category(c).startswith('Lo'))
                is_chinese = cn_chars > len(message) * 0.1

                # Build queries: original + same-language keywords, translated + its-language keywords
                q1 = message
                if is_chinese and cn_keywords:
                    q1 = f"{message}\n{cn_keywords}"
                elif not is_chinese and en_keywords:
                    q1 = f"{message}\n{en_keywords}"

                queries = [q1]
                if translated and translated != message:
                    q2 = translated
                    if is_chinese and en_keywords:
                        q2 = f"{translated}\n{en_keywords}"
                    elif not is_chinese and cn_keywords:
                        q2 = f"{translated}\n{cn_keywords}"
                    queries.append(q2)

                logger.info("Dual retrieval queries: Q1=[%s], Q2=[%s]",
                            queries[0][:80], queries[1][:80] if len(queries) > 1 else "none")

                results = await _aio.gather(*[_retrieve(q) for q in queries])

                # Merge and deduplicate by chunk_id, keep highest similarity
                seen: dict[str, dict] = {}
                for result_chunks in results:
                    for chunk in result_chunks:
                        cid = chunk.get("id", chunk.get("chunk_id", ""))
                        if cid not in seen or chunk.get("similarity", 0) > seen[cid].get("similarity", 0):
                            seen[cid] = chunk
                chunks = sorted(seen.values(), key=lambda c: c.get("similarity", 0), reverse=True)[:settings.RAG_TOP_K]
                logger.info("Dual retrieval: %d queries, %d unique chunks -> top %d",
                            len(queries), len(seen), len(chunks))
        t_ragflow_end = time.time()

        context, citation_metadata = _build_context_prompt(chunks, sources_map)

        # DEBUG: check if 1912 is in retrieved chunks/context
        _has_1912_chunks = any("1912" in c.get("content", "") for c in chunks)
        _has_1912_context = "1912" in context if context else False
        logger.info("DEBUG 1912 check: in_chunks=%s, in_context=%s, num_chunks=%d, context_len=%d",
                     _has_1912_chunks, _has_1912_context, len(chunks), len(context) if context else 0)

        # 3. Build messages for Qwen
        has_rag = bool(context)

        if context and web_search:
            user_content = f"""Context from source documents:
{context}

Question: {message}

Answer based on the context above if relevant (cite with [1], [2]). If the context does not contain relevant information, use web search to find the answer."""
        elif context:
            user_content = f"""Context from source documents:
{context}

Question: {message}

Answer the question based on the context above. Use [1], [2], etc. to cite specific sources. If the context does not directly answer the question, present any related information and synthesize it to address the topic as thoroughly as possible."""
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
        # Convert tokens to chars (~2 chars per token for Chinese/English mix).
        context_window = settings.LLM_CONTEXT_WINDOW
        MAX_TOTAL_CHARS = int(context_window * 0.5)
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
                        message_full=message if len(message) > 200 else None,
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
                message_full=message if len(message) > 200 else None,
                response_preview=full_response[:200] if full_response else None,
                response_full=full_response or None,
                message_id=assistant_msg.id,
                total_duration=round(time.time() - t_start, 2),
                ragflow_duration=round(t_ragflow_end - t_ragflow_start, 2) if t_ragflow_end else None,
                excel_duration=None,
                llm_duration=round((t_llm_end - t_llm_start) + t_rewrite_duration, 2) if t_llm_end else None,
                llm_first_token=round(t_first_token - t_llm_start, 2) if t_first_token else None,
                source_count=len(sources_map),
                chunk_count=len(chunks),
                thinking_mode=deep_thinking,
                has_excel=False,
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
                message_full=message if len(message) > 200 else None,
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
