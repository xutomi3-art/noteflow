"""Meeting API endpoints — REST + WebSocket."""
import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.auth import get_current_user
from backend.core.database import get_db, async_session
from backend.meeting.asr_client import asr_client, set_hotwords, get_hotwords
from backend.meeting.schemas import MeetingCreate, MeetingOut, SpeakerUpdate, UtteranceOut
from backend.meeting import service
from backend.models.user import User
from backend.services.event_bus import event_bus

logger = logging.getLogger(__name__)

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
async def get_notebook_hotwords(
    notebook_id: str,
    user: User = Depends(get_current_user),
):
    """Get ASR hotwords for this notebook."""
    return {"words": get_hotwords(notebook_id)}


@router.put("/hotwords")
async def set_notebook_hotwords(
    notebook_id: str,
    body: dict,
    user: User = Depends(get_current_user),
):
    """Set ASR hotwords for this notebook."""
    words = body.get("words", [])
    if not isinstance(words, list):
        raise HTTPException(status_code=400, detail="words must be a list")
    clean = list(dict.fromkeys(w.strip() for w in words if isinstance(w, str) and w.strip()))
    set_hotwords(notebook_id, clean)
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
                    wall_time = datetime.now(beijing_tz).strftime("%H:%M:%S")
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

                    if utterance.is_final:
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
            except Exception as e:
                logger.error("Meeting ASR error: %s", e)

            # ASR stream ended (error/timeout/proactive reconnect) — reconnect
            session = asr_client.get_session(meeting_id)
            if session and session.is_ended:
                break  # Meeting was explicitly ended

            reconnect_count += 1
            logger.info("ASR reconnecting for meeting %s (attempt %d)", meeting_id, reconnect_count)
            try:
                await websocket.send_json({"type": "reconnecting"})
                await asr_client.end_session(meeting_id)
                await asyncio.sleep(1)
                await asr_client.start_session(meeting_id)
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

    # Cleanup: close ASR session but keep meeting in "recording" state
    # so user can resume after page refresh
    try:
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
    )
