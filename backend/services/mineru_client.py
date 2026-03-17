import logging
import os

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(300.0, connect=10.0)  # Long timeout for parsing


class MinerUClient:
    """HTTP client for MinerU document parsing service (Gradio API)."""

    def __init__(self) -> None:
        self.base_url = settings.MINERU_BASE_URL.rstrip("/")

    async def parse_document(self, file_path: str, filename: str) -> str | None:
        """Parse a document using MinerU Gradio API. Returns markdown content or None."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                # Step 1: Upload file to Gradio
                with open(file_path, "rb") as f:
                    upload_resp = await client.post(
                        f"{self.base_url}/gradio_api/upload",
                        files={"files": (filename, f)},
                    )
                    upload_resp.raise_for_status()
                    uploaded_files = upload_resp.json()
                    if not uploaded_files:
                        logger.error("MinerU upload returned empty response")
                        return None
                    server_path = uploaded_files[0]  # server-side file path

                # Step 2: Call /to_markdown endpoint
                call_resp = await client.post(
                    f"{self.base_url}/gradio_api/call/to_markdown",
                    json={
                        "data": [
                            {"path": server_path, "orig_name": filename, "meta": {"_type": "gradio.FileData"}},
                            1000,       # max_pages
                            False,      # force_ocr
                            True,       # formula_enable
                            True,       # table_enable
                            "ch (Chinese, English, Chinese Traditional)",  # language
                            "pipeline",  # backend (CPU mode)
                            "",          # server_url (not used for pipeline)
                        ],
                    },
                )
                call_resp.raise_for_status()
                event_id = call_resp.json().get("event_id")
                if not event_id:
                    logger.error("MinerU call returned no event_id")
                    return None

                # Step 3: Poll for result (SSE stream)
                result_resp = await client.get(
                    f"{self.base_url}/gradio_api/call/to_markdown/{event_id}",
                    timeout=TIMEOUT,
                )
                result_resp.raise_for_status()

                # Parse SSE response — look for "data:" lines
                markdown = None
                for line in result_resp.text.split("\n"):
                    if line.startswith("data: "):
                        import json
                        try:
                            data = json.loads(line[6:])
                            if isinstance(data, list) and len(data) >= 2:
                                # data[0] = rendered markdown, data[1] = raw markdown text
                                markdown = data[1] if data[1] else data[0]
                        except (json.JSONDecodeError, IndexError):
                            pass

                if markdown:
                    logger.info("MinerU parsed %s: %d chars", filename, len(markdown))
                    return markdown

                logger.warning("MinerU returned no markdown for %s", filename)
                return None

        except Exception as e:
            logger.error("MinerU parse failed for %s: %s", filename, e)
            return None

    async def is_available(self) -> bool:
        """Check if MinerU service is available."""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                resp = await client.get(f"{self.base_url}/gradio_api/info")
                return resp.status_code == 200
        except Exception:
            return False


mineru_client = MinerUClient()
