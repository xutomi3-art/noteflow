import os

import httpx
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.models.user import User
from backend.models.notebook import Notebook
from backend.models.source import Source


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

    # Qwen API (DashScope) — used for chat, embedding, and vision
    if settings.QWEN_API_KEY:
        services["qwen"] = await _check_http(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
            headers={"Authorization": f"Bearer {settings.QWEN_API_KEY}"},
        )
    else:
        services["qwen"] = {"status": "error", "latency_ms": 0, "message": "API key not configured"}

    # Google OAuth connectivity (via proxy if configured)
    if settings.GOOGLE_CLIENT_ID:
        try:
            proxy_kwargs: dict = {"timeout": 10.0}
            google_proxy = os.getenv("GOOGLE_PROXY", "") or getattr(settings, "GOOGLE_PROXY", "")
            if google_proxy:
                proxy_kwargs["proxy"] = google_proxy
            async with httpx.AsyncClient(**proxy_kwargs) as client:
                start = datetime.now()
                resp = await client.get("https://accounts.google.com/.well-known/openid-configuration")
                latency = (datetime.now() - start).total_seconds() * 1000
                if resp.status_code == 200:
                    proxy_note = " (via proxy)" if google_proxy else ""
                    services["google_oauth"] = {"status": "ok", "latency_ms": round(latency), "message": f"Reachable{proxy_note}"}
                else:
                    services["google_oauth"] = {"status": "error", "latency_ms": round(latency), "message": f"HTTP {resp.status_code}"}
        except Exception as e:
            services["google_oauth"] = {"status": "error", "latency_ms": 0, "message": str(e)[:100]}
    else:
        services["google_oauth"] = {"status": "error", "latency_ms": 0, "message": "Client ID not configured"}

    return services
