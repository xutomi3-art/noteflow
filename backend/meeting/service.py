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
    """Persist an utterance to the database."""
    record = MeetingUtterance(
        meeting_id=meeting_id,
        speaker_id=utterance.speaker_id,
        text=utterance.text,
        start_time_ms=utterance.start_time_ms,
        end_time_ms=utterance.end_time_ms,
        is_final=utterance.is_final,
        sequence=utterance.sequence,
    )
    db.add(record)
    await db.commit()
    return record


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

    # 3. Merge: prefer DB utterances (more complete), add any final ASR-only ones
    all_utterances = db_utterances
    # Note: final_utterances from ASR may include last few that weren't saved yet

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
        if topic:
            title = f"{date_prefix} {topic}"
    except Exception as e:
        logger.warning("Failed to generate meeting title: %s", e)

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

    return source
