"""Docmee (文多多) AiPPT API client for PPT generation."""

import logging
from typing import Any

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)

BASE_URL = "https://docmee.cn"
TIMEOUT = httpx.Timeout(120.0, connect=10.0)


class DocmeeClient:
    def __init__(self) -> None:
        self.api_key = settings.DOCMEE_API_KEY

    async def _create_token(self) -> str | None:
        """Create a short-lived API token from the Api-Key."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(
                    f"{BASE_URL}/api/user/createApiToken",
                    headers={"Api-Key": self.api_key},
                    json={"uid": "noteflow", "limit": 1, "timeOfHours": 2},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    logger.error("Docmee createApiToken failed: %s", data.get("message"))
                    return None
                return data["data"]["token"]
        except Exception as e:
            logger.error("Docmee createApiToken error: %s", e)
            return None

    async def get_template_options(self) -> dict[str, Any]:
        """Get template filter options (categories, colors, styles)."""
        token = await self._create_token()
        if not token:
            return {}
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(
                    f"{BASE_URL}/api/ppt/template/options",
                    headers={"token": token},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    return {}
                return data.get("data", {})
        except Exception as e:
            logger.error("Docmee get_template_options error: %s", e)
            return {}

    async def list_templates(
        self,
        page: int = 1,
        size: int = 20,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """List available templates with pagination."""
        token = await self._create_token()
        if not token:
            return {"records": [], "total": 0}
        try:
            body: dict[str, Any] = {"page": {"current": page, "size": size}}
            if filters:
                body.update(filters)
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(
                    f"{BASE_URL}/api/ppt/templates",
                    headers={"token": token},
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    return {"records": [], "total": 0}
                page_data = data.get("data", {})
                records = page_data.get("records", [])
                # Add token to coverUrl for image auth
                for r in records:
                    cover = r.get("coverUrl", "")
                    if cover and "?" not in cover:
                        r["coverUrl"] = f"{cover}?token={token}"
                    elif cover:
                        r["coverUrl"] = f"{cover}&token={token}"
                return {
                    "records": records,
                    "total": page_data.get("total", 0),
                    "pages": page_data.get("pages", 0),
                }
        except Exception as e:
            logger.error("Docmee list_templates error: %s", e)
            return {"records": [], "total": 0}

    async def get_generation_options(self) -> dict[str, Any]:
        """Get available generation options (scene, audience, language)."""
        token = await self._create_token()
        if not token:
            return {}
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(
                    f"{BASE_URL}/api/ppt/v2/options",
                    headers={"token": token},
                    params={"lang": "zh"},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    return {}
                return data.get("data", {})
        except Exception as e:
            logger.error("Docmee get_generation_options error: %s", e)
            return {}

    async def generate_ppt(
        self,
        content: str,
        template_id: str,
        scene: str = "",
        audience: str = "",
        lang: str = "zh",
        length: str = "medium",
    ) -> dict[str, Any] | None:
        """Full flow: createTask → generateContent → generatePptx.

        Returns pptInfo dict with id, subject, coverUrl, etc. or None on failure.
        """
        token = await self._create_token()
        if not token:
            return None

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
                # Step 1: Create task (type=1: smart generation from theme/requirements)
                resp = await client.post(
                    f"{BASE_URL}/api/ppt/v2/createTask",
                    headers={"token": token, "Content-Type": "application/x-www-form-urlencoded"},
                    data={"type": "1", "content": content[:1000]},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    logger.error("Docmee createTask failed: %s", data.get("message"))
                    return None
                task_id = data["data"]["id"]
                logger.info("Docmee task created: %s", task_id)

                # Step 2: Generate content/outline (non-streaming)
                gen_body: dict[str, Any] = {
                    "id": task_id,
                    "stream": False,
                    "length": length,
                    "lang": lang,
                }
                if scene:
                    gen_body["scene"] = scene
                if audience:
                    gen_body["audience"] = audience

                resp = await client.post(
                    f"{BASE_URL}/api/ppt/v2/generateContent",
                    headers={"token": token},
                    json=gen_body,
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    logger.error("Docmee generateContent failed: %s", data.get("message"))
                    return None
                markdown = data["data"]["markdown"]
                logger.info("Docmee content generated, markdown length: %d", len(markdown))

                # Step 3: Generate PPT from outline + template
                resp = await client.post(
                    f"{BASE_URL}/api/ppt/v2/generatePptx",
                    headers={"token": token},
                    json={
                        "id": task_id,
                        "templateId": template_id,
                        "markdown": markdown,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    logger.error("Docmee generatePptx failed: %s", data.get("message"))
                    return None
                ppt_info = data["data"]["pptInfo"]
                logger.info("Docmee PPT generated: %s", ppt_info.get("id"))
                return ppt_info

        except Exception as e:
            logger.error("Docmee generate_ppt error: %s", e)
            return None

    async def download_pptx(self, ppt_id: str) -> bytes | None:
        """Download the generated PPTX file."""
        token = await self._create_token()
        if not token:
            return None
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(
                    f"{BASE_URL}/api/ppt/downloadPptx",
                    headers={"token": token},
                    json={"id": ppt_id},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") != 0:
                    logger.error("Docmee downloadPptx failed: %s", data.get("message"))
                    return None
                file_url = data.get("data", {}).get("fileUrl", "")
                if not file_url:
                    logger.error("Docmee downloadPptx returned no fileUrl")
                    return None

                # Download the actual file
                file_resp = await client.get(file_url)
                file_resp.raise_for_status()
                return file_resp.content
        except Exception as e:
            logger.error("Docmee download_pptx error: %s", e)
            return None

    async def is_available(self) -> bool:
        """Check if Docmee API is reachable and API key is valid."""
        if not self.api_key:
            return False
        token = await self._create_token()
        return token is not None


docmee_client = DocmeeClient()
