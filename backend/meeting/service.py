"""Meeting business logic — CRUD, end-meeting flow, live transcript."""
import logging
import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.database import async_session
from backend.meeting.asr_client import asr_client, Utterance
from backend.meeting.models import Meeting, MeetingUtterance
from backend.models.source import Source
from backend.services.document_pipeline import process_document
from backend.services.event_bus import event_bus
from backend.services.qwen_client import qwen_client
from backend.services.source_service import update_source_status

logger = logging.getLogger(__name__)


async def create_meeting(
    db: AsyncSession, notebook_id: uuid.UUID, user_id: uuid.UUID
) -> Meeting:
    """Create a new meeting. Auto-ends any active meeting by this user in any notebook."""
    # End all active meetings by this user (across all notebooks)
    result = await db.execute(
        select(Meeting).where(
            Meeting.created_by == user_id,
            Meeting.status.in_(["recording", "paused"]),
        )
    )
    active_meetings = list(result.scalars().all())
    for m in active_meetings:
        m.status = "ended"
        m.ended_at = datetime.now(timezone.utc)
        if m.started_at:
            m.duration_seconds = int((m.ended_at - m.started_at).total_seconds())
        logger.info("Auto-ended meeting %s in notebook %s (user started new meeting)", m.id, m.notebook_id)
        # Close ASR session if still active
        try:
            await asr_client.end_session(str(m.id))
        except Exception:
            pass
    if active_meetings:
        await db.commit()

    meeting = Meeting(
        notebook_id=notebook_id,
        created_by=user_id,
        status="recording",
        speaker_map={},
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)
    logger.info("Meeting %s created in notebook %s", meeting.id, notebook_id)
    return meeting


async def get_meeting(db: AsyncSession, meeting_id: uuid.UUID) -> Meeting | None:
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    return result.scalar_one_or_none()


async def get_active_meeting(
    db: AsyncSession, notebook_id: uuid.UUID
) -> Meeting | None:
    result = await db.execute(
        select(Meeting).where(
            Meeting.notebook_id == notebook_id,
            Meeting.status.in_(["recording", "paused"]),
        )
    )
    return result.scalar_one_or_none()


async def update_speaker_map(
    db: AsyncSession, meeting_id: uuid.UUID, speaker_map: dict[str, str]
) -> Meeting:
    meeting = await get_meeting(db, meeting_id)
    if not meeting:
        raise ValueError("Meeting not found")
    meeting.speaker_map = {**meeting.speaker_map, **speaker_map}
    await db.commit()
    await db.refresh(meeting)
    return meeting


async def save_utterance(
    db: AsyncSession, meeting_id: uuid.UUID, utterance: Utterance
) -> MeetingUtterance:
    """Persist or update an utterance in the database (upsert by meeting_id + sequence + provider)."""
    provider = utterance.provider or ""
    # Check if utterance with same sequence+provider already exists
    result = await db.execute(
        select(MeetingUtterance).where(
            MeetingUtterance.meeting_id == meeting_id,
            MeetingUtterance.sequence == utterance.sequence,
            MeetingUtterance.provider == provider,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        # Update existing (e.g. LLM rewrite replaces partial)
        existing.text = utterance.text
        existing.is_final = utterance.is_final
    else:
        record = MeetingUtterance(
            meeting_id=meeting_id,
            speaker_id=utterance.speaker_id,
            text=utterance.text,
            start_time_ms=utterance.start_time_ms,
            end_time_ms=utterance.end_time_ms,
            is_final=utterance.is_final,
            sequence=utterance.sequence,
            provider=provider,
        )
        db.add(record)
    await db.commit()
    return existing or record


async def get_utterances(
    db: AsyncSession, meeting_id: uuid.UUID
) -> list[MeetingUtterance]:
    result = await db.execute(
        select(MeetingUtterance)
        .where(MeetingUtterance.meeting_id == meeting_id)
        .order_by(MeetingUtterance.sequence)
    )
    return list(result.scalars().all())


async def get_live_transcript_for_notebook_async(notebook_id: str) -> str:
    """Get live meeting transcript for chat context.
    Always uses speaker_map to replace speaker IDs with names."""
    try:
        async with async_session() as db:
            meeting = await get_active_meeting(db, uuid.UUID(notebook_id))
            if not meeting:
                return ""

            speaker_map = meeting.speaker_map or {}

            # Try in-memory ASR session first (most up-to-date)
            session = asr_client.get_session(str(meeting.id))
            if session and not session.is_ended and session.utterances:
                lines = []
                for u in session.utterances:
                    name = speaker_map.get(u.speaker_id, u.speaker_id)
                    ts = f"{u.start_time_ms // 60000:02d}:{(u.start_time_ms // 1000) % 60:02d}"
                    lines.append(f"[{name}] ({ts}) {u.text}")
                return "\n".join(lines)

            # Fallback: read from DB (e.g. after page refresh, ASR session closed)
            utterances = await get_utterances(db, meeting.id)
            if utterances:
                lines = []
                for u in utterances:
                    name = speaker_map.get(u.speaker_id, u.speaker_id)
                    ts = f"{u.start_time_ms // 60000:02d}:{(u.start_time_ms // 1000) % 60:02d}"
                    lines.append(f"[{name}] ({ts}) {u.text}")
                return "\n".join(lines)
    except Exception:
        pass
    return ""


async def end_meeting(
    db: AsyncSession, meeting_id: uuid.UUID
) -> Source:
    """End meeting: close ASR, format transcript, create source, trigger RAG."""
    meeting = await get_meeting(db, meeting_id)
    if not meeting:
        raise ValueError("Meeting not found")
    if meeting.status == "ended":
        raise ValueError("Meeting already ended")

    # 1. Close ASR session and get final utterances
    final_utterances = await asr_client.end_session(str(meeting_id))

    # 2. Fetch all persisted utterances (includes any missed during disconnect)
    db_utterances = await get_utterances(db, meeting_id)

    # 3. Merge: DB utterances + any final ASR-only ones not yet saved
    db_seqs = {u.sequence for u in db_utterances}
    extra = [u for u in final_utterances if u.sequence not in db_seqs and u.text.strip()]
    all_utterances = list(db_utterances) + extra
    if extra:
        logger.info("Merged %d extra utterances from ASR flush", len(extra))

    # 4. Apply speaker map
    speaker_map = meeting.speaker_map or {}

    # 5. Format transcript as markdown
    from datetime import timedelta
    beijing_tz_offset = timedelta(hours=8)
    meeting_start = meeting.started_at

    lines = []
    for u in all_utterances:
        if not u.text.strip():
            continue
        # Use friendly name, fall back to "Speaker N" instead of raw "speaker_0"
        speaker_name = speaker_map.get(u.speaker_id, u.speaker_id.replace("_", " ").title())
        # Calculate Beijing wall clock time from meeting start + offset
        if meeting_start:
            wall = meeting_start + timedelta(milliseconds=u.start_time_ms) + beijing_tz_offset
            time_str = wall.strftime("%H:%M")
        else:
            ts_min = u.start_time_ms // 60000
            ts_sec = (u.start_time_ms // 1000) % 60
            time_str = f"{ts_min:02d}:{ts_sec:02d}"
        lines.append(f"{time_str} {u.text}\n")

    transcript_md = "\n".join(lines)

    # 6. Generate title via LLM — format: YYMMDD 主题
    from datetime import timedelta as _td
    beijing_tz = timezone(_td(hours=8))
    date_prefix = datetime.now(beijing_tz).strftime("%y%m%d")
    title = f"{date_prefix} Meeting Transcript"
    if transcript_md.strip():
        try:
            preview = transcript_md[:2000]
            title_prompt = (
                "根据以下会议转录内容，用中文生成一个简短的主题词（2-6个字，不要日期，不要引号）。"
                "例如：产品评审、锵锵三人行、周会纪要、技术方案讨论\n\n" + preview
            )
            generated = await qwen_client.generate(
                messages=[{"role": "user", "content": title_prompt}],
                max_tokens=30,
            )
            topic = generated.strip().strip('"').strip("'").strip("《》")[:20]
            if topic and "请提供" not in topic and "没有提供" not in topic:
                title = f"{date_prefix} {topic}"
        except Exception as e:
            logger.warning("Failed to generate meeting title: %s", e)
    else:
        logger.warning("Empty transcript for meeting %s, skipping LLM title generation", meeting_id)

    # 7. Calculate duration
    now = datetime.now(timezone.utc)
    duration = int((now - meeting.started_at).total_seconds()) if meeting.started_at else 0

    # 8. Prepend header to transcript
    date_str = meeting.started_at.strftime("%Y-%m-%d %H:%M")
    duration_str = f"{duration // 60}m {duration % 60}s"
    full_md = f"# {title}\n\n*{date_str} | Duration: {duration_str}*\n\n---\n\n{transcript_md}"

    # 9. Save markdown file
    notebook_id = str(meeting.notebook_id)
    source_id = uuid.uuid4()
    upload_dir = os.path.join(settings.UPLOAD_DIR, notebook_id)
    os.makedirs(upload_dir, exist_ok=True)
    md_path = os.path.join(upload_dir, f"{source_id}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(full_md)

    # 10. Create Source record — commit FIRST to satisfy FK constraint
    source = Source(
        id=source_id,
        notebook_id=meeting.notebook_id,
        uploaded_by=meeting.created_by,
        filename=f"{title}.md",
        file_type="meeting",
        file_size=len(full_md.encode("utf-8")),
        storage_url=md_path,
        status="uploading",
    )
    db.add(source)
    await db.flush()  # INSERT source before updating meeting FK

    # 11. Update meeting record
    meeting.status = "ended"
    meeting.ended_at = now
    meeting.duration_seconds = duration
    meeting.title = title
    meeting.source_id = source_id
    await db.commit()
    await db.refresh(source)

    # 12. Also save parsed content for fallback
    parsed_path = os.path.splitext(md_path)[0] + "_parsed.md"
    with open(parsed_path, "w", encoding="utf-8") as f:
        f.write(full_md)

    # 13. Trigger document pipeline in background
    import asyncio
    asyncio.create_task(
        process_document(
            str(source_id), notebook_id, md_path,
            f"{title}.md", "meeting",
        )
    )

    logger.info(
        "Meeting %s ended: title=%s, duration=%ds, source=%s",
        meeting_id, title, duration, source_id,
    )

    # 14. Notify via SSE
    await event_bus.publish(notebook_id, {
        "type": "meeting_ended",
        "meeting_id": str(meeting_id),
        "source_id": str(source_id),
        "title": title,
    })

    # 15. Generate meeting minutes in background
    if transcript_md.strip():
        import asyncio as _aio
        _aio.create_task(_generate_meeting_minutes_safe(meeting.id, meeting.notebook_id, meeting.created_by, title, transcript_md, meeting.started_at, duration))

    return source


_MINUTES_PROMPT = """你是专业的会议纪要助手。根据以下会议转录内容生成结构化会议纪要。

会议信息：
- 会议名称：{title}
- 时间：{start_time}
- 时长：{duration}

转录内容：
{transcript}

请用 Markdown 格式输出，包含以下章节：

## 📋 会议概要
（2-3句话概括核心内容和结论）

## 📝 详细纪要
（按主题分层列出要点，使用多级缩进列表，保留具体数据、人名、产品名等）

## ✅ 关键决策
（列出明确达成的决策。如无明确决策则跳过此节）

## 💬 重要发言
（值得记录的原话引用，用「」标注。如无则跳过此节）

## 📑 章节时间线
（按时间段划分：HH:MM 主题概述）

写作原则：保留所有具体数据，语言简洁专业，信息密度高。如转录内容过短无实质内容，仅输出简短说明。
加注："智能纪要由 AI 生成，可能存在不准确之处，请谨慎甄别后使用"
"""


async def _generate_meeting_minutes(
    meeting_id: uuid.UUID,
    notebook_id: uuid.UUID,
    user_id: uuid.UUID,
    title: str,
    transcript: str,
    started_at: datetime | None,
    duration_seconds: int,
) -> None:
    """Generate meeting minutes via LLM and save as a chat message."""
    import re
    from backend.models.chat_message import ChatMessage

    # Skip if transcript too short
    clean = transcript.strip()
    if len(clean) < 50:
        logger.info("Transcript too short (%d chars), skipping minutes for %s", len(clean), meeting_id)
        return

    # Format time info
    from datetime import timedelta
    beijing_tz = timezone(timedelta(hours=8))
    start_str = started_at.astimezone(beijing_tz).strftime("%Y-%m-%d %H:%M") if started_at else "Unknown"
    dur_min = duration_seconds // 60
    dur_sec = duration_seconds % 60
    duration_str = f"{dur_min}分{dur_sec}秒"

    # Truncate transcript if too long
    truncated = transcript[:6000]
    if len(transcript) > 6000:
        truncated += "\n\n... (转录内容过长，已截取前6000字)"

    prompt = _MINUTES_PROMPT.format(
        title=title,
        start_time=start_str,
        duration=duration_str,
        transcript=truncated,
    )

    # Generate via LLM
    minutes_text = await qwen_client.generate(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096,
    )

    if not minutes_text or minutes_text.startswith("[Error"):
        logger.error("Meeting minutes generation failed for %s: %s", meeting_id, minutes_text[:100] if minutes_text else "empty")
        return

    # Extract summary from 会议概要 section
    summary_match = re.search(r"##\s*📋\s*会议概要\s*\n+(.*?)(?=\n##|\Z)", minutes_text, re.DOTALL)
    collapsed_summary = summary_match.group(1).strip()[:150] if summary_match else minutes_text[:100]

    # Save as chat message
    async with async_session() as db:
        msg = ChatMessage(
            notebook_id=notebook_id,
            user_id=user_id,
            role="assistant",
            content=minutes_text,
            citations=[],
            metadata={
                "type": "meeting_minutes",
                "meeting_id": str(meeting_id),
                "title": title,
                "collapsed_summary": collapsed_summary,
            },
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)

        # Push via SSE
        await event_bus.publish(str(notebook_id), {
            "type": "meeting_minutes_ready",
            "message": {
                "id": str(msg.id),
                "notebook_id": str(msg.notebook_id),
                "user_id": str(msg.user_id),
                "role": "assistant",
                "content": msg.content,
                "citations": [],
                "metadata": msg.metadata,
                "created_at": msg.created_at.isoformat(),
            },
        })

    logger.info("Meeting minutes generated for %s (%d chars)", meeting_id, len(minutes_text))


async def _generate_meeting_minutes_safe(
    meeting_id: uuid.UUID,
    notebook_id: uuid.UUID,
    user_id: uuid.UUID,
    title: str,
    transcript: str,
    started_at: datetime | None,
    duration_seconds: int,
) -> None:
    """Safe wrapper — never raises."""
    try:
        await _generate_meeting_minutes(meeting_id, notebook_id, user_id, title, transcript, started_at, duration_seconds)
    except Exception as e:
        logger.error("Meeting minutes generation failed: %s", e, exc_info=True)


MEETING_STALE_MINUTES = 5  # Auto-end meetings with no WebSocket after this many minutes


async def auto_end_stale_meetings() -> None:
    """Background task: auto-end meetings that have been recording for 5+ minutes
    without an active WebSocket connection (user closed browser)."""
    import asyncio
    from datetime import timedelta

    while True:
        await asyncio.sleep(60)  # Check every minute
        try:
            async with async_session() as db:
                result = await db.execute(
                    select(Meeting).where(Meeting.status.in_(["recording", "paused"]))
                )
                active = list(result.scalars().all())
                now = datetime.now(timezone.utc)

                for m in active:
                    # Check if ASR session exists (= WebSocket connected)
                    session = asr_client.get_session(str(m.id))
                    if session and not session.is_ended:
                        continue  # Active WebSocket, skip

                    # No active session — check how long since last activity
                    age = (now - m.started_at).total_seconds() / 60 if m.started_at else 999
                    if age < MEETING_STALE_MINUTES:
                        continue  # Too recent, give user time to resume

                    # Check if meeting was updated recently (e.g. utterances saved)
                    last_utt = await db.execute(
                        select(MeetingUtterance.created_at)
                        .where(MeetingUtterance.meeting_id == m.id)
                        .order_by(MeetingUtterance.created_at.desc())
                        .limit(1)
                    )
                    last_row = last_utt.scalar_one_or_none()
                    if last_row:
                        mins_since_last = (now - last_row).total_seconds() / 60
                        if mins_since_last < MEETING_STALE_MINUTES:
                            continue  # Recent utterance, skip

                    # Stale meeting — auto-end
                    logger.info("Auto-ending stale meeting %s (no WebSocket for %d+ min)", m.id, MEETING_STALE_MINUTES)
                    try:
                        await end_meeting(db, m.id)
                    except Exception as e:
                        # If end_meeting fails (e.g. already ended), just mark as ended
                        m.status = "ended"
                        m.ended_at = now
                        await db.commit()
                        logger.warning("Force-ended stale meeting %s: %s", m.id, e)
        except Exception as e:
            logger.error("auto_end_stale_meetings error: %s", e)
