import base64
import logging
from typing import AsyncGenerator

from openai import AsyncOpenAI

from backend.core.config import settings

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "bmp"}


class QwenClient:
    """Client for LLM via OpenAI-compatible API.

    Uses DeepSeek for chat/generation (stronger reasoning, cheaper).
    Falls back to Qwen for vision (analyze_image) since DeepSeek lacks multimodal.
    """

    def __init__(self) -> None:
        # Primary LLM client (DeepSeek)
        self.client = AsyncOpenAI(
            api_key=settings.LLM_API_KEY or settings.QWEN_API_KEY,
            base_url=settings.LLM_BASE_URL if settings.LLM_API_KEY else "https://dashscope.aliyuncs.com/compatible-mode/v1",
            timeout=120.0,  # 2 min timeout for large context requests
        )
        self.model = settings.LLM_MODEL if settings.LLM_API_KEY else settings.QWEN_MODEL

        # Qwen client (for vision/embedding only)
        self.qwen_client = AsyncOpenAI(
            api_key=settings.QWEN_API_KEY,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )

    async def stream_chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
        thinking: bool = False,
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion tokens."""
        try:
            # When thinking mode is enabled, use deepseek-reasoner
            model = self.model
            kwargs: dict = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "stream": True,
            }
            if thinking:
                kwargs["model"] = settings.LLM_THINKING_MODEL
                # R1 doesn't support temperature
            else:
                kwargs["temperature"] = temperature

            response = await self.client.chat.completions.create(**kwargs)  # type: ignore[arg-type]
            async for chunk in response:
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    # Yield reasoning_content from R1 with prefix so caller can distinguish
                    reasoning = getattr(delta, "reasoning_content", None)
                    if reasoning:
                        yield f"__REASONING__:{reasoning}"
                    if delta.content:
                        yield delta.content
        except Exception as e:
            logger.error("LLM stream_chat failed: %s", e)
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
        """Use Qwen-VL to extract text description from an image."""
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

            response = await self.qwen_client.chat.completions.create(
                model="qwen-vl-plus",
                messages=messages,  # type: ignore[arg-type]
                max_tokens=4096,
            )
            content = response.choices[0].message.content or ""
            logger.info("Qwen-VL analyzed image %s: %d chars", filename, len(content))
            return content
        except Exception as e:
            logger.error("Qwen-VL image analysis failed for %s: %s", filename, e)
            return f"[Image: {filename} — analysis failed: {e}]"


qwen_client = QwenClient()
