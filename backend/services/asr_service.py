import asyncio
import logging
import os
import uuid

import httpx

logger = logging.getLogger(__name__)

AUDIO_EXTENSIONS = {"mp3", "wav", "m4a", "flac", "ogg", "webm"}

# Volcengine Seed-ASR 2.0 (v3 bigmodel) API endpoints
SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit"
QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query"


class ASRService:
    """Volcengine (火山引擎) Seed-ASR 2.0 service for audio transcription.

    Uses v3 bigmodel API with X-Api-App-Key / X-Api-Access-Key auth.
    Audio must be provided via a publicly accessible URL.
    """

    def __init__(self) -> None:
        self.app_id = ""
        self.access_token = ""
        self.public_base_url = ""  # e.g. "http://47.116.199.160"

    def configure(self, app_id: str, access_token: str,
                  public_base_url: str = "") -> None:
        self.app_id = app_id
        self.access_token = access_token
        self.public_base_url = public_base_url.rstrip("/")

    def _headers(self, request_id: str) -> dict[str, str]:
        """Build v3 API authentication headers."""
        return {
            "X-Api-App-Key": self.app_id,
            "X-Api-Access-Key": self.access_token,
            "X-Api-Resource-Id": "volc.bigasr.auc",
            "X-Api-Request-Id": request_id,
            "X-Api-Sequence": "-1",
            "Content-Type": "application/json",
        }

    async def transcribe_file(self, file_path: str, language: str = "zh-CN",
                              audio_url: str | None = None) -> str:
        """Transcribe an audio file to text using Seed-ASR 2.0.

        Args:
            file_path: Local path to the audio file.
            language: Language code (default: zh-CN).
            audio_url: Public URL to the audio file. If not provided,
                       constructs one from public_base_url + file path.
        """
        if not self.access_token:
            raise ValueError("Volcengine ASR access token not configured")

        file_size = os.path.getsize(file_path)
        audio_format = _detect_audio_format(file_path)
        request_id = str(uuid.uuid4())

        # Build audio URL if not provided
        if not audio_url:
            # Extract source_id from file path: /app/uploads/{nb_id}/{src_id}.ext
            basename = os.path.basename(file_path)
            src_id = os.path.splitext(basename)[0]
            # Find notebook_id from path
            parent = os.path.basename(os.path.dirname(file_path))
            if self.public_base_url:
                audio_url = f"{self.public_base_url}/api/asr/audio/{parent}/{src_id}{os.path.splitext(basename)[1]}"
            else:
                raise ValueError("No audio URL or public_base_url configured for ASR")

        logger.info("Transcribing (Seed-ASR 2.0): %s (%d bytes, format=%s, url=%s)",
                     file_path, file_size, audio_format, audio_url)

        submit_body = {
            "user": {
                "uid": "noteflow-backend",
            },
            "audio": {
                "format": audio_format,
                "url": audio_url,
                "language": language,
            },
            "request": {
                "model_name": "bigmodel",
                "enable_itn": True,
                "enable_punc": True,
                "show_utterances": True,
            },
        }

        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                SUBMIT_URL,
                json=submit_body,
                headers=self._headers(request_id),
            )

            # Check status from response headers
            status_code = resp.headers.get("X-Api-Status-Code", "")
            status_msg = resp.headers.get("X-Api-Message", "")
            logger.info("ASR submit: HTTP %s, X-Api-Status-Code=%s, msg=%s, body=%s",
                        resp.status_code, status_code, status_msg, resp.text[:300])

            if resp.status_code != 200:
                raise Exception(f"ASR submit failed: HTTP {resp.status_code} {resp.text[:200]}")

            if status_code and status_code != "20000000":
                raise Exception(f"ASR submit error: code={status_code} msg={status_msg}")

            # Submit success — now poll for result using same request_id
            for attempt in range(120):  # Max ~10 minutes
                await asyncio.sleep(5)

                query_headers = self._headers(request_id)
                query_resp = await client.post(
                    QUERY_URL,
                    json={},
                    headers=query_headers,
                )

                q_status = query_resp.headers.get("X-Api-Status-Code", "")
                q_msg = query_resp.headers.get("X-Api-Message", "")
                logger.info("ASR query attempt %d: HTTP %s, status=%s, msg=%s",
                            attempt + 1, query_resp.status_code, q_status, q_msg)

                if query_resp.status_code != 200:
                    continue

                if q_status == "20000000":
                    # Success — parse result
                    result = query_resp.json()
                    r = result.get("result", {})
                    utterances = r.get("utterances", [])
                    if utterances:
                        text_parts = [u.get("text", "") for u in utterances]
                        return "\n".join(text_parts)
                    return r.get("text", "")

                if q_status == "20000001":
                    # Still processing
                    continue

                if q_status == "20000003":
                    # Silent audio
                    return ""

                if q_status and q_status.startswith("4") or q_status.startswith("5"):
                    raise Exception(f"ASR failed: code={q_status} msg={q_msg}")

            raise Exception("ASR transcription timed out")


def _detect_audio_format(file_path: str) -> str:
    """Detect audio format from file extension."""
    ext = os.path.splitext(file_path)[1].lower()
    format_map = {
        ".wav": "wav", ".mp3": "mp3", ".m4a": "m4a", ".flac": "flac",
        ".ogg": "ogg", ".wma": "wma", ".aac": "aac", ".amr": "amr",
        ".opus": "opus", ".webm": "webm",
    }
    return format_map.get(ext, "wav")


def _detect_mime_type(file_path: str) -> str:
    """Detect MIME type from file extension."""
    ext = os.path.splitext(file_path)[1].lower()
    mime_map = {
        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
        ".flac": "audio/flac", ".ogg": "audio/ogg", ".webm": "audio/webm",
        ".aac": "audio/aac", ".amr": "audio/amr",
    }
    return mime_map.get(ext, "audio/wav")


asr_service = ASRService()
