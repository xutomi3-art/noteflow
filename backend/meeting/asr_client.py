"""
ASR Client — supports Volcengine Seed-ASR (WebSocket streaming) and
local Whisper via Xinference (HTTP chunked).

The active client is selected by ASR_PROVIDER setting:
  "volcengine" (default) — Volcengine Seed-ASR 2.0
  "whisper"              — Local Belle-whisper via OpenAI-compatible API
"""
import asyncio
import gzip
import io
import json
import logging
import re
import struct
import time
import uuid
import wave
from dataclasses import dataclass, field

import httpx
import websockets

logger = logging.getLogger(__name__)

# ── Shared data types ──────────────────────────────────────────────


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
    ws: object | None = None  # websockets connection (Volcengine only)
    utterances: list[Utterance] = field(default_factory=list)
    sequence_counter: int = 0
    is_paused: bool = False
    is_ended: bool = False
    session_start: float = 0.0
    _seen_definite: set = field(default_factory=set)
    # Whisper-specific fields
    _audio_buffer: bytearray = field(default_factory=bytearray)
    _result_queue: asyncio.Queue | None = None
    _flush_task: asyncio.Task | None = None


# ── Volcengine Seed-ASR 2.0 (WebSocket) ───────────────────────────

VOLCANO_WSS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
ASR_APP_ID = "5066898369"
ASR_ACCESS_KEY = "hoSxELglG0VOYcnYxdVv9bKGEgtISscx"
ASR_RESOURCE_ID = "volc.seedasr.sauc.duration"

_PROTO_VERSION_HEADER_SIZE = 0x11
_CONFIG_MSG_TYPE_FLAGS = 0x10
_CONFIG_SERIALIZATION = 0x10
_AUDIO_MSG_TYPE = 0x20
_AUDIO_MSG_TYPE_FINAL = 0x22
_AUDIO_SERIALIZATION = 0x00
_RESERVED = 0x00
_RESP_TYPE_ASR_RESULT = 0x9
_RESP_TYPE_ERROR = 0xF


def _build_config_frame(hotwords: list[str] | None = None) -> bytes:
    request: dict = {
        "model_name": "bigmodel",
        "enable_punc": True,
        "enable_itn": True,
        "enable_ddc": True,
        "enable_nonstream": True,
        "result_type": "single",
        "show_utterances": True,
        "enable_speaker_info": True,
        "ssd_version": "200",
        "end_window_size": 800,
        "force_to_speech_time": 1000,
    }
    if hotwords:
        words_list = [{"word": w} for w in hotwords[:100]]
        request["corpus"] = {"context": json.dumps({"hotwords": words_list})}
    payload = {
        "user": {"uid": str(uuid.uuid4())},
        "request": request,
        "audio": {"format": "pcm", "rate": 16000, "bits": 16, "channel": 1, "codec": "raw"},
    }
    payload_bytes = json.dumps(payload).encode("utf-8")
    header = struct.pack(">BBBB", _PROTO_VERSION_HEADER_SIZE, _CONFIG_MSG_TYPE_FLAGS, _CONFIG_SERIALIZATION, _RESERVED)
    size = struct.pack(">I", len(payload_bytes))
    return header + size + payload_bytes


def _build_audio_frame(audio_data: bytes, is_final: bool = False) -> bytes:
    msg_type_flags = _AUDIO_MSG_TYPE_FINAL if is_final else _AUDIO_MSG_TYPE
    header = struct.pack(">BBBB", _PROTO_VERSION_HEADER_SIZE, msg_type_flags, _AUDIO_SERIALIZATION, _RESERVED)
    size = struct.pack(">I", len(audio_data))
    return header + size + audio_data


def _parse_response_frame(data: bytes) -> dict | None:
    if len(data) < 12:
        return None
    msg_type = (data[1] >> 4) & 0x0F
    compress = data[2] & 0x0F
    if msg_type == _RESP_TYPE_ERROR:
        if len(data) > 12:
            try:
                logger.error("ASR server error: %s", data[12:].decode("utf-8"))
            except UnicodeDecodeError:
                pass
        return {"_type": "error"}
    if msg_type == _RESP_TYPE_ASR_RESULT:
        payload_size = struct.unpack(">I", data[8:12])[0]
        json_bytes = data[12:12 + payload_size]
        if compress == 1:
            try:
                json_bytes = gzip.decompress(json_bytes)
            except Exception:
                return None
        if not json_bytes:
            return None
        try:
            return json.loads(json_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            logger.warning("ASR failed to parse result: %s", e)
            return None
    return None


class VolcengineASRClient:
    """Volcengine Seed-ASR 2.0 streaming WebSocket client."""

    def __init__(self) -> None:
        self._sessions: dict[str, MeetingSession] = {}

    async def start_session(self, meeting_id: str) -> MeetingSession:
        connect_id = str(uuid.uuid4())
        headers = {
            "X-Api-App-Key": ASR_APP_ID,
            "X-Api-Access-Key": ASR_ACCESS_KEY,
            "X-Api-Resource-Id": ASR_RESOURCE_ID,
            "X-Api-Connect-Id": connect_id,
        }
        ws = await websockets.connect(VOLCANO_WSS_URL, additional_headers=headers)
        session = MeetingSession(meeting_id=meeting_id, ws=ws, session_start=time.monotonic())
        self._sessions[meeting_id] = session
        config_frame = _build_config_frame()
        await ws.send(config_frame)
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
        session = self._sessions.get(meeting_id)
        if not session or not session.ws or session.is_paused or session.is_ended:
            return
        frame = _build_audio_frame(pcm_data)
        await session.ws.send(frame)

    async def receive_results(self, meeting_id: str):
        session = self._sessions.get(meeting_id)
        if not session or not session.ws:
            return
        logger.info("ASR receive_results started for meeting %s (session_start=%.0f)", meeting_id, session.session_start)
        try:
            async for message in session.ws:
                if session.is_ended:
                    break
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
                partial_utt = None
                for utt in utterances:
                    text = utt.get("text", "")
                    if not text.strip():
                        continue
                    definite = utt.get("definite", False)
                    start_time = utt.get("start_time", 0)
                    end_time = utt.get("end_time", 0)
                    additions = utt.get("additions", {})
                    raw_speaker = str(additions.get("speaker_id", "")) if additions else ""
                    if raw_speaker and raw_speaker.isdigit():
                        speaker_id = f"speaker_{raw_speaker}"
                    elif raw_speaker and raw_speaker.startswith("speaker_"):
                        speaker_id = raw_speaker
                    else:
                        speaker_id = "speaker_0"
                    if definite:
                        dedup_key = re.sub(r'[\s，。！？,.!?、；：""\'\'《》【】()（）]', '', text)
                        if dedup_key in session._seen_definite:
                            continue
                        session._seen_definite.add(dedup_key)
                    if not definite:
                        partial_utt = (speaker_id, text, start_time, end_time)
                        continue
                    session.sequence_counter += 1
                    u = Utterance(speaker_id=speaker_id, text=text, start_time_ms=start_time, end_time_ms=end_time, is_final=True, sequence=session.sequence_counter)
                    session.utterances.append(u)
                    yield u
                if partial_utt:
                    sp_id, p_text, p_start, p_end = partial_utt
                    yield Utterance(speaker_id=sp_id, text=p_text, start_time_ms=p_start, end_time_ms=p_end, is_final=False, sequence=0)
        except websockets.ConnectionClosed:
            logger.info("ASR WebSocket closed for meeting %s", meeting_id)
        except Exception as e:
            logger.error("ASR receive error for meeting %s: %s", meeting_id, e)

    async def end_session(self, meeting_id: str) -> list[Utterance]:
        session = self._sessions.get(meeting_id)
        if not session or not session.ws:
            return session.utterances if session else []
        session.is_ended = True
        try:
            await session.ws.send(_build_audio_frame(b"", is_final=True))
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
                                session.utterances.append(Utterance(speaker_id=speaker_id, text=utt["text"], start_time_ms=utt.get("start_time", 0), end_time_ms=utt.get("end_time", 0), is_final=True, sequence=session.sequence_counter))
                    if isinstance(message, bytes) and len(message) >= 2:
                        flags = message[1] & 0x0F
                        if flags in (0x02, 0x03):
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
        session = self._sessions.get(meeting_id)
        if not session:
            return ""
        lines = []
        for u in session.utterances:
            ts = f"{u.start_time_ms // 60000:02d}:{(u.start_time_ms // 1000) % 60:02d}"
            lines.append(f"[{u.speaker_id}] ({ts}) {u.text}")
        return "\n".join(lines)


# ── Whisper ASR Client (local Belle-whisper via Xinference) ────────

WHISPER_MIN_AUDIO_SECS = 1.0  # skip chunks shorter than this
WHISPER_MAX_AUDIO_SECS = 55  # FireRedASR-AED supports up to 60s, leave 5s margin
WHISPER_SILENCE_MS = 500  # silence duration (ms) to trigger sentence boundary
WHISPER_SILENCE_THRESHOLD = 500  # PCM RMS below this = silence
WHISPER_SPEECH_RATIO = 0.15  # at least 15% of samples must exceed peak threshold
WHISPER_PEAK_THRESHOLD = 1000  # individual sample amplitude for speech detection
WHISPER_SAMPLE_RATE = 16000
WHISPER_SAMPLE_WIDTH = 2  # 16-bit
WHISPER_CHECK_INTERVAL = 0.2  # check VAD every 200ms
WHISPER_SAMPLE_RATE = 16000
WHISPER_SAMPLE_WIDTH = 2  # 16-bit


def _pcm_to_wav(pcm_data: bytes) -> bytes:
    """Convert raw PCM bytes to WAV format in memory."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(WHISPER_SAMPLE_WIDTH)
        wf.setframerate(WHISPER_SAMPLE_RATE)
        wf.writeframes(pcm_data)
    return buf.getvalue()


def _has_speech(pcm_data: bytes) -> bool:
    """Stricter VAD: check both RMS energy AND that enough samples exceed peak threshold.

    This prevents sending near-silent audio that causes ASR hallucination.
    """
    if len(pcm_data) < 4:
        return False
    n_samples = len(pcm_data) // 2
    samples = struct.unpack(f"<{n_samples}h", pcm_data[:n_samples * 2])

    # Check 1: RMS energy must exceed threshold
    rms = (sum(s * s for s in samples) / n_samples) ** 0.5
    if rms < WHISPER_SILENCE_THRESHOLD:
        return False

    # Check 2: at least SPEECH_RATIO of samples must be "loud" (above peak threshold)
    loud_count = sum(1 for s in samples if abs(s) > WHISPER_PEAK_THRESHOLD)
    ratio = loud_count / n_samples
    if ratio < WHISPER_SPEECH_RATIO:
        return False

    return True


# Common ASR hallucination patterns (FireRedASR + Whisper)
_HALLUCINATION_PATTERNS = [
    r'^.{0,2}$',                          # Too short (1-2 chars)
    r'^(.)\1{3,}',                         # Single char repeated 4+ times: 嗯嗯嗯嗯
    r'(基地|活动|列表|消息|会议).*(基地|活动|列表|消息|会议)',  # FireRedASR specific hallucination patterns
    r'(谢谢|感谢|再见|拜拜|你好){2,}',      # Repeated greetings
    r'(thank you|thanks|bye|hello){2,}',
]
_HALLUCINATION_RE = re.compile('|'.join(_HALLUCINATION_PATTERNS), re.IGNORECASE)


def _is_hallucination(text: str) -> bool:
    """Detect ASR hallucination: repetitive, too short, or known garbage patterns."""
    text = text.strip()
    if not text:
        return True
    # Single char or 2 chars — usually garbage
    if len(text) <= 2:
        return True
    # Repeated single character
    if len(set(text.replace(" ", "").replace("，", "").replace("。", ""))) <= 2:
        return True
    # Short phrase repeats 3+ times
    for phrase_len in range(2, min(10, len(text) // 3 + 1)):
        phrase = text[:phrase_len]
        if text.count(phrase) >= 3:
            return True
    # Known hallucination patterns
    if _HALLUCINATION_RE.search(text):
        return True
    return False


class WhisperASRClient:
    """Local Whisper ASR via Xinference OpenAI-compatible API.

    Buffers PCM audio and flushes to whisper every WHISPER_FLUSH_INTERVAL seconds.
    No speaker diarization — all text attributed to speaker_0.
    """

    def __init__(self, base_url: str = "http://10.200.0.102:8200/v1") -> None:
        self._sessions: dict[str, MeetingSession] = {}
        self.base_url = base_url.rstrip("/")

    async def start_session(self, meeting_id: str) -> MeetingSession:
        session = MeetingSession(
            meeting_id=meeting_id,
            session_start=time.monotonic(),
            _result_queue=asyncio.Queue(),
        )
        self._sessions[meeting_id] = session

        # Start background flush task
        session._flush_task = asyncio.create_task(self._flush_loop(meeting_id))
        logger.info("Whisper ASR session started for meeting %s", meeting_id)
        return session

    async def send_audio(self, meeting_id: str, pcm_data: bytes) -> None:
        session = self._sessions.get(meeting_id)
        if not session or session.is_paused or session.is_ended:
            return
        session._audio_buffer.extend(pcm_data)

    def _is_chunk_silent(self, pcm_chunk: bytes) -> bool:
        """Check if a small PCM chunk (~200ms) is silence."""
        if len(pcm_chunk) < 4:
            return True
        n = len(pcm_chunk) // 2
        samples = struct.unpack(f"<{n}h", pcm_chunk[:n * 2])
        rms = (sum(s * s for s in samples) / n) ** 0.5
        return rms < WHISPER_SILENCE_THRESHOLD

    async def _flush_loop(self, meeting_id: str) -> None:
        """VAD-based sentence segmentation: cut on silence, not fixed time.

        - Accumulates audio in buffer
        - Every 200ms, checks the latest chunk for silence
        - If silence >= 500ms and buffer >= 1s → sentence boundary → send to ASR
        - If buffer reaches 55s → force cut (FireRedASR max = 60s)
        """
        session = self._sessions.get(meeting_id)
        if not session:
            return

        bytes_per_sec = WHISPER_SAMPLE_RATE * WHISPER_SAMPLE_WIDTH
        min_bytes = int(WHISPER_MIN_AUDIO_SECS * bytes_per_sec)
        max_bytes = int(WHISPER_MAX_AUDIO_SECS * bytes_per_sec)
        silence_bytes = int(WHISPER_SILENCE_MS / 1000 * bytes_per_sec)
        check_bytes = int(WHISPER_CHECK_INTERVAL * bytes_per_sec)  # ~200ms worth

        consecutive_silence_bytes = 0
        speech_started = False

        while not session.is_ended:
            await asyncio.sleep(WHISPER_CHECK_INTERVAL)

            if session.is_paused or session.is_ended:
                consecutive_silence_bytes = 0
                speech_started = False
                continue

            buf_len = len(session._audio_buffer)
            if buf_len < check_bytes:
                continue

            # Check latest ~200ms for silence
            latest_chunk = bytes(session._audio_buffer[-check_bytes:])
            is_silent = self._is_chunk_silent(latest_chunk)

            if is_silent:
                consecutive_silence_bytes += check_bytes
            else:
                consecutive_silence_bytes = 0
                if not speech_started and buf_len >= check_bytes:
                    speech_started = True
                    # Send a partial "listening" indicator so user sees feedback
                    elapsed_ms = int((time.monotonic() - session.session_start) * 1000)
                    if session._result_queue:
                        await session._result_queue.put(Utterance(
                            speaker_id="speaker_0", text="...",
                            start_time_ms=elapsed_ms, end_time_ms=elapsed_ms,
                            is_final=False, sequence=0,
                        ))

            # Decide whether to flush
            should_flush = False

            if speech_started and consecutive_silence_bytes >= silence_bytes and buf_len >= min_bytes:
                # Sentence boundary: speech followed by 500ms silence
                should_flush = True
                logger.debug("VAD sentence boundary: %d bytes, silence=%dms",
                             buf_len, consecutive_silence_bytes * 1000 // bytes_per_sec)

            elif buf_len >= max_bytes:
                # Safety: max 55s reached
                should_flush = True
                logger.info("VAD force cut at %ds", buf_len // bytes_per_sec)

            if not should_flush:
                continue

            # Extract audio up to (but not including) the trailing silence
            if consecutive_silence_bytes > 0 and buf_len > consecutive_silence_bytes:
                speech_end = buf_len - consecutive_silence_bytes
                pcm_data = bytes(session._audio_buffer[:speech_end])
                # Keep trailing silence in buffer for next segment
                remaining = bytes(session._audio_buffer[speech_end:])
                session._audio_buffer.clear()
                session._audio_buffer.extend(remaining)
            else:
                pcm_data = bytes(session._audio_buffer)
                session._audio_buffer.clear()

            consecutive_silence_bytes = 0
            speech_started = False

            # Skip if mostly silence
            if not _has_speech(pcm_data):
                continue

            elapsed_ms = int((time.monotonic() - session.session_start) * 1000)
            duration_ms = int(len(pcm_data) / bytes_per_sec * 1000)
            start_ms = max(0, elapsed_ms - duration_ms)

            # Context from previous utterances
            prompt_parts = [u.text for u in session.utterances[-2:]]
            prompt = "".join(prompt_parts) if prompt_parts else ""

            try:
                wav_data = _pcm_to_wav(pcm_data)
                text = await self._transcribe(wav_data, prompt=prompt)
                text = (text or "").strip()

                if not text or _is_hallucination(text):
                    continue
                if session.utterances and session.utterances[-1].text == text:
                    continue

                session.sequence_counter += 1
                utt = Utterance(
                    speaker_id="speaker_0",
                    text=text,
                    start_time_ms=start_ms,
                    end_time_ms=elapsed_ms,
                    is_final=True,
                    sequence=session.sequence_counter,
                )
                session.utterances.append(utt)
                if session._result_queue:
                    await session._result_queue.put(utt)
            except Exception as e:
                logger.error("ASR transcription failed for meeting %s: %s", meeting_id, e)

    async def _transcribe(self, wav_data: bytes, prompt: str = "") -> str:
        """POST audio to whisper API and return text."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            form_data: dict[str, str] = {
                "model": "FireRedASR-AED-L",
                "language": "zh",
                "temperature": "0",
                "response_format": "json",
            }
            if prompt:
                # initial_prompt gives whisper context from previous segments
                form_data["initial_prompt"] = prompt[-200:]  # last 200 chars
            resp = await client.post(
                f"{self.base_url}/audio/transcriptions",
                files={"file": ("audio.wav", wav_data, "audio/wav")},
                data=form_data,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("text", "")
            else:
                logger.error("Whisper API returned %d: %s", resp.status_code, resp.text[:200])
                return ""

    async def receive_results(self, meeting_id: str):
        """Async generator yielding Utterance objects from the result queue."""
        session = self._sessions.get(meeting_id)
        if not session or not session._result_queue:
            return

        logger.info("Whisper receive_results started for meeting %s", meeting_id)
        while not session.is_ended:
            try:
                utt = await asyncio.wait_for(session._result_queue.get(), timeout=1.0)
                yield utt
            except asyncio.TimeoutError:
                continue
            except Exception:
                break

    async def end_session(self, meeting_id: str) -> list[Utterance]:
        session = self._sessions.get(meeting_id)
        if not session:
            return []

        session.is_ended = True

        # Cancel flush task
        if session._flush_task:
            session._flush_task.cancel()
            try:
                await session._flush_task
            except asyncio.CancelledError:
                pass

        # Flush remaining audio
        if len(session._audio_buffer) > WHISPER_SAMPLE_RATE * WHISPER_SAMPLE_WIDTH // 2:
            try:
                pcm_data = bytes(session._audio_buffer)
                session._audio_buffer.clear()
                wav_data = _pcm_to_wav(pcm_data)
                text = await self._transcribe(wav_data)
                if text and text.strip():
                    elapsed_ms = int((time.monotonic() - session.session_start) * 1000)
                    session.sequence_counter += 1
                    session.utterances.append(Utterance(
                        speaker_id="speaker_0", text=text.strip(),
                        start_time_ms=max(0, elapsed_ms - 3000), end_time_ms=elapsed_ms,
                        is_final=True, sequence=session.sequence_counter,
                    ))
            except Exception as e:
                logger.error("Whisper final flush failed: %s", e)

        all_utterances = session.utterances
        self._sessions.pop(meeting_id, None)
        logger.info("Whisper ASR session ended for meeting %s (%d utterances)", meeting_id, len(all_utterances))
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
        session = self._sessions.get(meeting_id)
        if not session:
            return ""
        lines = []
        for u in session.utterances:
            ts = f"{u.start_time_ms // 60000:02d}:{(u.start_time_ms // 1000) % 60:02d}"
            lines.append(f"[{u.speaker_id}] ({ts}) {u.text}")
        return "\n".join(lines)


# ── Singleton: select provider ─────────────────────────────────────

import os

_ASR_PROVIDER = os.getenv("ASR_PROVIDER", "whisper").lower()

if _ASR_PROVIDER == "whisper":
    _whisper_url = os.getenv("WHISPER_BASE_URL", "http://10.200.0.102:9997/v1")
    asr_client = WhisperASRClient(base_url=_whisper_url)
    logger.info("ASR provider: Whisper (local) at %s", _whisper_url)
else:
    asr_client = VolcengineASRClient()
    logger.info("ASR provider: Volcengine Seed-ASR 2.0")
