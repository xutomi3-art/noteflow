import logging
from typing import AsyncGenerator

from openai import AsyncOpenAI

from backend.core.config import settings

logger = logging.getLogger(__name__)


class QwenClient:
    """Client for Qwen LLM via OpenAI-compatible API."""

    def __init__(self) -> None:
        self.client = AsyncOpenAI(
            api_key=settings.QWEN_API_KEY,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        self.model = settings.QWEN_MODEL

    async def stream_chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion tokens."""
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
            async for chunk in response:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            logger.error("Qwen stream_chat failed: %s", e)
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
            logger.error("Qwen generate failed: %s", e)
            return f"[Error: AI generation failed - {e}]"


qwen_client = QwenClient()
