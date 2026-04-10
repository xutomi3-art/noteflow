import json
import logging
import os

import httpx
import psutil
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.models.user import User
from backend.models.notebook import Notebook
from backend.models.source import Source

logger = logging.getLogger(__name__)


async def get_dashboard_stats(db: AsyncSession) -> dict:
    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    total_notebooks = (await db.execute(select(func.count(Notebook.id)))).scalar() or 0
    total_documents = (await db.execute(select(func.count(Source.id)))).scalar() or 0
    storage_bytes = (await db.execute(select(func.coalesce(func.sum(Source.file_size), 0)))).scalar() or 0

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    active_users_7d = (await db.execute(
        select(func.count(User.id)).where(User.last_active_at >= week_ago)
    )).scalar() or 0

    return {
        "total_users": total_users,
        "total_notebooks": total_notebooks,
        "total_documents": total_documents,
        "storage_bytes": storage_bytes,
        "active_users_7d": active_users_7d,
    }


async def list_users(
    db: AsyncSession,
    search: str | None = None,
    page: int = 1,
    limit: int = 20,
) -> dict:
    base_query = select(User)
    count_query = select(func.count(User.id))

    if search:
        pattern = f"%{search}%"
        base_query = base_query.where(User.email.ilike(pattern) | User.name.ilike(pattern))
        count_query = count_query.where(User.email.ilike(pattern) | User.name.ilike(pattern))

    total = (await db.execute(count_query)).scalar() or 0

    offset = (page - 1) * limit
    result = await db.execute(
        base_query.order_by(User.created_at.desc()).offset(offset).limit(limit)
    )
    users = result.scalars().all()

    items = []
    for u in users:
        nb_count = (await db.execute(
            select(func.count(Notebook.id)).where(Notebook.owner_id == u.id)
        )).scalar() or 0
        doc_count = (await db.execute(
            select(func.count(Source.id)).where(Source.uploaded_by == u.id)
        )).scalar() or 0

        items.append({
            "id": str(u.id),
            "email": u.email,
            "name": u.name,
            "avatar": u.avatar,
            "is_admin": u.is_admin,
            "is_disabled": u.is_disabled,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_active_at": u.last_active_at.isoformat() if u.last_active_at else None,
            "notebook_count": nb_count,
            "document_count": doc_count,
        })

    return {"items": items, "total": total, "page": page, "limit": limit}


async def update_user(db: AsyncSession, user_id: str, updates: dict) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("User not found")

    allowed_fields = {"is_disabled", "is_admin", "name"}
    for key, value in updates.items():
        if key in allowed_fields:
            setattr(user, key, value)

    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "is_admin": user.is_admin,
        "is_disabled": user.is_disabled,
    }


# ---------------------------------------------------------------------------
# Health check helpers
# ---------------------------------------------------------------------------

async def _check_http(url: str, headers: dict | None = None) -> dict:
    """Check an HTTP endpoint and return status + latency."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            start = datetime.now()
            resp = await client.get(url, headers=headers or {})
            latency = (datetime.now() - start).total_seconds() * 1000
            return {
                "status": "ok" if resp.status_code < 400 else "error",
                "latency_ms": round(latency),
                "message": None if resp.status_code < 400 else f"HTTP {resp.status_code}",
            }
    except Exception as e:
        return {"status": "error", "latency_ms": 0, "message": str(e)[:120]}


async def _probe_chat_completion(base_url: str, model: str, api_key: str) -> dict:
    """Send a real chat completion request ("hi") to verify the LLM can generate."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            start = datetime.now()
            resp = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": 20,
                    "temperature": 0,
                },
            )
            latency = (datetime.now() - start).total_seconds() * 1000
            if resp.status_code == 200:
                data = resp.json()
                text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                # Strip <think>...</think> blocks from probe display
                import re as _re
                text = _re.sub(r'<think>.*?</think>\s*', '', text, flags=_re.DOTALL)
                text = _re.sub(r'^Thinking Process:.*?(?=\n[A-Z]|\n\n|$)', '', text, flags=_re.DOTALL).strip()
                if not text:
                    text = "(ok, thinking stripped)"
                return {
                    "status": "ok",
                    "latency_ms": round(latency),
                    "message": f'"{text[:30]}" ({model})',
                }
            else:
                body = resp.text[:100]
                return {"status": "error", "latency_ms": round(latency), "message": f"HTTP {resp.status_code}: {body}"}
    except Exception as e:
        return {"status": "error", "latency_ms": 0, "message": str(e)[:120]}


async def _probe_embedding(base_url: str, model: str, api_key: str = "") -> dict:
    """Send a small text to the embedding endpoint and verify vectors are returned."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            start = datetime.now()
            resp = await client.post(
                f"{base_url.rstrip('/')}/embeddings",
                headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
                json={"model": model, "input": "health check"},
            )
            latency = (datetime.now() - start).total_seconds() * 1000
            if resp.status_code == 200:
                data = resp.json()
                embeddings = data.get("data", [])
                if embeddings and len(embeddings[0].get("embedding", [])) > 0:
                    dim = len(embeddings[0]["embedding"])
                    return {"status": "ok", "latency_ms": round(latency), "message": f"{dim}d vectors ({model})"}
                return {"status": "error", "latency_ms": round(latency), "message": "Empty embedding returned"}
            else:
                return {"status": "error", "latency_ms": round(latency), "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"status": "error", "latency_ms": 0, "message": str(e)[:120]}


# ---------------------------------------------------------------------------
# Main health check — real functional probes for each model
# ---------------------------------------------------------------------------

async def check_service_health(db: AsyncSession | None = None) -> dict:
    services = {}

    # ── Infrastructure ──────────────────────────────────────────────

    # PostgreSQL
    if db:
        try:
            from sqlalchemy import text
            start = datetime.now()
            await db.execute(text("SELECT 1"))
            latency = (datetime.now() - start).total_seconds() * 1000
            services["postgresql"] = {"status": "ok", "latency_ms": round(latency), "message": None}
        except Exception as e:
            services["postgresql"] = {"status": "error", "latency_ms": 0, "message": str(e)[:120]}
    else:
        services["postgresql"] = {"status": "ok", "latency_ms": 0, "message": None}

    # RAGFlow
    services["ragflow"] = await _check_http(
        f"{settings.RAGFLOW_BASE_URL}/api/v1/datasets",
        headers={"Authorization": f"Bearer {settings.RAGFLOW_API_KEY}"},
    )

    # MinerU
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            start = datetime.now()
            resp = await client.get(f"{settings.MINERU_BASE_URL}/gradio_api/info")
            latency = (datetime.now() - start).total_seconds() * 1000
            if resp.status_code == 200:
                services["mineru"] = {"status": "ok", "latency_ms": round(latency), "message": None}
            else:
                services["mineru"] = {"status": "error", "latency_ms": round(latency), "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        services["mineru"] = {"status": "error", "latency_ms": 0, "message": str(e)[:120]}

    # Elasticsearch
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            start = datetime.now()
            resp = await client.get("http://ragflow-es:9200/_cluster/health")
            latency = (datetime.now() - start).total_seconds() * 1000
            if resp.status_code == 200:
                cluster = resp.json()
                es_status = cluster.get("status", "unknown")
                if es_status in ("green", "yellow"):
                    services["elasticsearch"] = {"status": "ok", "latency_ms": round(latency), "message": f"cluster: {es_status}"}
                else:
                    services["elasticsearch"] = {"status": "error", "latency_ms": round(latency), "message": f"cluster: {es_status}"}
            else:
                services["elasticsearch"] = {"status": "error", "latency_ms": round(latency), "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        services["elasticsearch"] = {"status": "error", "latency_ms": 0, "message": str(e)[:120]}

    # Redis
    try:
        import socket
        start = datetime.now()
        sock = socket.create_connection(("ragflow-redis", 6379), timeout=3)
        redis_pass = getattr(settings, "RAGFLOW_REDIS_PASSWORD", "infini_rag_flow")
        sock.sendall(f"AUTH {redis_pass}\r\nPING\r\n".encode())
        reply = sock.recv(128)
        sock.close()
        latency = (datetime.now() - start).total_seconds() * 1000
        if b"+PONG" in reply:
            services["redis"] = {"status": "ok", "latency_ms": round(latency), "message": None}
        else:
            services["redis"] = {"status": "error", "latency_ms": round(latency), "message": f"unexpected: {reply.decode(errors='replace')[:60]}"}
    except Exception as e:
        services["redis"] = {"status": "error", "latency_ms": 0, "message": str(e)[:120]}

    # Docmee
    if settings.DOCMEE_API_KEY:
        services["docmee"] = await _check_http(
            "https://docmee.cn/api/user/apiInfo",
            headers={"Api-Key": settings.DOCMEE_API_KEY},
        )
    else:
        services["docmee"] = {"status": "error", "latency_ms": 0, "message": "API key not configured"}

    # ── AI Models — real functional probes ───────────────────────

    # Chat LLM Primary — send "hi", expect a real reply
    primary_key = settings.QWEN_API_KEY or "not-needed"
    services["chat_llm_primary"] = await _probe_chat_completion(
        settings.LLM_BASE_URL, settings.LLM_MODEL, primary_key,
    )

    # Chat LLM Secondary — only if backup is enabled and configured
    if settings.LLM_BACKUP_ENABLED and settings.LLM_BACKUP_BASE_URL:
        backup_key = settings.LLM_BACKUP_API_KEY or settings.QWEN_API_KEY
        if backup_key:
            services["chat_llm_secondary"] = await _probe_chat_completion(
                settings.LLM_BACKUP_BASE_URL, settings.LLM_BACKUP_MODEL, backup_key,
            )
        else:
            services["chat_llm_secondary"] = {"status": "error", "latency_ms": 0, "message": "No API key for backup"}
    else:
        services["chat_llm_secondary"] = {"status": "error", "latency_ms": 0, "message": "Backup not enabled"}

    # Vision LLM — check endpoint reachability (real probe would need an image)
    if settings.VISION_ENABLED:
        vision_base = settings.LLM_VISION_BASE_URL or settings.LLM_BASE_URL
        vision_key = settings.LLM_VISION_API_KEY or settings.QWEN_API_KEY
        vision_health = await _check_http(
            f"{vision_base.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {vision_key}"} if vision_key else {},
        )
        vision_health["message"] = f"{settings.LLM_VISION_MODEL}" + (f" — {vision_health['message']}" if vision_health.get("message") else "")
        services["vision_llm"] = vision_health
    else:
        services["vision_llm"] = {"status": "ok", "latency_ms": 0, "message": "Disabled"}

    # Embedding — send real text, check vectors come back
    # Read the embedding provider URL from RAGFlow config
    try:
        from backend.services.ragflow_config_service import get_ragflow_providers
        provs = await get_ragflow_providers()
        # Find the active embedding provider
        emb_prov = next((p for p in provs if p["model_type"] == "embedding" and p.get("api_base")), None)
        if emb_prov:
            services["embedding"] = await _probe_embedding(
                f"{emb_prov['api_base'].rstrip('/')}/v1",
                emb_prov["llm_name"],
            )
        else:
            services["embedding"] = {"status": "error", "latency_ms": 0, "message": "No embedding provider configured in RAGFlow"}
    except Exception as e:
        services["embedding"] = {"status": "error", "latency_ms": 0, "message": f"Could not check: {str(e)[:80]}"}

    # Rerank — check DashScope API reachability (use backup key if primary is not DashScope)
    rerank_key = settings.QWEN_API_KEY
    if "dashscope" not in settings.LLM_BASE_URL and settings.LLM_BACKUP_API_KEY:
        rerank_key = settings.LLM_BACKUP_API_KEY
    services["rerank"] = await _check_http(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
        headers={"Authorization": f"Bearer {rerank_key}"} if rerank_key else {},
    )
    rerank_model = settings.RAG_RERANK_ID or "gte-rerank"
    services["rerank"]["message"] = rerank_model + (f" — {services['rerank']['message']}" if services["rerank"].get("message") else "")

    # ASR (Qwen3-ASR via Xinference) — end-to-end test with real transcription call
    import os
    import struct
    import io
    import wave
    asr_url = os.environ.get("QWEN3_ASR_URL", os.environ.get("FUNASR_ASR_URL", "http://10.200.0.102:9997/v1"))
    try:
        # Generate 0.5s of silent PCM audio (16kHz, 16-bit, mono)
        n_samples = 8000  # 0.5s
        pcm_data = struct.pack(f"<{n_samples}h", *([0] * n_samples))
        wav_buf = io.BytesIO()
        with wave.open(wav_buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(pcm_data)
        wav_bytes = wav_buf.getvalue()

        async with httpx.AsyncClient(timeout=15.0) as c:
            resp = await c.post(
                f"{asr_url.rstrip('/')}/audio/transcriptions",
                files={"file": ("test.wav", wav_bytes, "audio/wav")},
                data={"model": "Qwen3-ASR-1.7B", "language": "Chinese", "response_format": "json"},
            )
        if resp.status_code == 200:
            services["asr"] = {"status": "healthy", "message": "Qwen3-ASR — transcription OK"}
        else:
            services["asr"] = {"status": "unhealthy", "message": f"Qwen3-ASR — HTTP {resp.status_code}: {resp.text[:100]}"}
    except Exception as e:
        services["asr"] = {"status": "unhealthy", "message": f"Qwen3-ASR — {str(e)[:100]}"}

    return services


# ---------------------------------------------------------------------------
# Resource monitoring (host + Docker containers)
# ---------------------------------------------------------------------------

DOCKER_SOCKET = "/var/run/docker.sock"


def get_host_resources() -> dict:
    """Get host CPU and memory usage via psutil."""
    cpu_percent = psutil.cpu_percent(interval=1)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    return {
        "cpu_percent": cpu_percent,
        "memory_percent": mem.percent,
        "memory_used_gb": round(mem.used / (1024 ** 3), 1),
        "memory_total_gb": round(mem.total / (1024 ** 3), 1),
        "disk_percent": disk.percent,
        "disk_used_gb": round(disk.used / (1024 ** 3), 1),
        "disk_total_gb": round(disk.total / (1024 ** 3), 1),
    }


async def get_container_resources() -> list[dict]:
    """Get CPU and memory usage for each Docker container via Docker Engine API."""
    if not os.path.exists(DOCKER_SOCKET):
        logger.warning("Docker socket not found at %s", DOCKER_SOCKET)
        return []

    transport = httpx.AsyncHTTPTransport(uds=DOCKER_SOCKET)
    async with httpx.AsyncClient(transport=transport, base_url="http://docker") as client:
        try:
            resp = await client.get("/containers/json", timeout=5.0)
            if resp.status_code != 200:
                logger.error("Docker API /containers/json returned %s", resp.status_code)
                return []
            containers = resp.json()
        except Exception as e:
            logger.error("Failed to list Docker containers: %s", e)
            return []

        results = []
        for c in containers:
            name = (c.get("Names") or ["/unknown"])[0].lstrip("/")
            container_id = c["Id"]
            try:
                stats_resp = await client.get(
                    f"/containers/{container_id}/stats",
                    params={"stream": "false"},
                    timeout=10.0,
                )
                if stats_resp.status_code != 200:
                    continue
                stats = stats_resp.json()

                cpu_delta = (
                    stats["cpu_stats"]["cpu_usage"]["total_usage"]
                    - stats["precpu_stats"]["cpu_usage"]["total_usage"]
                )
                system_delta = (
                    stats["cpu_stats"]["system_cpu_usage"]
                    - stats["precpu_stats"]["system_cpu_usage"]
                )
                num_cpus = stats["cpu_stats"].get("online_cpus") or len(
                    stats["cpu_stats"]["cpu_usage"].get("percpu_usage", [1])
                )
                cpu_percent = (cpu_delta / system_delta) * num_cpus * 100.0 if system_delta > 0 else 0.0

                mem_usage = stats["memory_stats"].get("usage", 0)
                mem_limit = stats["memory_stats"].get("limit", 0)
                cache = stats["memory_stats"].get("stats", {}).get("cache", 0)
                mem_actual = mem_usage - cache
                mem_percent = (mem_actual / mem_limit) * 100.0 if mem_limit > 0 else 0.0

                results.append({
                    "name": name,
                    "cpu_percent": round(cpu_percent, 1),
                    "memory_mb": round(mem_actual / (1024 ** 2), 1),
                    "memory_limit_mb": round(mem_limit / (1024 ** 2), 1),
                    "memory_percent": round(mem_percent, 1),
                })
            except Exception as e:
                logger.debug("Failed to get stats for container %s: %s", name, e)
                continue

        return sorted(results, key=lambda x: x["cpu_percent"], reverse=True)
