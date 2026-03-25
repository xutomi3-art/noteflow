import logging

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(60.0, connect=10.0)
RETRIEVAL_TIMEOUT = httpx.Timeout(90.0, connect=10.0)  # longer for TOC/KG-enhanced retrieval

# Persistent connection pool for better performance
_POOL_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10)


class RAGFlowClient:
    """HTTP client for RAGFlow API with connection pooling."""

    def __init__(self) -> None:
        self.base_url = settings.RAGFLOW_BASE_URL.rstrip("/")
        self.api_key = settings.RAGFLOW_API_KEY

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def create_dataset(self, name: str) -> str | None:
        """Create a dataset in RAGFlow. Returns dataset_id or None on failure.

        Parser config matches production environment:
        - chunk_token_num=1024: balanced chunk size
        - enable_children=true: parent-child chunking for context preservation
        - toc_extraction=true: extract table-of-contents structure
        - auto_keywords/auto_questions=0: disabled (handled by LLM at query time)
        - layout_recognize=DeepDOC: document layout analysis
        - html4excel=true: preserve table structure for Excel files
        - overlapped_percent=15: chunk overlap for continuity
        """
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, limits=_POOL_LIMITS) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v1/datasets",
                    headers=self._headers,
                    json={
                        "name": name,
                        "chunk_method": "naive",
                        "parser_config": {
                            "chunk_token_num": 1024,
                            "delimiter": "\n\n",
                            "html4excel": True,
                            "auto_keywords": 0,
                            "auto_questions": 0,
                            "toc_extraction": True,
                            "enable_children": True,
                            "children_delimiter": "\n",
                            "layout_recognize": "DeepDOC",
                            "overlapped_percent": 15,
                            "filename_embd_weight": 0.1,
                            "raptor": {"use_raptor": settings.RAPTOR_ENABLED},
                        },
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0:
                    dataset_id = data["data"]["id"]
                    return dataset_id
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
                async with httpx.AsyncClient(timeout=upload_timeout, limits=_POOL_LIMITS) as client:
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
            async with httpx.AsyncClient(timeout=TIMEOUT, limits=_POOL_LIMITS) as client:
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
            async with httpx.AsyncClient(timeout=TIMEOUT, limits=_POOL_LIMITS) as client:
                resp = await client.get(
                    f"{self.base_url}/api/v1/datasets/{dataset_id}/documents",
                    headers=self._headers,
                    params={"id": document_id},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0 and data.get("data"):
                    docs = data["data"]
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
        self, dataset_ids: list[str], question: str, top_k: int = 15,
        document_ids: list[str] | None = None,
    ) -> list[dict]:
        """Retrieve relevant chunks from RAGFlow datasets.

        Uses optimized settings for English-primary, Chinese-secondary content:
        - top_k=80: ES KNN candidate pool (just above RERANK_LIMIT=75)
        - size=top_k: final number of chunks returned after reranking
        - vector_similarity_weight from settings (default 0.6, higher = more semantic)
        - similarity_threshold from settings (default 0.0, filtering disabled)
        - keyword=True for BM25 hybrid search
        - rerank_id=gte-rerank for result reranking
        """
        try:
            async with httpx.AsyncClient(timeout=RETRIEVAL_TIMEOUT, limits=_POOL_LIMITS) as client:
                payload: dict = {
                    "question": question,
                    "dataset_ids": dataset_ids,
                    "similarity_threshold": settings.RAG_SIMILARITY_THRESHOLD,
                    "vector_similarity_weight": settings.RAG_VECTOR_WEIGHT,
                    "top_k": 15,
                    "size": top_k,
                    "keyword": True,
                    "rerank_id": settings.RAG_RERANK_ID,
                }
                if document_ids:
                    payload["document_ids"] = document_ids
                resp = await client.post(
                    f"{self.base_url}/api/v1/retrieval",
                    headers=self._headers,
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0:
                    chunks = data.get("data", {}).get("chunks", [])
                    # RAGFlow's enable_children may return far more chunks than
                    # requested `size` (parent chunks are appended). Apply our
                    # own similarity filter and size limit to keep prompts tight.
                    threshold = settings.RAG_SIMILARITY_THRESHOLD
                    if threshold > 0 and chunks:
                        before = len(chunks)
                        chunks = [c for c in chunks if c.get("similarity", 0) >= threshold]
                        if len(chunks) < before:
                            logger.info("Similarity filter: %d → %d chunks (threshold=%.2f)",
                                        before, len(chunks), threshold)
                    if len(chunks) > top_k:
                        logger.info("Trimming chunks from %d to %d (top_k limit)", len(chunks), top_k)
                        chunks = chunks[:top_k]
                    return chunks
                logger.error("RAGFlow retrieve error: %s", data)
                return []
        except Exception as e:
            logger.error("RAGFlow retrieve failed: %s", e)
            return []

    async def list_chunks(
        self, dataset_id: str, document_id: str, page: int = 1, size: int = 100
    ) -> list[dict]:
        """List chunks of a document. Returns list of chunk dicts with 'content' field."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, limits=_POOL_LIMITS) as client:
                resp = await client.get(
                    f"{self.base_url}/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks",
                    headers=self._headers,
                    params={"page": page, "page_size": size},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0 and data.get("data"):
                    chunks = data["data"]
                    if isinstance(chunks, dict) and "chunks" in chunks:
                        chunks = chunks["chunks"]
                    return chunks if isinstance(chunks, list) else []
                return []
        except Exception as e:
            logger.error("RAGFlow list_chunks failed: %s", e)
            return []

    async def run_raptor(self, dataset_id: str) -> str | None:
        """Trigger Raptor clustering on a dataset. Returns task_id or None."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, limits=_POOL_LIMITS) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v1/datasets/{dataset_id}/run_raptor",
                    headers=self._headers,
                    json={},
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0:
                    task_id = data.get("data", {}).get("raptor_task_id")
                    logger.info("RAGFlow Raptor triggered for dataset %s, task_id=%s", dataset_id, task_id)
                    return task_id
                logger.warning("RAGFlow run_raptor response: %s", data)
                return None
        except Exception as e:
            logger.error("RAGFlow run_raptor failed: %s", e)
            return None

    async def get_raptor_status(self, dataset_id: str) -> str | None:
        """Check Raptor task status. Returns 'done', 'running', 'failed', or None."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, limits=_POOL_LIMITS) as client:
                resp = await client.get(
                    f"{self.base_url}/api/v1/datasets/{dataset_id}/trace_raptor",
                    headers=self._headers,
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("code") == 0:
                    task_data = data.get("data", {})
                    progress = task_data.get("progress", 0)
                    if progress == 1:
                        return "done"
                    elif progress == -1:
                        return "failed"
                    else:
                        return "running"
                return None
        except Exception as e:
            logger.error("RAGFlow get_raptor_status failed: %s", e)
            return None

    async def delete_document(self, dataset_id: str, document_id: str) -> bool:
        """Delete a document from RAGFlow."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, limits=_POOL_LIMITS) as client:
                resp = await client.request(
                    "DELETE",
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
