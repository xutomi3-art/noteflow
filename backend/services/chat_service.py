import asyncio
import hashlib
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
            "excerpt": text if text else "",
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


def _merge_and_dedup_chunks(chunks_a: list[dict], chunks_b: list[dict]) -> list[dict]:
    """Merge chunks from dual retrieval, dedup by chunk_id, keep highest similarity."""
    seen: dict[str, dict] = {}
    for chunk in chunks_a + chunks_b:
        chunk_id = chunk.get("id", chunk.get("chunk_id", ""))
        if not chunk_id:
            doc_id = chunk.get("doc_id", chunk.get("document_id", ""))
            content = chunk.get("content_with_weight", chunk.get("content", ""))
            chunk_id = hashlib.md5(f"{doc_id}:{content}".encode()).hexdigest()
            chunk["id"] = chunk_id
        if chunk_id not in seen or chunk.get("similarity", 0) > seen[chunk_id].get("similarity", 0):
            seen[chunk_id] = chunk
    return list(seen.values())


async def _rewrite_query_for_retrieval(message: str) -> tuple[str, str]:
    """Rewrite query for dual-path retrieval (bilingual).

    Returns (q1, q2):
      q1 = original message + same-language keywords
      q2 = translation + target-language keywords
    """
    try:
        rewrite_messages = [
            {"role": "system", "content": (
                "You are a search query optimizer. Given a user question, output EXACTLY 3 lines:\n"
                "Line 1: Translate the question to the OTHER language (Chinese→English or English→Chinese). Expand abbreviations to full names.\n"
                "Line 2: 3-5 English search keywords/synonyms (comma-separated)\n"
                "Line 3: 3-5 Chinese search keywords/synonyms (comma-separated)\n\n"
                "Rules:\n"
                "- Output ONLY 3 lines, no labels, no numbering, no extra text\n"
                "- Expand abbreviations: SAS→Shanghai American School, BOT→Board of Trustees\n"
                "- Include synonyms: founded→established, created, inception\n\n"
                "Examples:\n"
                "Input: 美校成立时间\n"
                "When was Shanghai American School established?\n"
                "established, founding, creation, inception date\n"
                "成立, 创办, 创立, 建校时间\n\n"
                "Input: When was the Board last expanded?\n"
                "董事会最近一次扩充是什么时候？\n"
                "Board expansion, enlarged, added members, board size\n"
                "董事会, 扩充, 扩大, 增加席位, 成员变动\n\n"
                "Input: Tell me about tuition\n"
                "介绍一下学费情况\n"
                "tuition, fees, cost, annual tuition, school fees\n"
                "学费, 费用, 收费, 年度学费"
            )},
            {"role": "user", "content": message},
        ]
        rewrite_model = settings.RAG_REWRITE_MODEL or None
        result = await qwen_client.generate(
            rewrite_messages,
            model=rewrite_model,
            temperature=0.0,
            max_tokens=200,
        )
        result = result.strip().strip('"').strip("'")
        if not result or result.startswith("[Error"):
            return message, message

        lines = [l.strip() for l in result.split("\n") if l.strip()]
        if len(lines) < 3:
            logger.warning("Query rewrite returned %d lines (expected 3), fallback", len(lines))
            return message, message

        translation = lines[0]
        en_keywords = lines[1]
        zh_keywords = lines[2]

        # Detect input language (simple heuristic: has CJK chars = Chinese)
        is_chinese = any('\u4e00' <= c <= '\u9fff' for c in message)

        if is_chinese:
            q1 = f"{message}\n{zh_keywords}"
            q2 = f"{translation}\n{en_keywords}"
        else:
            q1 = f"{message}\n{en_keywords}"
            q2 = f"{translation}\n{zh_keywords}"

        logger.info("Dual rewrite: q1=[%s] q2=[%s]", q1.replace('\n', ' | '), q2.replace('\n', ' | '))
        return q1, q2

    except Exception as e:
        logger.warning("Query rewrite failed, using original: %s", e)
    return message, message


REACT_SYSTEM_PROMPT = """You are a research assistant. You answer questions by searching through documents in multiple rounds.

FORMAT — follow exactly:

Notes: [running summary: what you KNOW so far, what you still NEED to find]
Thought: [your plan for this round of searching]
Search: [query 1 — concise keywords]
Search: [query 2 — different angle]
Search: [query 3 — yet another angle]

When you have enough evidence:

Notes: [complete summary of all findings]
Thought: [how you connect the evidence to reach your conclusion]
Answer: [your answer with [1][2] citations]

RULES:
1. Always output Notes first. Notes accumulate — never discard earlier findings.
2. Output exactly 3 Search queries per round. Each must seek DIFFERENT information.
3. If you cannot find the answer directly, reason about what evidence WOULD help and search for that instead.
4. Respond in the SAME LANGUAGE as the user's question.
5. In your Answer, cite sources with [1], [2] etc. Use Markdown formatting.
6. State your confidence level. If uncertain, explain what evidence is missing."""

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
    t_llm_start = t_llm_end = None
    t_first_token = None
    sources_map: dict = {}
    chunks: list[dict] = []
    excel_sources: list = []
    full_response = ""

    try:
        # Check shared_chat mode
        from backend.models.notebook import Notebook
        nb = await db.get(Notebook, notebook_id)
        is_shared_chat = nb.shared_chat if nb else False

        # Resolve user name for shared chat display
        user_name = ""
        if is_shared_chat:
            from backend.models.user import User
            u = await db.get(User, user_id)
            user_name = (u.name or u.email.split("@")[0]) if u else ""

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

        # Broadcast to team in shared chat mode
        if is_shared_chat:
            from backend.services.event_bus import event_bus
            await event_bus.publish(str(notebook_id), {
                "type": "shared_chat_message",
                "message_id": str(user_msg.id),
                "user_id": str(user_id),
                "user_name": user_name,
                "role": "user",
                "content": message,
            })

        # 2. Send heartbeat before slow RAGFlow retrieval
        yield ": keepalive\n\n"

        # Retrieve from RAGFlow
        dataset_ids, document_ids, sources_map = await _get_source_dataset_ids(db, notebook_id, source_ids)

        # Step 2a: Query rewrite — dual-path bilingual retrieval
        # Generates two queries: original language + translated language, each with keywords
        retrieval_q1 = message
        retrieval_q2 = ""
        t_rewrite_start = time.time()
        if settings.QUERY_REWRITE_ENABLED and dataset_ids and len(message) > 2:
            retrieval_q1, retrieval_q2 = await _rewrite_query_for_retrieval(message)
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
                react_notes = ""  # Accumulated notes from ReAct rounds

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

                    # Track latest notes for final context injection
                    if notes:
                        react_notes = notes

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
                            # Generate unique ID if missing (e.g. Dify-compatible APIs return no id)
                            if not chunk_id:
                                doc_id = chunk.get("doc_id", chunk.get("document_id", ""))
                                content = chunk.get("content_with_weight", chunk.get("content", ""))
                                chunk_id = hashlib.md5(f"{doc_id}:{content}".encode()).hexdigest()
                                chunk["id"] = chunk_id
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
                    if round_num <= 2:
                        guidance = "Update Notes. Search for what's still missing. Do NOT Answer yet."
                    elif round_num < REACT_MAX_ROUNDS:
                        guidance = "Update Notes. Answer if you can reason from your evidence, otherwise keep searching."
                    else:
                        guidance = "Final round. Answer from your accumulated Notes. Show your reasoning."
                    react_messages.append({"role": "user", "content": f"Observation: {observation}\n\n{guidance}"})

                # Collect all unique chunks sorted by similarity, take top-15
                chunks = sorted(all_chunks.values(), key=lambda c: c.get("similarity", 0), reverse=True)[:15]

                # Inject ReAct accumulated notes as a synthetic chunk so LLM sees key findings
                # that may have been in lower-similarity chunks dropped by top-15
                if react_notes:
                    notes_chunk = {
                        "id": "_react_notes",
                        "content_with_weight": f"[Research Notes]\n{react_notes}",
                        "content": react_notes,
                        "similarity": 1.0,  # Highest priority
                        "document_keyword": "Research Summary",
                        "docnm_kwd": "Research Summary",
                    }
                    chunks.insert(0, notes_chunk)

                logger.info("ReAct complete: %d rounds, %d total unique chunks -> top %d (notes=%s)",
                            len(react_steps), len(all_chunks), len(chunks), bool(react_notes))
            else:
                # Dual-path retrieval: two queries in parallel, merge and dedup
                if retrieval_q2 and retrieval_q2 != retrieval_q1:
                    chunks_q1, chunks_q2 = await asyncio.gather(
                        ragflow_client.retrieve(dataset_ids, retrieval_q1, top_k=settings.RAG_TOP_K, document_ids=filter_doc_ids),
                        ragflow_client.retrieve(dataset_ids, retrieval_q2, top_k=settings.RAG_TOP_K, document_ids=filter_doc_ids),
                    )
                    merged = _merge_and_dedup_chunks(chunks_q1, chunks_q2)
                    # Take more chunks from dual retrieval (1.5x) to avoid losing cross-language hits
                    dual_top_k = min(int(settings.RAG_TOP_K * 1.5), len(merged))
                    chunks = sorted(merged, key=lambda c: c.get("similarity", 0), reverse=True)[:dual_top_k]
                    logger.info("Dual retrieval: q1=%d, q2=%d, merged=%d, final=%d",
                                len(chunks_q1), len(chunks_q2), len(merged), len(chunks))
                else:
                    chunks = await ragflow_client.retrieve(
                        dataset_ids, retrieval_q1, top_k=settings.RAG_TOP_K, document_ids=filter_doc_ids
                    )
        t_ragflow_end = time.time()

        context, citation_metadata = _build_context_prompt(chunks, sources_map)

        # Inject live meeting transcript as primary context (if active)
        from backend.meeting.service import get_live_transcript_for_notebook_async
        meeting_transcript = await get_live_transcript_for_notebook_async(str(notebook_id))
        if meeting_transcript:
            meeting_section = f"[Live Meeting Transcript]\n{meeting_transcript}"
            if context:
                context = f"{meeting_section}\n\n---\n\n[Source Documents]\n{context}"
            else:
                context = meeting_section

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

        # Broadcast assistant response to team in shared chat mode
        if is_shared_chat:
            from backend.services.event_bus import event_bus
            await event_bus.publish(str(notebook_id), {
                "type": "shared_chat_message",
                "message_id": str(assistant_msg.id),
                "user_id": str(user_id),
                "user_name": user_name,
                "role": "assistant",
                "content": full_response,
                "citations": used_citations,
            })

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
    db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID,
    shared: bool = False,
) -> list[ChatMessage]:
    """Get chat history for a notebook.

    If shared=True, returns all users' messages (last 40 = ~20 rounds).
    Otherwise, returns only the current user's messages.
    """
    query = select(ChatMessage).where(ChatMessage.notebook_id == notebook_id)
    if not shared:
        query = query.where(ChatMessage.user_id == user_id)
    query = query.order_by(ChatMessage.created_at.asc())
    if shared:
        # Limit to last 40 messages (~20 Q&A rounds) for shared mode
        from sqlalchemy import func
        count_q = select(func.count()).where(ChatMessage.notebook_id == notebook_id)
        total = (await db.execute(count_q)).scalar() or 0
        if total > 40:
            query = query.offset(total - 40)
    result = await db.execute(query)
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
