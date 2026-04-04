"""Meeting API endpoints — REST + WebSocket."""
import asyncio
import json
import logging
import uuid

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.auth import get_current_user
from backend.core.database import get_db, async_session
from backend.meeting.asr_client import asr_client, set_hotwords, get_hotwords, load_hotwords_from_db
from backend.meeting.schemas import MeetingCreate, MeetingOut, SpeakerUpdate, UtteranceOut
from backend.meeting import service
from backend.models.user import User
from backend.services.event_bus import event_bus

logger = logging.getLogger(__name__)

import time as _time


async def _check_suggestion_trigger(session, meeting_id: str, notebook_id: str, user_id: str) -> None:
    """Check if conditions are met to generate AI suggestions (AND logic)."""
    from backend.models.notebook import Notebook
    from backend.meeting.service import SUGGESTION_CONFIG, _generate_suggestion_safe

    # Get suggestion level from notebook
    async with async_session() as db:
        nb = await db.get(Notebook, uuid.UUID(notebook_id))
        if not nb:
            return
        level = nb.suggestion_level or "medium"
        custom_prompt = nb.custom_prompt or ""

    if level == "off" or level not in SUGGESTION_CONFIG:
        return

    config = SUGGESTION_CONFIG[level]
    now = _time.monotonic()

    # Condition 3: minimum interval since last suggestion
    if session.suggestion_last_time > 0 and (now - session.suggestion_last_time) < config["min_interval"]:
        return

    # Condition 2: accumulated enough new chars
    total_chars = sum(len(u.text) for u in session.utterances if u.is_final and u.text.strip() != "...")
    new_chars = total_chars - session.suggestion_last_char_count
    if new_chars < config["char_threshold"]:
        return

    # Condition 1: detect silence — check if latest audio buffer activity suggests a pause
    # We use a simple heuristic: if the last utterance was > N seconds ago (based on session timing)
    if session.utterances:
        last_utt_time = session.utterances[-1].end_time_ms / 1000.0
        session_elapsed = now - session.session_start
        silence_since_last = session_elapsed - last_utt_time
        if silence_since_last < config["silence_secs"]:
            return  # Not enough silence yet

    # All 3 conditions met — trigger!
    session.suggestion_last_time = now
    session.suggestion_last_char_count = total_chars

    # Build transcript from recent utterances
    recent = [u for u in session.utterances if u.is_final and u.text.strip() != "..."][-15:]
    transcript = "\n".join(f"{u.wall_time or ''} {u.text}" for u in recent)

    logger.info("Triggering meeting suggestion for %s (level=%s, new_chars=%d)", meeting_id, level, new_chars)
    asyncio.create_task(_generate_suggestion_safe(meeting_id, notebook_id, user_id, transcript, custom_prompt))


router = APIRouter(prefix="/notebooks/{notebook_id}/meetings", tags=["meetings"])


@router.post("", response_model=MeetingOut)
async def create_meeting(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a new meeting in this notebook."""
    try:
        meeting = await service.create_meeting(db, uuid.UUID(notebook_id), user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _to_out(meeting)


@router.get("/active", response_model=MeetingOut | None)
async def get_active_meeting(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the currently active (recording/paused) meeting, or null."""
    meeting = await service.get_active_meeting(db, uuid.UUID(notebook_id))
    if not meeting:
        return None
    return _to_out(meeting)


@router.get("/hotwords")
async def get_user_hotwords(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get ASR hotwords for the current user (shared across all notebooks)."""
    # Refresh from DB
    await db.refresh(user)
    words = user.hotwords or []
    # Update in-memory cache
    set_hotwords(str(user.id), words)
    return {"words": words}


@router.put("/hotwords")
async def set_user_hotwords(
    notebook_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set ASR hotwords for the current user (persisted to users table)."""
    words = body.get("words", [])
    if not isinstance(words, list):
        raise HTTPException(status_code=400, detail="words must be a list")
    clean = list(dict.fromkeys(w.strip() for w in words if isinstance(w, str) and w.strip()))

    user.hotwords = clean
    await db.commit()

    # Update in-memory cache keyed by user_id
    set_hotwords(str(user.id), clean)
    return {"words": clean}


@router.get("/{meeting_id}", response_model=MeetingOut)
async def get_meeting(
    notebook_id: str,
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    meeting = await service.get_meeting(db, uuid.UUID(meeting_id))
    if not meeting or str(meeting.notebook_id) != notebook_id:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _to_out(meeting)


@router.patch("/{meeting_id}/speakers", response_model=MeetingOut)
async def update_speakers(
    notebook_id: str,
    meeting_id: str,
    body: SpeakerUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update speaker name mapping."""
    meeting = await service.update_speaker_map(
        db, uuid.UUID(meeting_id), body.speaker_map
    )
    return _to_out(meeting)


@router.post("/{meeting_id}/pause")
async def pause_meeting(
    notebook_id: str,
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    meeting = await service.get_meeting(db, uuid.UUID(meeting_id))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    asr_client.pause_session(meeting_id)
    meeting.status = "paused"
    await db.commit()
    return {"status": "paused"}


@router.post("/{meeting_id}/resume")
async def resume_meeting(
    notebook_id: str,
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    meeting = await service.get_meeting(db, uuid.UUID(meeting_id))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    asr_client.resume_session(meeting_id)
    meeting.status = "recording"
    await db.commit()
    return {"status": "recording"}


@router.post("/{meeting_id}/end")
async def end_meeting(
    notebook_id: str,
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """End meeting, generate transcript source, trigger RAG pipeline."""
    try:
        source = await service.end_meeting(db, uuid.UUID(meeting_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "source_id": str(source.id),
        "filename": source.filename,
        "status": source.status,
    }


@router.get("/{meeting_id}/utterances", response_model=list[UtteranceOut])
async def list_utterances(
    notebook_id: str,
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    utterances = await service.get_utterances(db, uuid.UUID(meeting_id))
    return [
        UtteranceOut(
            id=str(u.id),
            speaker_id=u.speaker_id,
            text=u.text,
            start_time_ms=u.start_time_ms,
            end_time_ms=u.end_time_ms,
            is_final=u.is_final,
            sequence=u.sequence,
            provider=getattr(u, 'provider', '') or '',
        )
        for u in utterances
    ]


@router.websocket("/{meeting_id}/audio")
async def websocket_audio(
    websocket: WebSocket,
    notebook_id: str,
    meeting_id: str,
):
    """
    WebSocket endpoint for real-time meeting audio streaming.

    Client sends: binary frames (PCM 16-bit 16kHz mono, ~200ms chunks)
    Client sends: JSON text frames for control {"type": "pause"/"resume"/"end"}
    Server sends: JSON text frames with transcript updates
    """
    await websocket.accept()
    logger.info("Meeting WS connected: %s", meeting_id)

    # Pre-load hotwords from DB (user-level) into cache before starting ASR
    # Cache under notebook_id key so asr_client can find them
    try:
        async with async_session() as db:
            meeting = await service.get_meeting(db, uuid.UUID(meeting_id))
            if meeting and meeting.created_by:
                from backend.models.user import User as UserModel
                u = await db.get(UserModel, meeting.created_by)
                if u and u.hotwords:
                    set_hotwords(notebook_id, u.hotwords)
    except Exception as e:
        logger.warning("Failed to load hotwords from DB: %s", e)

    # Start ASR session
    try:
        session = await asr_client.start_session(meeting_id, notebook_id=notebook_id)
    except Exception as e:
        logger.error("Failed to start ASR session: %s", e)
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()
        return

    async def receive_audio():
        """Receive audio from client and forward to ASR."""
        try:
            while True:
                data = await websocket.receive()
                if "bytes" in data:
                    # Binary frame: PCM audio
                    await asr_client.send_audio(meeting_id, data["bytes"])
                elif "text" in data:
                    # Text frame: control message
                    msg = json.loads(data["text"])
                    if msg.get("type") == "pause":
                        asr_client.pause_session(meeting_id)
                    elif msg.get("type") == "resume":
                        asr_client.resume_session(meeting_id)
                    elif msg.get("type") == "end":
                        break
        except WebSocketDisconnect:
            logger.info("Meeting WS client disconnected: %s", meeting_id)
        except Exception as e:
            logger.error("Meeting WS receive error: %s", e)

    async def send_transcripts():
        """Receive ASR results and send to client. Auto-reconnects ASR on failure."""
        max_reconnects = 50  # ~2.5 hours at 3 min intervals
        reconnect_count = 0

        while reconnect_count <= max_reconnects:
            try:
                async for utterance in asr_client.receive_results(meeting_id):
                    from datetime import datetime, timezone, timedelta
                    beijing_tz = timezone(timedelta(hours=8))
                    wall_time = datetime.now(beijing_tz).strftime("%H:%M")
                    await websocket.send_json({
                        "type": "utterance",
                        "provider": utterance.provider or "firered",
                        "speaker_id": utterance.speaker_id,
                        "text": utterance.text,
                        "start_time_ms": utterance.start_time_ms,
                        "end_time_ms": utterance.end_time_ms,
                        "is_final": utterance.is_final,
                        "sequence": utterance.sequence,
                        "wall_time": wall_time,
                    })

                    # Save utterances to DB so resume works (skip "..." placeholder)
                    if utterance.text.strip() and utterance.text.strip() != "...":
                        async with async_session() as db:
                            await service.save_utterance(
                                db, uuid.UUID(meeting_id), utterance
                            )

                    await event_bus.publish(notebook_id, {
                        "type": "meeting_utterance",
                        "meeting_id": meeting_id,
                        "speaker_id": utterance.speaker_id,
                        "text": utterance.text,
                        "is_final": utterance.is_final,
                        "sequence": utterance.sequence,
                    })

                    # Check if we should generate AI suggestions
                    if utterance.is_final and utterance.text.strip() and utterance.text.strip() != "...":
                        await _check_suggestion_trigger(session, meeting_id, notebook_id, user_id)
            except Exception as e:
                logger.error("Meeting ASR error: %s", e)

            # ASR stream ended — check why
            current = asr_client.get_session(meeting_id)

            # If session was replaced by a new WebSocket (page refresh + resume),
            # this old handler should exit and let the new one take over
            if current is not session:
                logger.info("ASR session replaced for meeting %s, old handler exiting", meeting_id)
                break

            if current and current.is_ended:
                break  # Meeting was explicitly ended

            reconnect_count += 1
            if reconnect_count > max_reconnects:
                break
            logger.info("ASR reconnecting for meeting %s (attempt %d)", meeting_id, reconnect_count)
            try:
                await websocket.send_json({"type": "reconnecting"})
                await asr_client.end_session(meeting_id)
                await asyncio.sleep(1)
                session = await asr_client.start_session(meeting_id, notebook_id=notebook_id)
                await websocket.send_json({"type": "reconnected"})
            except Exception as e:
                logger.error("ASR reconnect failed: %s", e)
                break

    # Run both tasks concurrently
    receive_task = asyncio.create_task(receive_audio())
    send_task = asyncio.create_task(send_transcripts())

    # Wait for either to finish (client disconnect or end command)
    done, pending = await asyncio.wait(
        [receive_task, send_task], return_when=asyncio.FIRST_COMPLETED
    )
    for task in pending:
        task.cancel()

    # Cleanup: only close ASR session if it's still the one we started
    # (a new WebSocket may have created a new session via resume)
    current_session = asr_client.get_session(meeting_id)
    try:
        if current_session is session:
            await asr_client.end_session(meeting_id)
    except Exception as e:
        logger.warning("Meeting ASR cleanup error: %s", e)

    logger.info("Meeting WS closed: %s", meeting_id)


def _to_out(meeting: service.Meeting) -> MeetingOut:
    return MeetingOut(
        id=str(meeting.id),
        notebook_id=str(meeting.notebook_id),
        status=meeting.status,
        speaker_map=meeting.speaker_map or {},
        title=meeting.title,
        source_id=str(meeting.source_id) if meeting.source_id else None,
        started_at=meeting.started_at,
        ended_at=meeting.ended_at,
        duration_seconds=meeting.duration_seconds,
        created_by=str(meeting.created_by) if meeting.created_by else None,
    )
