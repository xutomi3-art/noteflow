import asyncio
import logging
import os
import uuid

import httpx

logger = logging.getLogger(__name__)

AUDIO_EXTENSIONS = {"mp3", "wav", "m4a", "flac", "ogg", "webm"}

SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit"
QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query"


class ASRService:
    """Volcengine (火山引擎) BigModel ASR service for audio transcription (v3 API)."""

    def __init__(self) -> None:
        self.app_id = ""
        self.access_key = ""

    def configure(self, app_id: str, access_key: str) -> None:
        self.app_id = app_id
        self.access_key = access_key

    def _headers(self, request_id: str | None = None) -> dict[str, str]:
        """Build v3 API authentication headers."""
        return {
            "X-Api-App-Key": self.app_id,
            "X-Api-Access-Key": self.access_key,
            "X-Api-Resource-Id": "volc.bigasr.auc",
            "X-Api-Request-Id": request_id or str(uuid.uuid4()),
            "X-Api-Sequence": "-1",
        }

    async def transcribe_file(self, file_path: str, language: str = "zh-CN") -> str:
        """Transcribe an audio file to text using Volcengine BigModel ASR v3.

        Uses the submit+query async pattern for audio files.
        """
        if not self.access_key:
            raise ValueError("Volcengine ASR access key not configured")

        file_size = os.path.getsize(file_path)
        audio_format = _detect_audio_format(file_path)
        request_id = str(uuid.uuid4())
        logger.info("Transcribing audio file: %s (%d bytes, format=%s)", file_path, file_size, audio_format)

        with open(file_path, "rb") as f:
            audio_data = f.read()

        async with httpx.AsyncClient(timeout=300.0) as client:
            # Submit transcription task via multipart file upload
            files_data = {
                "file": (
                    os.path.basename(file_path),
                    audio_data,
                    _detect_mime_type(file_path),
                ),
            }

            resp = await client.post(
                SUBMIT_URL,
                files=files_data,
                headers=self._headers(request_id),
            )

            if resp.status_code != 200:
                logger.error("ASR submit failed: %s %s", resp.status_code, resp.text)
                raise Exception(f"ASR submit failed: {resp.status_code}")

            result = resp.json()
            logger.info("ASR submit response: %s", result)

            task_id = result.get("id") or result.get("task_id")

            if not task_id:
                # Maybe the response contains the result directly
                text = result.get("text") or result.get("result", {}).get("text", "")
                if text:
                    return text
                raise Exception(f"No task_id in ASR response: {result}")

            # Poll for result
            for attempt in range(120):  # Max ~10 minutes
                await asyncio.sleep(5)

                query_resp = await client.get(
                    QUERY_URL,
                    params={"appid": self.app_id, "id": task_id},
                    headers=self._headers(),
                )

                if query_resp.status_code != 200:
                    logger.warning("ASR query attempt %d: HTTP %d", attempt + 1, query_resp.status_code)
                    continue

                query_result = query_resp.json()
                status = query_result.get("status") or query_result.get("code", -1)
                logger.info("ASR query attempt %d: status=%s", attempt + 1, status)

                if status in ("success", 0, "SUCCESS"):
                    utterances = query_result.get("utterances", [])
                    if utterances:
                        text_parts = [u.get("text", "") for u in utterances]
                        return "\n".join(text_parts)
                    return query_result.get("text", "")

                if status in ("failed", "FAILED", -1):
                    raise Exception(f"ASR transcription failed: {query_result}")

            raise Exception("ASR transcription timed out")


def _detect_audio_format(file_path: str) -> str:
    """Detect audio format from file extension."""
    ext = os.path.splitext(file_path)[1].lower()
    format_map = {
        ".wav": "wav",
        ".mp3": "mp3",
        ".m4a": "m4a",
        ".flac": "flac",
        ".ogg": "ogg",
        ".wma": "wma",
        ".aac": "aac",
        ".amr": "amr",
        ".opus": "opus",
        ".webm": "webm",
    }
    return format_map.get(ext, "wav")


def _detect_mime_type(file_path: str) -> str:
    """Detect MIME type from file extension."""
    ext = os.path.splitext(file_path)[1].lower()
    mime_map = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".webm": "audio/webm",
        ".aac": "audio/aac",
        ".amr": "audio/amr",
    }
    return mime_map.get(ext, "audio/wav")


asr_service = ASRService()
