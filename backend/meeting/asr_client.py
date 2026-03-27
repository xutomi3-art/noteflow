"""
Volcengine Seed-ASR 2.0 Streaming WebSocket Client.

Based on the proven implementation from huiyizhushou2.
Protocol: WebSocket v3 SAUC bigmodel_async with binary framing + HTTP header auth.
Config frames use JSON (no gzip). Audio frames use raw PCM (no gzip).
Response frames: 4B header + 4B sequence + 4B payload_size + JSON payload.
"""
import asyncio
import gzip
import json
import logging
import re
import struct
import time
import uuid
from dataclasses import dataclass, field

import websockets

logger = logging.getLogger(__name__)

VOLCANO_WSS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"

# Default credentials
ASR_APP_ID = "5066898369"
ASR_ACCESS_KEY = "hoSxELglG0VOYcnYxdVv9bKGEgtISscx"
ASR_RESOURCE_ID = "volc.seedasr.sauc.duration"

# Binary frame header constants (matching Volcano protocol spec)
_PROTO_VERSION_HEADER_SIZE = 0x11  # version=1, header_size=1 (4 bytes)
_CONFIG_MSG_TYPE_FLAGS = 0x10       # msg_type=1 (full request), flags=0
_CONFIG_SERIALIZATION = 0x10        # serialization=1 (JSON), compression=0 (none)
_AUDIO_MSG_TYPE = 0x20              # msg_type=2 (audio-only), flags=0
_AUDIO_MSG_TYPE_FINAL = 0x22        # msg_type=2 (audio-only), flags=2 (final)
_AUDIO_SERIALIZATION = 0x00         # serialization=0 (raw), compression=0 (none)
_RESERVED = 0x00

# Response message types (upper nibble of byte 1)
_RESP_TYPE_ASR_RESULT = 0x9
_RESP_TYPE_ERROR = 0xF


def _build_config_frame(hotwords: list[str] | None = None) -> bytes:
    """Build binary config frame. JSON payload, no compression."""
    request: dict = {
        "model_name": "bigmodel",
        "enable_punc": True,
        "enable_itn": True,
        "enable_ddc": True,           # 语义顺滑: removes fillers/stutters
        "enable_nonstream": True,     # 二遍识别: VAD + re-recognition
        "result_type": "single",      # Incremental: only new/changed utterances
        "show_utterances": True,
        "enable_speaker_info": True,
        "ssd_version": "200",         # Required for ASR 2.0 speaker diarization
        "end_window_size": 800,       # VAD: 800ms silence → definite (faster speaker turns)
        "force_to_speech_time": 1000, # Minimum 1s speech before attempting VAD stop
    }
    if hotwords:
        words_list = [{"word": w} for w in hotwords[:100]]
        request["corpus"] = {
            "context": json.dumps({"hotwords": words_list}),
        }
    payload = {
        "user": {"uid": str(uuid.uuid4())},
        "request": request,
        "audio": {
            "format": "pcm",
            "rate": 16000,
            "bits": 16,
            "channel": 1,
            "codec": "raw",
        },
    }
    payload_bytes = json.dumps(payload).encode("utf-8")
    header = struct.pack(
        ">BBBB",
        _PROTO_VERSION_HEADER_SIZE,
        _CONFIG_MSG_TYPE_FLAGS,
        _CONFIG_SERIALIZATION,  # JSON, no compression
        _RESERVED,
    )
    size = struct.pack(">I", len(payload_bytes))
    return header + size + payload_bytes


def _build_audio_frame(audio_data: bytes, is_final: bool = False) -> bytes:
    """Build binary audio frame. Raw PCM, no compression."""
    msg_type_flags = _AUDIO_MSG_TYPE_FINAL if is_final else _AUDIO_MSG_TYPE
    header = struct.pack(
        ">BBBB",
        _PROTO_VERSION_HEADER_SIZE,
        msg_type_flags,
        _AUDIO_SERIALIZATION,  # raw, no compression
        _RESERVED,
    )
    size = struct.pack(">I", len(audio_data))
    return header + size + audio_data


def _parse_response_frame(data: bytes) -> dict | None:
    """Parse binary response frame.

    Server frame: [4B header][4B sequence][4B payload_size][JSON payload]
    Total overhead: 12 bytes before JSON.
    """
    if len(data) < 12:
        logger.warning("ASR response too short (%d bytes)", len(data))
        return None

    msg_type = (data[1] >> 4) & 0x0F
    compress = data[2] & 0x0F

    if msg_type == _RESP_TYPE_ERROR:
        if len(data) > 12:
            try:
                error_text = data[12:].decode("utf-8")
                logger.error("ASR server error: %s", error_text)
            except UnicodeDecodeError:
                logger.error("ASR server error (binary): %s", data[12:].hex())
        return {"_type": "error"}

    if msg_type == _RESP_TYPE_ASR_RESULT:
        payload_size = struct.unpack(">I", data[8:12])[0]
        json_bytes = data[12:12 + payload_size]
        if compress == 1:
            try:
                json_bytes = gzip.decompress(json_bytes)
            except Exception as e:
                logger.warning("ASR gzip decompress failed: %s", e)
                return None
        if not json_bytes:
            return None
        try:
            return json.loads(json_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            logger.warning("ASR failed to parse result: %s", e)
            return None

    return None


@dataclass
class Utterance:
    speaker_id: str
    text: str
    start_time_ms: int
    end_time_ms: int
    is_final: bool
    sequence: int = 0


@dataclass
class MeetingSession:
    meeting_id: str
    ws: object | None = None  # websockets connection
    utterances: list[Utterance] = field(default_factory=list)
    sequence_counter: int = 0
    is_paused: bool = False
    is_ended: bool = False
    session_start: float = 0.0
    _seen_definite: set = field(default_factory=set)  # track seen definite texts to avoid duplicates


class VolcengineASRClient:
    """Manages streaming ASR sessions with Volcengine Seed-ASR 2.0."""

    def __init__(self) -> None:
        self._sessions: dict[str, MeetingSession] = {}

    async def start_session(self, meeting_id: str) -> MeetingSession:
        """Open WebSocket to Volcengine ASR and send config frame."""
        connect_id = str(uuid.uuid4())
        headers = {
            "X-Api-App-Key": ASR_APP_ID,
            "X-Api-Access-Key": ASR_ACCESS_KEY,
            "X-Api-Resource-Id": ASR_RESOURCE_ID,
            "X-Api-Connect-Id": connect_id,
        }

        ws = await websockets.connect(VOLCANO_WSS_URL, additional_headers=headers)
        session = MeetingSession(
            meeting_id=meeting_id, ws=ws,
            session_start=time.monotonic(),
        )
        self._sessions[meeting_id] = session

        # Send config frame (JSON, no gzip)
        config_frame = _build_config_frame()
        await ws.send(config_frame)

        # Read initial response
        resp = await ws.recv()
        if isinstance(resp, bytes):
            parsed = _parse_response_frame(resp)
            if parsed and parsed.get("_type") == "error":
                raise ConnectionError("ASR connect failed: server error")
        else:
            data = json.loads(resp)
            if data.get("resp", {}).get("code") not in (None, 1000):
                raise ConnectionError(f"ASR connect failed: {data}")

        logger.info("ASR session started for meeting %s (connect_id=%s)", meeting_id, connect_id)
        return session

    async def send_audio(self, meeting_id: str, pcm_data: bytes) -> None:
        """Send raw PCM audio chunk to ASR. No compression."""
        session = self._sessions.get(meeting_id)
        if not session or not session.ws or session.is_paused or session.is_ended:
            return
        frame = _build_audio_frame(pcm_data)
        await session.ws.send(frame)

    async def receive_results(self, meeting_id: str):
        """Async generator yielding Utterance objects from ASR.

        With result_type="single", each response contains only new/changed utterances.
        definite=True → finalized sentence with speaker_id.
        """
        session = self._sessions.get(meeting_id)
        if not session or not session.ws:
            return

        logger.info("ASR receive_results started for meeting %s (session_start=%.0f)", meeting_id, session.session_start)
        try:
            async for message in session.ws:
                if session.is_ended:
                    break

                # Proactive reconnect every ~170s to avoid ASR session timeout
                if time.monotonic() - session.session_start > 170:
                    logger.info("ASR proactive reconnect (session age %.0fs)", time.monotonic() - session.session_start)
                    break

                if isinstance(message, bytes):
                    parsed = _parse_response_frame(message)
                else:
                    try:
                        parsed = json.loads(message)
                    except json.JSONDecodeError:
                        continue

                if parsed is None or parsed.get("_type") == "error":
                    continue

                utterances = parsed.get("result", {}).get("utterances", [])
                if not utterances:
                    continue

                # Process each utterance — only yield NEW definite or latest partial
                partial_utt = None  # track the one non-definite (currently speaking)

                for utt in utterances:
                    text = utt.get("text", "")
                    if not text.strip():
                        continue

                    definite = utt.get("definite", False)
                    start_time = utt.get("start_time", 0)
                    end_time = utt.get("end_time", 0)

                    # Speaker ID is in additions dict; normalize to "speaker_N" format
                    additions = utt.get("additions", {})
                    raw_speaker = str(additions.get("speaker_id", "")) if additions else ""
                    if raw_speaker and raw_speaker.isdigit():
                        speaker_id = f"speaker_{raw_speaker}"
                    elif raw_speaker and raw_speaker.startswith("speaker_"):
                        speaker_id = raw_speaker
                    else:
                        speaker_id = "speaker_0"

                    if definite:
                        # Dedup key: strip punctuation for matching (二遍识别 changes punctuation)
                        dedup_key = re.sub(r'[\s，。！？,.!?、；：""\'\'《》【】()（）]', '', text)
                        if dedup_key in session._seen_definite:
                            continue  # Already sent this definite utterance
                        session._seen_definite.add(dedup_key)

                    if not definite:
                        partial_utt = (speaker_id, text, start_time, end_time)
                        continue  # Don't yield partials yet, yield after loop

                    session.sequence_counter += 1
                    u = Utterance(
                        speaker_id=speaker_id,
                        text=text,
                        start_time_ms=start_time,
                        end_time_ms=end_time,
                        is_final=True,
                        sequence=session.sequence_counter,
                    )
                    session.utterances.append(u)
                    yield u

                # After processing all utterances in this response, yield the partial if any
                if partial_utt:
                    sp_id, p_text, p_start, p_end = partial_utt
                    yield Utterance(
                        speaker_id=sp_id,
                        text=p_text,
                        start_time_ms=p_start,
                        end_time_ms=p_end,
                        is_final=False,
                        sequence=0,  # partials don't get persisted
                    )

        except websockets.ConnectionClosed:
            logger.info("ASR WebSocket closed for meeting %s", meeting_id)
        except Exception as e:
            logger.error("ASR receive error for meeting %s: %s", meeting_id, e)

    async def end_session(self, meeting_id: str) -> list[Utterance]:
        """Send final empty frame and close. Returns all finalized utterances."""
        session = self._sessions.get(meeting_id)
        if not session or not session.ws:
            return session.utterances if session else []

        session.is_ended = True

        try:
            # Send empty final frame
            await session.ws.send(_build_audio_frame(b"", is_final=True))

            # Read remaining results
            try:
                async for message in session.ws:
                    if isinstance(message, bytes):
                        parsed = _parse_response_frame(message)
                    else:
                        try:
                            parsed = json.loads(message)
                        except json.JSONDecodeError:
                            continue

                    if parsed and parsed.get("result", {}).get("utterances"):
                        for utt in parsed["result"]["utterances"]:
                            if utt.get("definite") and utt.get("text", "").strip():
                                additions = utt.get("additions", {})
                                raw_sp = str(additions.get("speaker_id", "")) if additions else ""
                                speaker_id = f"speaker_{raw_sp}" if raw_sp and raw_sp.isdigit() else (raw_sp if raw_sp.startswith("speaker_") else "speaker_0")
                                session.sequence_counter += 1
                                session.utterances.append(Utterance(
                                    speaker_id=speaker_id,
                                    text=utt["text"],
                                    start_time_ms=utt.get("start_time", 0),
                                    end_time_ms=utt.get("end_time", 0),
                                    is_final=True,
                                    sequence=session.sequence_counter,
                                ))

                    # Check for final response flag
                    if isinstance(message, bytes) and len(message) >= 2:
                        flags = message[1] & 0x0F
                        if flags in (0x02, 0x03):  # last packet
                            break
            except websockets.ConnectionClosed:
                pass

            await session.ws.close()
        except Exception as e:
            logger.error("Error ending ASR session for meeting %s: %s", meeting_id, e)

        all_utterances = session.utterances
        self._sessions.pop(meeting_id, None)
        logger.info("ASR session ended for meeting %s (%d utterances)", meeting_id, len(all_utterances))
        return all_utterances

    def pause_session(self, meeting_id: str) -> None:
        session = self._sessions.get(meeting_id)
        if session:
            session.is_paused = True

    def resume_session(self, meeting_id: str) -> None:
        session = self._sessions.get(meeting_id)
        if session:
            session.is_paused = False

    def get_session(self, meeting_id: str) -> MeetingSession | None:
        return self._sessions.get(meeting_id)

    def get_live_transcript(self, meeting_id: str) -> str:
        """Return current finalized transcript for chat context."""
        session = self._sessions.get(meeting_id)
        if not session:
            return ""
        lines = []
        for u in session.utterances:
            ts = f"{u.start_time_ms // 60000:02d}:{(u.start_time_ms // 1000) % 60:02d}"
            lines.append(f"[{u.speaker_id}] ({ts}) {u.text}")
        return "\n".join(lines)


# Singleton
asr_client = VolcengineASRClient()
