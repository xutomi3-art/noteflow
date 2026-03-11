import logging

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(300.0, connect=10.0)  # Long timeout for generation


class PresentonClient:
    def __init__(self) -> None:
        self.base_url = settings.PRESENTON_BASE_URL.rstrip("/")

    async def upload_files(self, file_paths: list[tuple[str, bytes, str]]) -> list[str]:
        """Upload files to Presenton. Each tuple is (filename, content_bytes, content_type).
        Returns list of Presenton-internal file paths."""
        try:
            files = [("files", (name, data, ct)) for name, data, ct in file_paths]
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(f"{self.base_url}/api/v1/ppt/files/upload", files=files)
                resp.raise_for_status()
                data = resp.json()
                return data.get("files", [])
        except Exception as e:
            logger.error("Presenton file upload failed: %s", e)
            return []

    async def generate_presentation(
        self,
        content: str,
        n_slides: int = 8,
        language: str = "English",
        template: str = "general",
        tone: str = "default",
        verbosity: str = "standard",
        uploaded_files: list[str] | None = None,
        export_as: str = "pptx",
    ) -> bytes | None:
        """Generate a presentation and return the file bytes."""
        try:
            body = {
                "content": content,
                "n_slides": n_slides,
                "language": language,
                "template": template,
                "tone": tone,
                "verbosity": verbosity,
                "export_as": export_as,
            }
            if uploaded_files:
                body["files"] = uploaded_files

            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v1/ppt/presentation/generate",
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()

                # Download the generated file
                file_path = data.get("path", "")
                if not file_path:
                    logger.error("Presenton returned no file path")
                    return None

                download_url = f"{self.base_url}{file_path}"
                file_resp = await client.get(download_url)
                file_resp.raise_for_status()
                return file_resp.content
        except Exception as e:
            logger.error("Presenton generation failed: %s", e)
            return None

    async def is_available(self) -> bool:
        """Check if Presenton service is available."""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                resp = await client.get(f"{self.base_url}/")
                return resp.status_code < 500
        except Exception:
            return False


presenton_client = PresentonClient()
