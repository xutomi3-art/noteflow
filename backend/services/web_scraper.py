import logging
import re
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

JINA_READER_BASE = "https://r.jina.ai/"


async def scrape_url(url: str, remove_selector: str = "") -> tuple[str, str]:
    """Scrape a URL and return (title, markdown_content).

    Uses Jina Reader API for clean markdown extraction.
    Falls back to BeautifulSoup if Jina Reader fails.
    """
    parsed = urlparse(url)
    if not parsed.scheme:
        url = "https://" + url

    # Try Jina Reader first
    try:
        title, content = await _scrape_with_jina(url, remove_selector)
        if content.strip():
            logger.info("Jina Reader succeeded for %s", url)
            return title, content
        logger.warning("Jina Reader returned empty content for %s, falling back", url)
    except Exception as e:
        logger.warning("Jina Reader failed for %s: %s, falling back to BeautifulSoup", url, e)

    # Fallback: BeautifulSoup
    return await _scrape_with_beautifulsoup(url)


async def _scrape_with_jina(url: str, remove_selector: str = "") -> tuple[str, str]:
    """Scrape using Jina Reader API."""
    headers: dict[str, str] = {
        "Accept": "application/json",
    }
    if remove_selector.strip():
        headers["x-remove-selector"] = remove_selector.strip()

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        response = await client.get(f"{JINA_READER_BASE}{url}", headers=headers)
        response.raise_for_status()

    data = response.json()
    jina_data = data.get("data", {})
    title = jina_data.get("title", urlparse(url).netloc) or urlparse(url).netloc
    content = jina_data.get("content", "")

    # Add source URL header
    content = f"# {title}\n\nSource: {url}\n\n---\n\n{content}"

    return title, content


async def _scrape_with_beautifulsoup(url: str) -> tuple[str, str]:
    """Fallback scraper using BeautifulSoup."""
    parsed = urlparse(url)

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
    ) as client:
        response = await client.get(url)
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    # Remove scripts, styles, nav, footer, etc.
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "iframe", "noscript"]):
        tag.decompose()

    # Get title
    title = soup.title.string.strip() if soup.title and soup.title.string else parsed.netloc

    # Try to find main content area
    main = soup.find("main") or soup.find("article") or soup.find(attrs={"role": "main"})
    if main is None:
        main = soup.body if soup.body else soup

    # Convert to markdown-like text
    lines: list[str] = []
    for element in main.find_all(["h1", "h2", "h3", "h4", "p", "li", "pre", "blockquote", "td", "th"]):
        text = element.get_text(strip=True)
        if not text:
            continue

        tag = element.name
        if tag == "h1":
            lines.append(f"# {text}\n")
        elif tag == "h2":
            lines.append(f"## {text}\n")
        elif tag == "h3":
            lines.append(f"### {text}\n")
        elif tag == "h4":
            lines.append(f"#### {text}\n")
        elif tag == "li":
            lines.append(f"- {text}")
        elif tag == "pre":
            lines.append(f"```\n{text}\n```\n")
        elif tag == "blockquote":
            lines.append(f"> {text}\n")
        else:
            lines.append(f"{text}\n")

    content = "\n".join(lines)

    # Clean up excessive whitespace
    content = re.sub(r"\n{3,}", "\n\n", content)

    if not content.strip():
        # Fallback: just get all text
        content = main.get_text(separator="\n", strip=True)

    # Add source URL header
    content = f"# {title}\n\nSource: {url}\n\n---\n\n{content}"

    return title, content
