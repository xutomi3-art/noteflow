import httpx
import logging

logger = logging.getLogger(__name__)

TTS_ENDPOINT = "https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts"


async def text_to_speech(text: str, voice: str, appkey: str, token: str) -> bytes:
    """Call Alibaba Cloud NLS TTS and return MP3 bytes."""
    params = {
        "appkey": appkey,
        "token": token,
        "text": text,
        "format": "mp3",
        "voice": voice,
        "sample_rate": 16000,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(TTS_ENDPOINT, params=params)
        if response.status_code != 200:
            raise RuntimeError(
                f"TTS request failed: status={response.status_code}, body={response.text[:200]}"
            )
        return response.content
