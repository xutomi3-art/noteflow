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
        # Count notebooks owned by user
        nb_count = (await db.execute(
            select(func.count(Notebook.id)).where(Notebook.owner_id == u.id)
        )).scalar() or 0
        # Count documents uploaded by user
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
        return {"status": "error", "latency_ms": 0, "message": str(e)}


async def check_service_health(db: AsyncSession | None = None) -> dict:
    services = {}

    # PostgreSQL — actual query to verify
    if db:
        try:
            from sqlalchemy import text
            start = datetime.now()
            await db.execute(text("SELECT 1"))
            latency = (datetime.now() - start).total_seconds() * 1000
            services["postgresql"] = {"status": "ok", "latency_ms": round(latency), "message": None}
        except Exception as e:
            services["postgresql"] = {"status": "error", "latency_ms": 0, "message": str(e)}
    else:
        services["postgresql"] = {"status": "ok", "latency_ms": 0, "message": None}

    # RAGFlow
    services["ragflow"] = await _check_http(
        f"{settings.RAGFLOW_BASE_URL}/api/v1/datasets",
        headers={"Authorization": f"Bearer {settings.RAGFLOW_API_KEY}"},
    )

    # MinerU — GET /gradio_api/info (Gradio API info endpoint)
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
        services["mineru"] = {"status": "error", "latency_ms": 0, "message": str(e)}

    # Elasticsearch — check cluster health (green/yellow = ok, red = error)
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
        services["elasticsearch"] = {"status": "error", "latency_ms": 0, "message": str(e)}

    # Redis — AUTH + PING, expect +PONG response
    try:
        import socket
        start = datetime.now()
        sock = socket.create_connection(("ragflow-redis", 6379), timeout=3)
        # RAGFlow Redis requires auth
        redis_pass = getattr(settings, "RAGFLOW_REDIS_PASSWORD", "infini_rag_flow")
        sock.sendall(f"AUTH {redis_pass}\r\nPING\r\n".encode())
        reply = sock.recv(128)
        sock.close()
        latency = (datetime.now() - start).total_seconds() * 1000
        if b"+PONG" in reply:
            services["redis"] = {"status": "ok", "latency_ms": round(latency), "message": None}
        else:
            services["redis"] = {"status": "error", "latency_ms": round(latency), "message": f"unexpected reply: {reply.decode(errors='replace')}"}
    except Exception as e:
        services["redis"] = {"status": "error", "latency_ms": 0, "message": str(e)}

    # Docmee (AiPPT)
    if settings.DOCMEE_API_KEY:
        services["docmee"] = await _check_http(
            "https://docmee.cn/api/user/apiInfo",
            headers={"Api-Key": settings.DOCMEE_API_KEY},
        )
    else:
        services["docmee"] = {"status": "error", "latency_ms": 0, "message": "API key not configured"}

    # LLM API — connectivity check + recent request success rate
    if settings.QWEN_API_KEY:
        base = settings.LLM_BASE_URL.rstrip("/")
        llm_health = await _check_http(
            f"{base}/models",
            headers={"Authorization": f"Bearer {settings.QWEN_API_KEY}"},
        )
        # Check recent chat success rate from chat_logs (last 30 minutes)
        if db:
            try:
                from sqlalchemy import text
                row = await db.execute(text(
                    "SELECT "
                    "COUNT(*) AS total, "
                    "COUNT(*) FILTER (WHERE status = 'ok') AS ok, "
                    "COUNT(*) FILTER (WHERE status != 'ok' OR error_message IS NOT NULL) AS errors, "
                    "ROUND(AVG(total_duration)::numeric, 1) AS avg_duration "
                    "FROM chat_logs WHERE created_at > NOW() - INTERVAL '30 minutes'"
                ))
                stats = row.fetchone()
                total = stats[0] if stats else 0
                ok_count = stats[1] if stats else 0
                error_count = stats[2] if stats else 0
                avg_dur = float(stats[3]) if stats and stats[3] else 0

                if total > 0:
                    rate = round(ok_count * 100 / total)
                    msg = llm_health.get("message") or ""
                    llm_health["message"] = f"{rate}% success ({ok_count}/{total} last 30min, avg {avg_dur}s)"
                    if error_count > 0 and rate < 80:
                        llm_health["status"] = "warning"
                    elif error_count > 0 and rate < 50:
                        llm_health["status"] = "error"
            except Exception as e:
                logger.warning("Failed to check LLM success rate: %s", e)
        services["llm"] = llm_health
    else:
        services["llm"] = {"status": "error", "latency_ms": 0, "message": "API key not configured"}

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
        # List running containers
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

                # Calculate CPU %
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

                # Memory
                mem_usage = stats["memory_stats"].get("usage", 0)
                mem_limit = stats["memory_stats"].get("limit", 0)
                # Subtract cache from usage for accurate reading
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
