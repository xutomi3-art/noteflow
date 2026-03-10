import logging

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(60.0, connect=10.0)


class RAGFlowClient:
    """HTTP client for RAGFlow API."""

    def __init__(self) -> None:
        self.base_url = settings.RAGFLOW_BASE_URL.rstrip("/")
        self.api_key = settings.RAGFLOW_API_KEY

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def create_dataset(self, name: str) -> str | None:
        """Create a dataset in RAGFlow. Returns dataset_id or None on failure."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v1/datasets",
                    headers=self._headers,
                    json={"name": name, "chunk_method": "naive"},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0:
                    return data["data"]["id"]
                logger.error("RAGFlow create_dataset error: %s", data)
                return None
        except Exception as e:
            logger.error("RAGFlow create_dataset failed: %s", e)
            return None

    async def upload_document(
        self, dataset_id: str, filename: str, content: bytes
    ) -> str | None:
        """Upload a document to a RAGFlow dataset. Returns document_id or None."""
        import asyncio
        upload_timeout = httpx.Timeout(120.0, connect=10.0)
        last_error = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=upload_timeout) as client:
                    resp = await client.post(
                        f"{self.base_url}/api/v1/datasets/{dataset_id}/documents",
                        headers=self._headers,
                        files={"file": (filename, content, "application/octet-stream")},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    if data.get("code") == 0 and data.get("data"):
                        return data["data"][0]["id"]
                    logger.error("RAGFlow upload_document error: %s", data)
                    return None
            except Exception as e:
                last_error = e
                logger.warning("RAGFlow upload attempt %d failed: %r", attempt + 1, e)
                if attempt < 2:
                    await asyncio.sleep(2)
        logger.error("RAGFlow upload_document failed after 3 attempts: %r", last_error, exc_info=True)
        return None

    async def parse_document(self, dataset_id: str, document_id: str) -> bool:
        """Trigger parsing (chunking + embedding) for a document."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v1/datasets/{dataset_id}/chunks",
                    headers=self._headers,
                    json={"document_ids": [document_id]},
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("code") == 0
        except Exception as e:
            logger.error("RAGFlow parse_document failed: %s", e)
            return False

    async def get_document_status(
        self, dataset_id: str, document_id: str
    ) -> dict | None:
        """Check parsing status of a document. Returns dict with run, chunk_count, progress."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(
                    f"{self.base_url}/api/v1/datasets/{dataset_id}/documents",
                    headers=self._headers,
                    params={"id": document_id},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0 and data.get("data"):
                    docs = data["data"]
                    # RAGFlow v0.17 wraps docs in {"docs": [...], "total": N}
                    if isinstance(docs, dict) and "docs" in docs:
                        docs = docs["docs"]
                    if isinstance(docs, list):
                        for doc in docs:
                            if doc["id"] == document_id:
                                return {
                                    "run": doc.get("run", "UNSTART"),
                                    "chunk_count": doc.get("chunk_count", 0),
                                    "progress": doc.get("progress", 0),
                                }
                return None
        except Exception as e:
            logger.error("RAGFlow get_document_status failed: %s", e)
            return None

    async def retrieve(
        self, dataset_ids: list[str], question: str, top_k: int = 6
    ) -> list[dict]:
        """Retrieve relevant chunks from RAGFlow datasets."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v1/retrieval",
                    headers=self._headers,
                    json={
                        "question": question,
                        "dataset_ids": dataset_ids,
                        "similarity_threshold": 0.2,
                        "vector_similarity_weight": 0.7,
                        "top_k": top_k,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0:
                    return data.get("data", {}).get("chunks", [])
                logger.error("RAGFlow retrieve error: %s", data)
                return []
        except Exception as e:
            logger.error("RAGFlow retrieve failed: %s", e)
            return []

    async def delete_document(self, dataset_id: str, document_id: str) -> bool:
        """Delete a document from RAGFlow."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.delete(
                    f"{self.base_url}/api/v1/datasets/{dataset_id}/documents",
                    headers=self._headers,
                    json={"ids": [document_id]},
                )
                resp.raise_for_status()
                return resp.json().get("code") == 0
        except Exception as e:
            logger.error("RAGFlow delete_document failed: %s", e)
            return False


ragflow_client = RAGFlowClient()
