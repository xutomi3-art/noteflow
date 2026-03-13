"""Public endpoint for serving audio files to Volcengine ASR API.

The Seed-ASR 2.0 API requires a publicly accessible URL to download the audio.
This endpoint serves uploaded audio files without authentication so the ASR
service can fetch them. Security is provided by using the source UUID as the
path — it's unguessable.
"""

import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.core.config import settings

router = APIRouter(prefix="/asr", tags=["asr"])


@router.get("/audio/{notebook_id}/{filename}")
async def serve_audio_for_asr(notebook_id: str, filename: str):
    """Serve an audio file for ASR transcription. No auth required."""
    file_path = os.path.join(settings.UPLOAD_DIR, notebook_id, filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    ext = os.path.splitext(filename)[1].lower()
    mime_map = {
        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
        ".flac": "audio/flac", ".ogg": "audio/ogg", ".webm": "audio/webm",
        ".aac": "audio/aac", ".amr": "audio/amr",
    }
    media_type = mime_map.get(ext, "application/octet-stream")

    return FileResponse(file_path, media_type=media_type)
