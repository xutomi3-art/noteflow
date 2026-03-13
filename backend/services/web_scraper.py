import logging
import re
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


async def scrape_url(url: str) -> tuple[str, str]:
    """Scrape a URL and return (title, markdown_content).

    Extracts the main text content from a webpage, strips scripts/styles,
    and converts to readable markdown format.
    """
    parsed = urlparse(url)
    if not parsed.scheme:
        url = "https://" + url

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
