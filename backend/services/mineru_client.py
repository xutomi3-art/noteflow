import logging

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(300.0, connect=10.0)  # Long timeout for parsing


class MinerUClient:
    """HTTP client for MinerU document parsing service."""

    def __init__(self) -> None:
        self.base_url = settings.MINERU_BASE_URL.rstrip("/")

    async def parse_document(self, file_path: str, filename: str) -> str | None:
        """Parse a document using MinerU. Returns markdown content or None."""
        try:
            with open(file_path, "rb") as f:
                file_content = f.read()

            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(
                    f"{self.base_url}/predict",
                    files={
                        "file": (filename, file_content, "application/octet-stream")
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                # MinerU returns markdown content
                return data.get("markdown", data.get("content", ""))
        except Exception as e:
            logger.error("MinerU parse failed: %s", e)
            return None

    async def is_available(self) -> bool:
        """Check if MinerU service is available."""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                resp = await client.get(f"{self.base_url}/health")
                return resp.status_code == 200
        except Exception:
            return False


mineru_client = MinerUClient()
