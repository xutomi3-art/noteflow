import asyncio
import base64
import logging
import os
import uuid

import httpx

logger = logging.getLogger(__name__)

AUDIO_EXTENSIONS = {"mp3", "wav", "m4a", "flac", "ogg", "webm"}


class ASRService:
    """Volcengine (火山引擎) ASR service for audio transcription."""

    def __init__(self) -> None:
        self.app_id = ""
        self.access_key = ""

    def configure(self, app_id: str, access_key: str) -> None:
        self.app_id = app_id
        self.access_key = access_key

    async def transcribe_file(self, file_path: str, language: str = "zh-CN") -> str:
        """Transcribe an audio file to text using Volcengine ASR.

        Uses the file upload submit+query pattern for large audio files.
        """
        if not self.access_key:
            raise ValueError("Volcengine ASR access key not configured")

        file_size = os.path.getsize(file_path)
        logger.info("Transcribing audio file: %s (%d bytes)", file_path, file_size)

        with open(file_path, "rb") as f:
            audio_data = f.read()

        async with httpx.AsyncClient(timeout=300.0) as client:
            # Submit transcription task
            submit_url = "https://openspeech.bytedance.com/api/v2/auc/submit"

            submit_payload = {
                "appid": self.app_id,
                "language": language,
                "use_itn": "True",
                "use_capitalize": "True",
                "max_lines": "1",
                "words_per_line": "30",
            }

            files_data = {
                "file": (
                    os.path.basename(file_path),
                    audio_data,
                    _detect_mime_type(file_path),
                ),
            }

            resp = await client.post(
                submit_url,
                data=submit_payload,
                files=files_data,
                headers={"Authorization": f"Bearer {self.access_key}"},
            )

            if resp.status_code != 200:
                logger.error("ASR submit failed: %s %s", resp.status_code, resp.text)
                raise Exception(f"ASR submit failed: {resp.status_code}")

            result = resp.json()
            task_id = result.get("id") or result.get("task_id")

            if not task_id:
                # Maybe the response contains the result directly
                text = result.get("text") or result.get("result", {}).get("text", "")
                if text:
                    return text
                raise Exception(f"No task_id in ASR response: {result}")

            # Poll for result
            query_url = (
                f"https://openspeech.bytedance.com/api/v2/auc/query"
                f"?appid={self.app_id}&id={task_id}"
            )

            for _ in range(120):  # Max ~10 minutes
                await asyncio.sleep(5)

                query_resp = await client.get(
                    query_url,
                    headers={"Authorization": f"Bearer {self.access_key}"},
                )

                if query_resp.status_code != 200:
                    continue

                query_result = query_resp.json()
                status = query_result.get("status") or query_result.get("code", -1)

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
