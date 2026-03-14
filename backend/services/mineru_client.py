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
        """Parse a document using MinerU. Returns markdown content or None.

        Retries up to 3 times with backoff to handle MinerU cold start (model init ~70s).
        """
        import asyncio

        with open(file_path, "rb") as f:
            file_content = f.read()

        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                    resp = await client.post(
                        f"{self.base_url}/file_parse",
                        files={
                            "files": (filename, file_content, "application/octet-stream")
                        },
                        data={
                            "backend": "pipeline",  # CPU mode
                            "return_md": "true",
                            "parse_method": "auto",
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    # MinerU /file_parse returns results list
                    results = data.get("results", [])
                    if results and len(results) > 0:
                        md = results[0].get("md", "") or results[0].get("markdown", "")
                        if md:
                            return md
                    # Fallback: try legacy fields
                    return data.get("markdown", data.get("content", "")) or None
            except Exception as e:
                logger.warning("MinerU parse attempt %d/%d failed: %s", attempt + 1, max_retries, e)
                if attempt < max_retries - 1:
                    wait = 30 * (attempt + 1)  # 30s, 60s backoff for cold start
                    logger.info("Retrying MinerU in %ds (model may be initializing)...", wait)
                    await asyncio.sleep(wait)
                else:
                    logger.error("MinerU parse failed after %d attempts: %s", max_retries, e)
                    return None

    async def is_available(self) -> bool:
        """Check if MinerU service is available."""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                resp = await client.get(f"{self.base_url}/docs")
                return resp.status_code == 200
        except Exception:
            return False


mineru_client = MinerUClient()
