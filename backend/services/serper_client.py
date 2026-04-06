"""Serper.dev web search client for Just Chat internet search."""

import logging

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)

SERPER_URL = "https://google.serper.dev/search"
TIMEOUT = httpx.Timeout(15.0, connect=5.0)


async def web_search(query: str, num_results: int = 5) -> str:
    """Search the web via Serper.dev and return formatted results as context string.

    Returns empty string if search fails or no API key configured.
    """
    if not settings.SERPER_API_KEY:
        return ""

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(
                SERPER_URL,
                headers={
                    "X-API-KEY": settings.SERPER_API_KEY,
                    "Content-Type": "application/json",
                },
                json={"q": query, "num": num_results},
            )
            resp.raise_for_status()
            data = resp.json()

        results = []

        # Knowledge Graph
        kg = data.get("knowledgeGraph")
        if kg:
            title = kg.get("title", "")
            desc = kg.get("description", "")
            if title or desc:
                results.append(f"**{title}**: {desc}")

        # Organic results
        for item in data.get("organic", [])[:num_results]:
            title = item.get("title", "")
            snippet = item.get("snippet", "")
            link = item.get("link", "")
            if snippet:
                results.append(f"- {title}: {snippet} ({link})")

        if not results:
            return ""

        return "Web search results:\n" + "\n".join(results)

    except Exception as e:
        logger.warning("Serper search failed: %s", e)
        return ""
