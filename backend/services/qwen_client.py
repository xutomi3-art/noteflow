import base64
import logging
from typing import AsyncGenerator

from openai import AsyncOpenAI

from backend.core.config import settings

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "bmp"}

# Errors that indicate the primary model server is DOWN (not query-specific).
# These trigger fallback to backup. Content/auth errors do NOT trigger fallback.
_CONNECTIVITY_ERROR_TYPES = (
    ConnectionError, ConnectionRefusedError, OSError, TimeoutError,
)
_CONNECTIVITY_ERROR_KEYWORDS = (
    "connection refused", "connect timeout", "name resolution",
    "service unavailable", "502", "503", "504",
    "unreachable", "connection reset", "eof occurred",
)


def _is_connectivity_error(exc: Exception) -> bool:
    """Return True if the exception indicates the model server is unreachable."""
    if isinstance(exc, _CONNECTIVITY_ERROR_TYPES):
        return True
    msg = str(exc).lower()
    return any(kw in msg for kw in _CONNECTIVITY_ERROR_KEYWORDS)


def _build_extra(model: str, context_window: int, enable_search: bool = False) -> dict:
    """Build extra_body params based on model type."""
    extra: dict = {}
    model_lower = model.lower()
    # Disable built-in thinking for models that support it (Qwen cloud, GLM)
    # Local vLLM and DeepSeek don't support this param
    if "deepseek" not in model_lower and "35b" not in model_lower:
        extra["enable_thinking"] = False
    # Unlock full context window (Qwen cloud defaults to ~129K without this)
    if "qwen" in model_lower and "35b" not in model_lower:
        extra["max_input_tokens"] = context_window
    if enable_search:
        extra["enable_search"] = True
        extra["search_options"] = {"search_strategy": "agent"}
    return extra


class QwenClient:
    """OpenAI-compatible LLM client with automatic backup fallback.

    Primary: local GPU model (fast, no cost).
    Backup: cloud API (Qwen-Plus) — used when primary is unreachable.
    """

    def __init__(self) -> None:
        self.client = AsyncOpenAI(
            api_key=settings.QWEN_API_KEY or "not-needed",
            base_url=settings.LLM_BASE_URL,
            timeout=180.0,
        )
        self.model = settings.LLM_MODEL

        # Backup client — initialized lazily on first fallback
        self._backup_client: AsyncOpenAI | None = None
        self._backup_model: str = settings.LLM_BACKUP_MODEL
        self._init_backup()

    def _init_backup(self) -> None:
        """(Re)initialize backup client from current settings."""
        if settings.LLM_BACKUP_ENABLED and settings.LLM_BACKUP_BASE_URL:
            backup_key = settings.LLM_BACKUP_API_KEY or settings.QWEN_API_KEY
            if backup_key:
                self._backup_client = AsyncOpenAI(
                    api_key=backup_key,
                    base_url=settings.LLM_BACKUP_BASE_URL,
                    timeout=180.0,
                )
                self._backup_model = settings.LLM_BACKUP_MODEL
                logger.info("Backup LLM configured: model=%s, base_url=%s",
                            self._backup_model, settings.LLM_BACKUP_BASE_URL)
            else:
                self._backup_client = None
                logger.warning("Backup LLM disabled: no API key configured")
        else:
            self._backup_client = None

    async def stream_chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int | None = None,
        enable_search: bool = False,
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion tokens. Falls back to backup on connectivity errors."""
        import asyncio as _asyncio

        # Try primary first
        primary_failed = False
        try:
            async for token in self._stream_chat_with_client(
                self.client, self.model, settings.LLM_CONTEXT_WINDOW,
                messages, temperature, max_tokens, enable_search,
            ):
                yield token
            return  # success
        except Exception as e:
            if _is_connectivity_error(e) and self._backup_client:
                logger.warning("Primary LLM unreachable (%s), falling back to backup %s",
                               e, self._backup_model)
                primary_failed = True
            else:
                # Not a connectivity error — propagate as normal error token
                error_str = str(e)
                if "data_inspection_failed" in error_str.lower() or "DataInspectionFailed" in error_str:
                    yield "\n\n[Error: 内容安全审核误拦截，请尝试换个方式提问或减少勾选的文档。The AI content filter flagged this request — try rephrasing or selecting fewer sources.]"
                else:
                    yield f"\n\n[Error: AI generation failed - {e}]"
                return

        # Fallback to backup
        if primary_failed:
            try:
                async for token in self._stream_chat_with_client(
                    self._backup_client, self._backup_model,
                    settings.LLM_BACKUP_CONTEXT_WINDOW,
                    messages, temperature, max_tokens, enable_search,
                ):
                    yield token
                return
            except Exception as e2:
                logger.error("Backup LLM also failed: %s", e2)
                yield f"\n\n[Error: Both primary and backup AI models failed. Primary: unreachable. Backup: {e2}]"
                return

    async def _stream_chat_with_client(
        self,
        client: AsyncOpenAI,
        model: str,
        context_window: int,
        messages: list[dict],
        temperature: float,
        max_tokens: int | None,
        enable_search: bool,
    ) -> AsyncGenerator[str, None]:
        """Stream from a specific client. Raises on failure (no error tokens)."""
        import asyncio as _asyncio

        max_retries = 3
        for attempt in range(max_retries):
            try:
                extra = _build_extra(model, context_window, enable_search)
                kwargs: dict = dict(
                    model=model,
                    messages=messages,  # type: ignore[arg-type]
                    max_tokens=max_tokens or settings.LLM_MAX_OUTPUT_TOKENS,
                    temperature=temperature,
                    stream=True,
                )
                if extra:
                    kwargs["extra_body"] = extra
                response = await client.chat.completions.create(**kwargs)
                first_token_timeout = 120  # seconds
                got_first_token = False
                try:
                    it = response.__aiter__()
                    while True:
                        timeout = None if got_first_token else first_token_timeout
                        try:
                            chunk = await _asyncio.wait_for(it.__anext__(), timeout=timeout)
                        except StopAsyncIteration:
                            break
                        except _asyncio.TimeoutError:
                            logger.warning("LLM first token timeout (%ds) on %s, attempt %d/%d",
                                           first_token_timeout, model, attempt + 1, max_retries)
                            raise
                        if chunk.choices:
                            delta = chunk.choices[0].delta
                            if delta.content:
                                got_first_token = True
                                yield delta.content
                finally:
                    await response.close()
                return
            except _asyncio.TimeoutError:
                if attempt < max_retries - 1:
                    logger.warning("Retrying after first-token timeout on %s (attempt %d/%d)",
                                   model, attempt + 1, max_retries)
                    continue
                raise  # let caller handle
            except Exception as e:
                error_str = str(e)
                if "429" in error_str and attempt < max_retries - 1:
                    wait = 3 * (attempt + 1)
                    logger.warning("LLM rate limited (429) on %s, retrying in %ds (attempt %d/%d)",
                                   model, wait, attempt + 1, max_retries)
                    await _asyncio.sleep(wait)
                    continue
                raise  # let caller handle

    async def generate(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        """Non-streaming chat completion with backup fallback."""
        gen_model = model or self.model

        # Try primary
        try:
            return await self._generate_with_client(
                self.client, gen_model, settings.LLM_CONTEXT_WINDOW,
                messages, temperature, max_tokens,
            )
        except Exception as e:
            if _is_connectivity_error(e) and self._backup_client:
                logger.warning("Primary LLM unreachable for generate (%s), falling back to backup", e)
            else:
                logger.error("LLM generate failed: %s", e)
                return f"[Error: AI generation failed - {e}]"

        # Fallback to backup
        try:
            backup_model = self._backup_model if not model else model
            return await self._generate_with_client(
                self._backup_client, backup_model,
                settings.LLM_BACKUP_CONTEXT_WINDOW,
                messages, temperature, max_tokens,
            )
        except Exception as e2:
            logger.error("Backup LLM generate also failed: %s", e2)
            return f"[Error: Both primary and backup AI models failed - {e2}]"

    async def _generate_with_client(
        self,
        client: AsyncOpenAI,
        model: str,
        context_window: int,
        messages: list[dict],
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Generate with a specific client. Raises on failure."""
        extra = _build_extra(model, context_window)
        kwargs: dict = dict(
            model=model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperature,
            max_tokens=max_tokens,
            stream=False,
        )
        if extra:
            kwargs["extra_body"] = extra
        response = await client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""

    async def analyze_image(self, image_path: str, filename: str) -> str:
        """Use Vision LLM to extract text and chart data from an image."""
        import httpx as _httpx

        try:
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")

            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
            mime_map = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp", "gif": "gif", "bmp": "bmp"}
            mime_type = f"image/{mime_map.get(ext, 'png')}"

            vision_model = settings.LLM_VISION_MODEL or self.model
            prompt = (
                "Please analyze this image thoroughly. Extract ALL text content visible in the image. "
                "Then describe any diagrams, charts, tables, photos, or visual elements in detail. "
                "If this is a document scan or screenshot, reproduce the text as accurately as possible. "
                "If this is a chart or graph, list every label, data point, and value shown. "
                "If this is a photo, describe what is shown in detail. "
                "Output in the same language as the text in the image (if any). "
                "If no text is found, describe the image content in Chinese."
            )

            # Use dedicated vision API config (may differ from main LLM provider)
            vision_base = settings.LLM_VISION_BASE_URL or settings.LLM_BASE_URL
            vision_key = settings.LLM_VISION_API_KEY or settings.QWEN_API_KEY
            async with _httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{vision_base}/chat/completions",
                    headers={"Authorization": f"Bearer {vision_key}"},
                    json={
                        "model": vision_model,
                        "messages": [{
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_data}"}},
                                {"type": "text", "text": prompt},
                            ],
                        }],
                        "max_tokens": 4096,
                    },
                )
                data = resp.json()
                if "choices" in data:
                    content = data["choices"][0]["message"].get("content", "")
                    logger.info("Vision analyzed image %s with %s: %d chars", filename, vision_model, len(content))
                    return content
                else:
                    error_msg = data.get("error", {}).get("message", str(data))
                    logger.error("Vision API error for %s: %s", filename, error_msg)
                    return f"[Image: {filename} — analysis failed: {error_msg}]"
        except Exception as e:
            logger.error("Vision image analysis failed for %s: %s", filename, e)
            return f"[Image: {filename} — analysis failed: {e}]"


qwen_client = QwenClient()
