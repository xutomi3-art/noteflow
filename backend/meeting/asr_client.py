"""
Volcengine Seed-ASR 2.0 Streaming WebSocket Client

Implements the SAUC binary protocol for real-time speech recognition
with speaker diarization via the bigmodel_async endpoint.

Protocol: 4-byte header + payload_size(4B) + gzip-compressed payload
"""
import asyncio
import gzip
import json
import logging
import struct
import uuid
from dataclasses import dataclass, field
from typing import AsyncGenerator

import websockets

logger = logging.getLogger(__name__)

# --- Volcengine SAUC Binary Protocol Constants ---

PROTOCOL_VERSION = 0b0001
HEADER_SIZE = 0b0001  # 1 * 4 = 4 bytes

# Message types (4 bits)
MSG_FULL_CLIENT_REQUEST = 0b0001
MSG_AUDIO_ONLY = 0b0010
MSG_FULL_SERVER_RESPONSE = 0b1001
MSG_SERVER_ERROR = 0b1111

# Message type specific flags (4 bits)
FLAG_NONE = 0b0000
FLAG_POSITIVE_SEQUENCE = 0b0001
FLAG_LAST_PACKET_NO_SEQ = 0b0010
FLAG_LAST_PACKET_WITH_SEQ = 0b0011

# Serialization (4 bits)
SERIAL_NONE = 0b0000
SERIAL_JSON = 0b0001

# Compression (4 bits)
COMPRESS_NONE = 0b0000
COMPRESS_GZIP = 0b0001


def _build_header(msg_type: int, flags: int, serial: int, compress: int) -> bytes:
    """Build a 4-byte SAUC protocol header."""
    byte0 = (PROTOCOL_VERSION << 4) | HEADER_SIZE
    byte1 = (msg_type << 4) | flags
    byte2 = (serial << 4) | compress
    byte3 = 0x00  # reserved
    return struct.pack("BBBB", byte0, byte1, byte2, byte3)


def _build_frame(header: bytes, payload: bytes) -> bytes:
    """Build a complete SAUC binary frame: header + payload_size + payload."""
    return header + struct.pack(">I", len(payload)) + payload


def _parse_header(data: bytes) -> dict:
    """Parse a 4-byte SAUC header into its fields."""
    byte0, byte1, byte2, byte3 = struct.unpack("BBBB", data[:4])
    return {
        "version": (byte0 >> 4) & 0x0F,
        "header_size": (byte0 & 0x0F) * 4,
        "msg_type": (byte1 >> 4) & 0x0F,
        "flags": byte1 & 0x0F,
        "serialization": (byte2 >> 4) & 0x0F,
        "compression": byte2 & 0x0F,
    }


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
    ws: websockets.WebSocketClientProtocol | None = None
    utterances: list[Utterance] = field(default_factory=list)
    sequence_counter: int = 0
    is_paused: bool = False
    is_ended: bool = False
    _receive_task: asyncio.Task | None = None


# Default ASR configuration
ASR_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
ASR_APP_ID = "5066898369"
ASR_ACCESS_KEY = "hoSxELglG0VOYcnYxdVv9bKGEgtISscx"
ASR_RESOURCE_ID = "volc.seedasr.sauc.duration"


class VolcengineASRClient:
    """Manages streaming ASR sessions with Volcengine Seed-ASR 2.0."""

    def __init__(self) -> None:
        self._sessions: dict[str, MeetingSession] = {}

    async def start_session(self, meeting_id: str) -> MeetingSession:
        """Open a WebSocket connection to Volcengine ASR and send initial config."""
        connect_id = str(uuid.uuid4())
        headers = {
            "X-Api-App-Key": ASR_APP_ID,
            "X-Api-Access-Key": ASR_ACCESS_KEY,
            "X-Api-Resource-Id": ASR_RESOURCE_ID,
            "X-Api-Connect-Id": connect_id,
        }

        ws = await websockets.connect(ASR_ENDPOINT, additional_headers=headers)
        session = MeetingSession(meeting_id=meeting_id, ws=ws)
        self._sessions[meeting_id] = session

        # Send full client request with ASR configuration
        config = {
            "user": {"uid": f"noteflow-{meeting_id[:8]}"},
            "audio": {
                "format": "pcm",
                "rate": 16000,
                "bits": 16,
                "channel": 1,
            },
            "request": {
                "model_name": "bigmodel",
                "enable_punc": True,
                "enable_itn": True,
                "show_utterances": True,
                "enable_nonstream": True,  # 二遍识别
                "enable_speaker_info": True,
                "ssd_version": "200",
                "result_type": "single",  # incremental results
            },
        }

        payload = gzip.compress(json.dumps(config).encode("utf-8"))
        header = _build_header(
            MSG_FULL_CLIENT_REQUEST, FLAG_NONE, SERIAL_JSON, COMPRESS_GZIP
        )
        frame = _build_frame(header, payload)
        await ws.send(frame)

        # Read the initial response
        resp = await ws.recv()
        self._parse_response(resp)  # validate no error

        logger.info("ASR session started for meeting %s (connect_id=%s)", meeting_id, connect_id)
        return session

    async def send_audio(self, meeting_id: str, pcm_data: bytes) -> None:
        """Send a PCM audio chunk to the ASR session."""
        session = self._sessions.get(meeting_id)
        if not session or not session.ws or session.is_paused or session.is_ended:
            return

        payload = gzip.compress(pcm_data)
        header = _build_header(
            MSG_AUDIO_ONLY, FLAG_NONE, SERIAL_NONE, COMPRESS_GZIP
        )
        frame = _build_frame(header, payload)
        await session.ws.send(frame)

    async def receive_results(self, meeting_id: str) -> AsyncGenerator[Utterance, None]:
        """Async generator that yields utterances from the ASR session."""
        session = self._sessions.get(meeting_id)
        if not session or not session.ws:
            return

        try:
            async for message in session.ws:
                if session.is_ended:
                    break
                result = self._parse_response(message)
                if result is None:
                    continue

                utterances = result.get("result", {}).get("utterances", [])
                full_text = result.get("result", {}).get("text", "")

                if utterances:
                    for utt in utterances:
                        session.sequence_counter += 1
                        u = Utterance(
                            speaker_id=utt.get("speaker_id", "speaker_0"),
                            text=utt.get("text", ""),
                            start_time_ms=utt.get("start_time", 0),
                            end_time_ms=utt.get("end_time", 0),
                            is_final=utt.get("definite", False),
                            sequence=session.sequence_counter,
                        )
                        session.utterances.append(u)
                        yield u
                elif full_text:
                    # Fallback: no utterance breakdown, use full text
                    session.sequence_counter += 1
                    u = Utterance(
                        speaker_id="speaker_0",
                        text=full_text,
                        start_time_ms=0,
                        end_time_ms=0,
                        is_final=True,
                        sequence=session.sequence_counter,
                    )
                    session.utterances.append(u)
                    yield u
        except websockets.ConnectionClosed:
            logger.info("ASR WebSocket closed for meeting %s", meeting_id)
        except Exception as e:
            logger.error("ASR receive error for meeting %s: %s", meeting_id, e)

    async def end_session(self, meeting_id: str) -> list[Utterance]:
        """Send final audio frame and close the ASR session. Returns all utterances."""
        session = self._sessions.get(meeting_id)
        if not session or not session.ws:
            return session.utterances if session else []

        session.is_ended = True

        try:
            # Send empty last packet (negative packet)
            header = _build_header(
                MSG_AUDIO_ONLY, FLAG_LAST_PACKET_NO_SEQ, SERIAL_NONE, COMPRESS_GZIP
            )
            empty_payload = gzip.compress(b"")
            frame = _build_frame(header, empty_payload)
            await session.ws.send(frame)

            # Read remaining results until connection closes
            try:
                async for message in session.ws:
                    result = self._parse_response(message)
                    if result and result.get("result", {}).get("utterances"):
                        for utt in result["result"]["utterances"]:
                            if utt.get("definite"):
                                session.sequence_counter += 1
                                session.utterances.append(Utterance(
                                    speaker_id=utt.get("speaker_id", "speaker_0"),
                                    text=utt.get("text", ""),
                                    start_time_ms=utt.get("start_time", 0),
                                    end_time_ms=utt.get("end_time", 0),
                                    is_final=True,
                                    sequence=session.sequence_counter,
                                ))
                    # Check if this is the last response
                    hdr = _parse_header(message[:4])
                    if hdr["flags"] in (FLAG_LAST_PACKET_NO_SEQ, FLAG_LAST_PACKET_WITH_SEQ):
                        break
            except websockets.ConnectionClosed:
                pass

            await session.ws.close()
        except Exception as e:
            logger.error("Error ending ASR session for meeting %s: %s", meeting_id, e)

        all_utterances = session.utterances
        self._sessions.pop(meeting_id, None)
        logger.info(
            "ASR session ended for meeting %s (%d utterances)",
            meeting_id, len(all_utterances),
        )
        return all_utterances

    def pause_session(self, meeting_id: str) -> None:
        """Pause audio forwarding (keeps WebSocket open for speaker continuity)."""
        session = self._sessions.get(meeting_id)
        if session:
            session.is_paused = True

    def resume_session(self, meeting_id: str) -> None:
        """Resume audio forwarding."""
        session = self._sessions.get(meeting_id)
        if session:
            session.is_paused = False

    def get_session(self, meeting_id: str) -> MeetingSession | None:
        return self._sessions.get(meeting_id)

    def get_live_transcript(self, meeting_id: str) -> str:
        """Return the current transcript as formatted text for chat context."""
        session = self._sessions.get(meeting_id)
        if not session:
            return ""
        lines = []
        for u in session.utterances:
            if u.is_final and u.text.strip():
                ts = f"{u.start_time_ms // 60000:02d}:{(u.start_time_ms // 1000) % 60:02d}"
                lines.append(f"[{u.speaker_id}] ({ts}) {u.text}")
        return "\n".join(lines)

    def _parse_response(self, data: bytes) -> dict | None:
        """Parse a SAUC binary response into a JSON dict."""
        if len(data) < 4:
            return None

        hdr = _parse_header(data)
        offset = hdr["header_size"]

        if hdr["msg_type"] == MSG_SERVER_ERROR:
            # Error frame: error_code(4B) + error_size(4B) + error_message
            if len(data) >= offset + 8:
                error_code = struct.unpack(">I", data[offset : offset + 4])[0]
                error_size = struct.unpack(">I", data[offset + 4 : offset + 8])[0]
                error_msg = data[offset + 8 : offset + 8 + error_size].decode("utf-8", errors="replace")
                logger.error("ASR error %d: %s", error_code, error_msg)
            return None

        if hdr["msg_type"] != MSG_FULL_SERVER_RESPONSE:
            return None

        # Skip sequence number if present
        if hdr["flags"] in (FLAG_POSITIVE_SEQUENCE, FLAG_LAST_PACKET_WITH_SEQ):
            offset += 4  # skip 4-byte sequence

        if len(data) < offset + 4:
            return None

        payload_size = struct.unpack(">I", data[offset : offset + 4])[0]
        offset += 4
        payload = data[offset : offset + payload_size]

        if hdr["compression"] == COMPRESS_GZIP:
            payload = gzip.decompress(payload)

        if hdr["serialization"] == SERIAL_JSON:
            return json.loads(payload)

        return None


# Singleton instance
asr_client = VolcengineASRClient()
