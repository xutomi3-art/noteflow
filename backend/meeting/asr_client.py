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
import os
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
    provider: str = ""  # ASR provider name for comparison mode


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
    notebook_id: str = ""  # for hotwords lookup


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

    async def start_session(self, meeting_id: str, **kwargs: str) -> MeetingSession:
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

WHISPER_IDLE_TIMEOUT = 1800  # 30 minutes — auto-end meeting if no speech
WHISPER_MIN_AUDIO_SECS = 1.0  # skip chunks shorter than this
WHISPER_MAX_AUDIO_SECS = 55  # FireRedASR-AED supports up to 60s, leave 5s margin
WHISPER_SILENCE_MS = 700  # silence duration (ms) to trigger sentence boundary (longer = less fragmentation)
WHISPER_SILENCE_THRESHOLD = 400  # PCM RMS below this = silence
WHISPER_SPEECH_RATIO = 0.12  # at least 12% of samples must exceed peak threshold
WHISPER_PEAK_THRESHOLD = 800  # individual sample amplitude for speech detection
WHISPER_SAMPLE_RATE = 16000
WHISPER_SAMPLE_WIDTH = 2  # 16-bit
WHISPER_CHECK_INTERVAL = 0.15  # check VAD every 150ms (was 200ms)
# Audio normalization target
WHISPER_TARGET_RMS = 3000  # target RMS amplitude for normalization


def _normalize_audio(pcm_data: bytes, target_rms: int = WHISPER_TARGET_RMS) -> bytes:
    """Normalize PCM audio volume to target RMS. Prevents VAD instability from volume swings."""
    if len(pcm_data) < 4:
        return pcm_data
    n = len(pcm_data) // 2
    samples = list(struct.unpack(f"<{n}h", pcm_data[:n * 2]))
    rms = (sum(s * s for s in samples) / n) ** 0.5
    if rms < 10:  # near silence, don't amplify noise
        return pcm_data
    gain = target_rms / rms
    gain = min(gain, 5.0)  # cap at 5x amplification to avoid distortion
    normalized = [max(-32768, min(32767, int(s * gain))) for s in samples]
    return struct.pack(f"<{n}h", *normalized)


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


_VALID_SHORT_RESPONSES = {
    "是", "对", "好", "嗯", "啊", "哦", "行", "没", "不", "有",
    "是的", "好的", "对的", "嗯嗯", "好吧", "对吧", "没有", "不是",
    "可以", "知道", "明白", "好啊", "对啊", "是啊",
}


def _is_hallucination(text: str) -> bool:
    """Detect ASR hallucination: repetitive or known garbage patterns."""
    text = text.strip()
    if not text:
        return True
    # Allow valid short Chinese responses
    if text in _VALID_SHORT_RESPONSES:
        return False
    # Single char — usually garbage (unless in whitelist above)
    if len(text) == 1:
        return True
    # Single char repeated 4+ times: 嗯嗯嗯嗯
    stripped = text.replace(" ", "").replace("，", "").replace("。", "")
    if len(stripped) >= 4 and len(set(stripped)) == 1:
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


def _add_punctuation(text: str) -> str:
    """Add basic Chinese/English punctuation to unpunctuated ASR output.

    FireRedASR-AED strips all punctuation. This restores sentence-ending
    periods and mid-sentence commas using simple heuristics.
    """
    if not text or len(text) < 2:
        return text

    # If text already has punctuation, skip
    if re.search(r'[，。？！,.!?；：]', text):
        return text

    # Chinese clause boundary markers — add comma before these
    clause_markers = (
        '但是', '但', '然后', '所以', '因为', '如果', '虽然', '不过',
        '而且', '并且', '或者', '那么', '就是', '也就是说', '比如说', '比如',
        '另外', '同时', '而', '可是', '不然', '否则', '于是', '因此',
        '总之', '其实', '那', '就', '还有', '包括',
        '首先', '最后', '此外', '接着', '其次', '再说', '何况', '况且',
    )

    # English clause markers
    en_markers = (
        ' but ', ' however ', ' so ', ' because ', ' although ',
        ' therefore ', ' meanwhile ', ' and then ', ' moreover ',
    )

    result = text
    for marker in clause_markers:
        # Add comma before clause marker (if not at start and no existing punctuation before it)
        result = re.sub(
            rf'(?<=[^\s，。,.])\s*({re.escape(marker)})',
            rf'，\1',
            result,
        )

    # English clause markers — add comma before
    for marker in en_markers:
        result = result.replace(marker, f',{marker.strip()} ')

    # Add period at end if missing
    if result and result[-1] not in '，。？！,.!?；：…':
        # Question detection: scan full text, not just ending
        if re.search(r'[吗呢吧]$', result) or re.search(r'(什么|哪里|哪个|怎么|为什么|多少|是否|是不是)', result):
            result += '？'
        elif re.search(r'\?$|^(how|what|when|where|who|why|is |are |do |does |can |will )', result, re.IGNORECASE):
            result += '?'
        else:
            result += '。'

    return result


class WhisperASRClient:
    """Local ASR client (FunASR/Whisper) with LLM rewrite.

    Buffers PCM audio, flushes on VAD sentence boundary.
    Accumulates N raw sentences, then sends batch to LLM for polishing.
    """

    def __init__(self, base_url: str = "http://10.200.0.102:8202/v1") -> None:
        self._sessions: dict[str, MeetingSession] = {}
        self.base_url = base_url.rstrip("/")
        self._pending_rewrite: dict[str, list[Utterance]] = {}  # meeting_id -> unrewritten utterances

    async def start_session(self, meeting_id: str, notebook_id: str = "") -> MeetingSession:
        session = MeetingSession(
            meeting_id=meeting_id,
            session_start=time.monotonic(),
            _result_queue=asyncio.Queue(),
            notebook_id=notebook_id,
        )
        self._sessions[meeting_id] = session

        # Start background flush task
        session._flush_task = asyncio.create_task(self._flush_loop(meeting_id))
        logger.info("ASR session started for meeting %s (notebook=%s)", meeting_id, notebook_id)
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
        last_speech_time = time.monotonic()

        while not session.is_ended:
            await asyncio.sleep(WHISPER_CHECK_INTERVAL)

            if session.is_paused or session.is_ended:
                consecutive_silence_bytes = 0
                speech_started = False
                continue

            # Idle timeout: auto-end if no speech for 30 minutes
            if time.monotonic() - last_speech_time > WHISPER_IDLE_TIMEOUT:
                logger.info("Meeting %s idle timeout (%ds), auto-ending", meeting_id, WHISPER_IDLE_TIMEOUT)
                session.is_ended = True
                if session._result_queue:
                    await session._result_queue.put(Utterance(
                        speaker_id="system", text="Meeting auto-ended due to 30 minutes of inactivity.",
                        start_time_ms=0, end_time_ms=0, is_final=True, sequence=0,
                    ))
                break

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
                last_speech_time = time.monotonic()  # reset idle timer
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

                # Add punctuation (FireRedASR-AED strips all punctuation)
                text = _add_punctuation(text)

                if session.utterances and session.utterances[-1].text == text:
                    continue

                session.sequence_counter += 1
                utt = Utterance(
                    speaker_id="speaker_0",
                    text=text,
                    start_time_ms=start_ms,
                    end_time_ms=elapsed_ms,
                    is_final=False,  # show as partial until LLM rewrites
                    sequence=session.sequence_counter,
                )
                session.utterances.append(utt)
                if session._result_queue:
                    await session._result_queue.put(utt)

                # Accumulate for LLM rewrite batch
                pending = self._pending_rewrite.setdefault(meeting_id, [])
                pending.append(utt)
                if len(pending) >= LLM_REWRITE_BATCH_SIZE:
                    batch = list(pending)
                    pending.clear()
                    asyncio.create_task(self._rewrite_batch(session, batch))
            except Exception as e:
                logger.error("ASR transcription failed for meeting %s: %s", meeting_id, e)

    async def _rewrite_batch(self, session: MeetingSession, batch: list[Utterance]) -> None:
        """Send batch of ASR utterances to LLM for polishing, then emit rewritten versions."""
        try:
            raw_texts = [u.text for u in batch]
            rewritten = await _llm_rewrite(raw_texts, notebook_id=session.notebook_id)

            for orig_utt, new_text in zip(batch, rewritten):
                # Update the utterance in session history
                orig_utt.text = new_text
                orig_utt.is_final = True

                # Send rewritten version to frontend (replaces the partial)
                if session._result_queue:
                    await session._result_queue.put(Utterance(
                        speaker_id=orig_utt.speaker_id,
                        text=new_text,
                        start_time_ms=orig_utt.start_time_ms,
                        end_time_ms=orig_utt.end_time_ms,
                        is_final=True,
                        sequence=orig_utt.sequence,
                        provider=orig_utt.provider,
                    ))
            logger.info("LLM rewrite batch: %d sentences rewritten", len(batch))
        except Exception as e:
            logger.error("LLM rewrite batch failed: %s", e)
            # Mark originals as final anyway
            for utt in batch:
                utt.is_final = True
                if session._result_queue:
                    await session._result_queue.put(utt)

    async def _transcribe(self, wav_data: bytes, prompt: str = "") -> str:
        """POST audio to ASR API and return text."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            form_data: dict[str, str] = {
                "model": "FunASR-SenseVoiceSmall",
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
                    text = _add_punctuation(text.strip())
                    elapsed_ms = int((time.monotonic() - session.session_start) * 1000)
                    session.sequence_counter += 1
                    session.utterances.append(Utterance(
                        speaker_id="speaker_0", text=text,
                        start_time_ms=max(0, elapsed_ms - 3000), end_time_ms=elapsed_ms,
                        is_final=True, sequence=session.sequence_counter,
                    ))
            except Exception as e:
                logger.error("Whisper final flush failed: %s", e)

        # Flush remaining pending rewrite batch
        pending = self._pending_rewrite.pop(meeting_id, [])
        if pending:
            try:
                raw_texts = [u.text for u in pending]
                rewritten = await _llm_rewrite(raw_texts)
                for utt, new_text in zip(pending, rewritten):
                    utt.text = new_text
                    utt.is_final = True
            except Exception as e:
                logger.warning("Final LLM rewrite failed: %s", e)
                for utt in pending:
                    utt.is_final = True

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


# ── Comparison ASR Client (3-way parallel) ─────────────────────────

ASR_ENDPOINTS = {
    "coli": os.environ.get("COLI_ASR_URL", "http://10.200.0.112:8201/v1"),
    "funasr": os.environ.get("FUNASR_ASR_URL", "http://10.200.0.102:8202/v1"),
}

ASR_MODELS = {
    "coli": "sensevoice",
    "funasr": "FunASR-SenseVoiceSmall",
}


class ComparisonASRClient:
    """Sends same audio to 3 ASR backends in parallel, tags results with provider."""

    def __init__(self) -> None:
        self._sessions: dict[str, MeetingSession] = {}
        self._endpoints = ASR_ENDPOINTS.copy()

    async def start_session(self, meeting_id: str) -> MeetingSession:
        session = MeetingSession(
            meeting_id=meeting_id,
            session_start=time.monotonic(),
            _result_queue=asyncio.Queue(),
        )
        self._sessions[meeting_id] = session
        session._flush_task = asyncio.create_task(self._flush_loop(meeting_id))
        logger.info("Comparison ASR session started for meeting %s (%d providers)", meeting_id, len(self._endpoints))
        return session

    async def send_audio(self, meeting_id: str, pcm_data: bytes) -> None:
        session = self._sessions.get(meeting_id)
        if not session or session.is_paused or session.is_ended:
            return
        pcm_data = _normalize_audio(pcm_data)
        session._audio_buffer.extend(pcm_data)

    def _is_chunk_silent(self, pcm_chunk: bytes) -> bool:
        if len(pcm_chunk) < 4:
            return True
        n = len(pcm_chunk) // 2
        samples = struct.unpack(f"<{n}h", pcm_chunk[:n * 2])
        rms = (sum(s * s for s in samples) / n) ** 0.5
        return rms < WHISPER_SILENCE_THRESHOLD

    async def _transcribe_one(self, provider: str, wav_data: bytes, prompt: str = "") -> tuple[str, str]:
        """Transcribe with one provider. Returns (provider, text)."""
        url = self._endpoints[provider]
        model = ASR_MODELS[provider]
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                form_data: dict[str, str] = {"model": model, "language": "zh"}
                if provider == "firered":
                    form_data["temperature"] = "0"
                if prompt and provider == "firered":
                    form_data["initial_prompt"] = prompt[-200:]
                resp = await client.post(
                    f"{url.rstrip('/')}/audio/transcriptions",
                    files={"file": ("audio.wav", wav_data, "audio/wav")},
                    data=form_data,
                )
                if resp.status_code == 200:
                    text = resp.json().get("text", "")
                    return provider, text.strip()
                else:
                    logger.warning("%s ASR returned %d", provider, resp.status_code)
                    return provider, ""
        except Exception as e:
            logger.warning("%s ASR error: %s", provider, str(e)[:80])
            return provider, ""

    async def _flush_loop(self, meeting_id: str) -> None:
        """VAD-based flush, sends same audio segment to all 3 ASR providers."""
        session = self._sessions.get(meeting_id)
        if not session:
            return

        bytes_per_sec = WHISPER_SAMPLE_RATE * WHISPER_SAMPLE_WIDTH
        min_bytes = int(WHISPER_MIN_AUDIO_SECS * bytes_per_sec)
        max_bytes = int(WHISPER_MAX_AUDIO_SECS * bytes_per_sec)
        silence_bytes = int(WHISPER_SILENCE_MS / 1000 * bytes_per_sec)
        check_bytes = int(WHISPER_CHECK_INTERVAL * bytes_per_sec)

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

            latest_chunk = bytes(session._audio_buffer[-check_bytes:])
            is_silent = self._is_chunk_silent(latest_chunk)

            if is_silent:
                consecutive_silence_bytes += check_bytes
            else:
                consecutive_silence_bytes = 0
                if not speech_started and buf_len >= check_bytes:
                    speech_started = True
                    elapsed_ms = int((time.monotonic() - session.session_start) * 1000)
                    if session._result_queue:
                        await session._result_queue.put(Utterance(
                            speaker_id="speaker_0", text="...",
                            start_time_ms=elapsed_ms, end_time_ms=elapsed_ms,
                            is_final=False, sequence=0, provider="firered",
                        ))

            should_flush = False
            if speech_started and consecutive_silence_bytes >= silence_bytes and buf_len >= min_bytes:
                should_flush = True
            elif buf_len >= max_bytes:
                should_flush = True

            if not should_flush:
                continue

            if consecutive_silence_bytes > 0 and buf_len > consecutive_silence_bytes:
                speech_end = buf_len - consecutive_silence_bytes
                pcm_data = bytes(session._audio_buffer[:speech_end])
                remaining = bytes(session._audio_buffer[speech_end:])
                session._audio_buffer.clear()
                session._audio_buffer.extend(remaining)
            else:
                pcm_data = bytes(session._audio_buffer)
                session._audio_buffer.clear()

            consecutive_silence_bytes = 0
            speech_started = False

            if not _has_speech(pcm_data):
                continue

            elapsed_ms = int((time.monotonic() - session.session_start) * 1000)
            duration_ms = int(len(pcm_data) / bytes_per_sec * 1000)
            start_ms = max(0, elapsed_ms - duration_ms)

            prompt_parts = [u.text for u in session.utterances[-2:] if u.provider == "firered"]
            prompt = "".join(prompt_parts) if prompt_parts else ""

            wav_data = _pcm_to_wav(pcm_data)

            # Fire-and-forget: send to all 3 ASR providers without blocking the flush loop
            asyncio.create_task(self._process_segment(session, wav_data, prompt, start_ms, elapsed_ms))

    async def _process_segment(self, session: MeetingSession, wav_data: bytes, prompt: str, start_ms: int, elapsed_ms: int) -> None:
        """Send one audio segment to all ASR providers in parallel, enqueue results."""
        try:
            tasks = [self._transcribe_one(p, wav_data, prompt) for p in self._endpoints]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for result in results:
                if isinstance(result, Exception):
                    continue
                provider, text = result
                if not text or _is_hallucination(text):
                    continue

                # Add punctuation for all providers that don't produce their own
                text = _add_punctuation(text)

                session.sequence_counter += 1
                utt = Utterance(
                    speaker_id="speaker_0",
                    text=text,
                    start_time_ms=start_ms,
                    end_time_ms=elapsed_ms,
                    is_final=True,
                    sequence=session.sequence_counter,
                    provider=provider,
                )
                session.utterances.append(utt)
                if session._result_queue:
                    await session._result_queue.put(utt)
        except Exception as e:
            logger.error("ASR segment processing error: %s", e)

    async def receive_results(self, meeting_id: str):
        session = self._sessions.get(meeting_id)
        if not session or not session._result_queue:
            return
        logger.info("Comparison receive_results started for meeting %s", meeting_id)
        while not session.is_ended:
            try:
                utt = await asyncio.wait_for(session._result_queue.get(), timeout=1.0)
                yield utt
            except asyncio.TimeoutError:
                continue

    async def end_session(self, meeting_id: str) -> list[Utterance]:
        session = self._sessions.get(meeting_id)
        if not session:
            return []
        session.is_ended = True
        if session._flush_task:
            session._flush_task.cancel()
            try:
                await session._flush_task
            except asyncio.CancelledError:
                pass
        all_utterances = session.utterances
        self._sessions.pop(meeting_id, None)
        logger.info("Comparison ASR session ended for meeting %s (%d utterances)", meeting_id, len(all_utterances))
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
            if u.provider != "firered":
                continue
            ts = f"{u.start_time_ms // 60000:02d}:{(u.start_time_ms // 1000) % 60:02d}"
            lines.append(f"[{u.speaker_id}] ({ts}) {u.text}")
        return "\n".join(lines)


# ── LLM Rewrite for ASR output ─────────────────────────────────────

LLM_REWRITE_BATCH_SIZE = int(os.getenv("LLM_REWRITE_BATCH_SIZE", "4"))  # rewrite every N sentences

_LLM_REWRITE_PROMPT = """你是语音转录润色助手。以下是语音识别的原始文本，可能有错字、缺标点、断句不自然。
请润色修正，规则：
1. 修正明显的语音识别错字（如"通俄文"→"通俄门"）
2. 补充或修正标点符号，让断句自然
3. 删除口语填充词（嗯、啊、呃、就是就是、然后然后 等重复/无意义的词）
4. 保持原意不变，不要添加或编造内容
5. 直接输出润色后的文本，不要解释
{hotwords}
原始文本：
"""

# Global hotwords store (per-notebook, set via API)
_notebook_hotwords: dict[str, list[str]] = {}


def set_hotwords(notebook_id: str, words: list[str]) -> None:
    """Set hotwords for a notebook."""
    _notebook_hotwords[notebook_id] = words
    logger.info("Hotwords updated for notebook %s: %s", notebook_id, words)


def get_hotwords(notebook_id: str) -> list[str]:
    """Get hotwords for a notebook."""
    return _notebook_hotwords.get(notebook_id, [])


async def _llm_rewrite(texts: list[str], notebook_id: str = "") -> list[str]:
    """Send batch of ASR sentences to LLM for polishing."""
    try:
        from backend.services.qwen_client import qwen_client
        combined = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))

        # Build hotwords hint
        hotwords = get_hotwords(notebook_id) if notebook_id else []
        hotwords_hint = ""
        if hotwords:
            hotwords_hint = f"\n6. 以下是专有名词/热词的正确写法，遇到发音相似的错字请修正为正确写法：{', '.join(hotwords)}\n"

        prompt = _LLM_REWRITE_PROMPT.replace("{hotwords}", hotwords_hint)
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": combined},
        ]
        result = await qwen_client.generate(messages, temperature=0.0, max_tokens=2000)
        if not result or result.startswith("[Error"):
            return texts  # fallback to original

        # Parse numbered lines back
        rewritten = []
        for line in result.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            # Strip leading number: "1. text" or "1、text" or "1.text"
            cleaned = re.sub(r'^\d+[\.\、\)\s]+', '', line).strip()
            if cleaned:
                rewritten.append(cleaned)

        # If parsing failed or count mismatch, return originals
        if len(rewritten) != len(texts):
            logger.warning("LLM rewrite count mismatch: got %d, expected %d", len(rewritten), len(texts))
            return texts
        return rewritten
    except Exception as e:
        logger.warning("LLM rewrite failed: %s", e)
        return texts


# ── Singleton: select provider ─────────────────────────────────────

_ASR_PROVIDER = os.getenv("ASR_PROVIDER", "funasr").lower()

if _ASR_PROVIDER == "funasr":
    _funasr_url = os.getenv("FUNASR_ASR_URL", "http://10.200.0.102:8202/v1")
    asr_client = WhisperASRClient(base_url=_funasr_url)
    logger.info("ASR provider: FunASR at %s (with LLM rewrite)", _funasr_url)
elif _ASR_PROVIDER == "comparison":
    asr_client = ComparisonASRClient()
    logger.info("ASR provider: Comparison mode (3-way)")
elif _ASR_PROVIDER == "whisper":
    _whisper_url = os.getenv("WHISPER_BASE_URL", "http://10.200.0.102:8200/v1")
    asr_client = WhisperASRClient(base_url=_whisper_url)
    logger.info("ASR provider: Whisper (local) at %s", _whisper_url)
else:
    asr_client = VolcengineASRClient()
    logger.info("ASR provider: Volcengine Seed-ASR 2.0")
