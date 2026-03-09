import asyncio
import json
from collections import defaultdict
from typing import AsyncGenerator


class EventBus:
    """SSE event bus for pushing status updates to connected clients."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue[dict]]] = defaultdict(list)

    def subscribe(self, notebook_id: str) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue()
        self._subscribers[notebook_id].append(queue)
        return queue

    def unsubscribe(self, notebook_id: str, queue: asyncio.Queue[dict]) -> None:
        if notebook_id in self._subscribers:
            self._subscribers[notebook_id] = [
                q for q in self._subscribers[notebook_id] if q is not queue
            ]
            if not self._subscribers[notebook_id]:
                del self._subscribers[notebook_id]

    async def publish(self, notebook_id: str, event: dict) -> None:
        for queue in self._subscribers.get(notebook_id, []):
            await queue.put(event)

    async def stream(self, notebook_id: str) -> AsyncGenerator[str, None]:
        queue = self.subscribe(notebook_id)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self.unsubscribe(notebook_id, queue)


event_bus = EventBus()
