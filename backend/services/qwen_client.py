import base64
import logging
from typing import AsyncGenerator

from openai import AsyncOpenAI

from backend.core.config import settings

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "bmp"}


class QwenClient:
    """Client for Qwen LLM via DashScope OpenAI-compatible API.

    Uses Qwen3.5-Plus for chat/generation/vision (unified model).
    Uses text-embedding-v3 for embedding.
    """

    def __init__(self) -> None:
        self.client = AsyncOpenAI(
            api_key=settings.QWEN_API_KEY,
            base_url=settings.LLM_BASE_URL,
            timeout=180.0,  # 3 min timeout for large context (1M)
        )
        self.model = settings.LLM_MODEL

    async def stream_chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int | None = None,
        enable_search: bool = False,
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion tokens."""
        try:
            kwargs: dict = dict(
                model=self.model,
                messages=messages,  # type: ignore[arg-type]
                max_tokens=max_tokens or settings.LLM_MAX_OUTPUT_TOKENS,
                temperature=temperature,
                stream=True,
            )
            if enable_search:
                kwargs["extra_body"] = {
                    "enable_search": True,
                    "search_options": {"search_strategy": "agent"},
                }
            response = await self.client.chat.completions.create(**kwargs)
            async for chunk in response:
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        yield delta.content
        except Exception as e:
            error_str = str(e)
            logger.error("LLM stream_chat failed: %s", e)
            if "data_inspection_failed" in error_str.lower() or "DataInspectionFailed" in error_str:
                yield f"\n\n[Error: 内容安全审核误拦截，请尝试换个方式提问或减少勾选的文档。The AI content filter flagged this request — try rephrasing or selecting fewer sources.]"
            else:
                yield f"\n\n[Error: AI generation failed - {e}]"

    async def generate(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        """Non-streaming chat completion."""
        try:
            response = await self.client.chat.completions.create(
                model=model or self.model,
                messages=messages,  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error("LLM generate failed: %s", e)
            return f"[Error: AI generation failed - {e}]"

    async def analyze_image(self, image_path: str, filename: str) -> str:
        """Use Qwen3.5-Plus to extract text description from an image."""
        try:
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")

            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
            mime_map = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp", "gif": "gif", "bmp": "bmp"}
            mime_type = f"image/{mime_map.get(ext, 'png')}"

            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{image_data}"},
                        },
                        {
                            "type": "text",
                            "text": (
                                "Please analyze this image thoroughly. Extract ALL text content visible in the image. "
                                "Then describe any diagrams, charts, tables, photos, or visual elements in detail. "
                                "If this is a document scan or screenshot, reproduce the text as accurately as possible. "
                                "If this is a photo, describe what is shown in detail. "
                                "Output in the same language as the text in the image (if any). "
                                "If no text is found, describe the image content in Chinese."
                            ),
                        },
                    ],
                }
            ]

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,  # type: ignore[arg-type]
                max_tokens=4096,
            )
            content = response.choices[0].message.content or ""
            logger.info("Vision analyzed image %s: %d chars", filename, len(content))
            return content
        except Exception as e:
            logger.error("Vision image analysis failed for %s: %s", filename, e)
            return f"[Image: {filename} — analysis failed: {e}]"


qwen_client = QwenClient()
