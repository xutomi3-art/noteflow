"""Read/write RAGFlow internal model config directly from RAGFlow's MySQL tenant table."""

import logging

import aiomysql

logger = logging.getLogger(__name__)

# RAGFlow MySQL connection info (from service_conf.yaml defaults)
_MYSQL_CONFIG = {
    "host": "ragflow-mysql",
    "port": 3306,
    "user": "root",
    "password": "infini_rag_flow",
    "db": "rag_flow",
}

MODEL_FIELDS = ("llm_id", "embd_id", "rerank_id")

# Cached tenant ID (discovered at first use)
_cached_tenant_id: str | None = None


async def _resolve_tenant_id() -> str:
    """Discover the RAGFlow tenant ID from the database."""
    global _cached_tenant_id  # noqa: PLW0603
    if _cached_tenant_id:
        return _cached_tenant_id
    conn = await aiomysql.connect(**_MYSQL_CONFIG)
    try:
        async with conn.cursor() as cur:
            await cur.execute("SELECT id FROM tenant ORDER BY create_time LIMIT 1")
            row = await cur.fetchone()
            if not row:
                raise ValueError("No RAGFlow tenant found in database")
            _cached_tenant_id = row[0]
            logger.info("Discovered RAGFlow tenant ID: %s", _cached_tenant_id)
            return _cached_tenant_id
    finally:
        conn.close()


async def get_ragflow_models(tenant_id: str | None = None) -> dict:
    """Read llm_id, embd_id, rerank_id from RAGFlow tenant table."""
    tid = tenant_id or await _resolve_tenant_id()
    conn = await aiomysql.connect(**_MYSQL_CONFIG)
    try:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT llm_id, embd_id, rerank_id FROM tenant WHERE id = %s",
                (tid,),
            )
            row = await cur.fetchone()
            if not row:
                raise ValueError(f"RAGFlow tenant {tid} not found")
            return {k: row[k] for k in MODEL_FIELDS}
    finally:
        conn.close()


async def update_ragflow_models(
    tenant_id: str | None = None,
    *,
    llm_id: str | None = None,
    embd_id: str | None = None,
    rerank_id: str | None = None,
) -> dict:
    """Update model fields on RAGFlow tenant. Returns updated values."""
    updates: dict[str, str] = {}
    if llm_id is not None:
        updates["llm_id"] = llm_id
    if embd_id is not None:
        updates["embd_id"] = embd_id
    if rerank_id is not None:
        updates["rerank_id"] = rerank_id

    tid = tenant_id or await _resolve_tenant_id()

    if not updates:
        return await get_ragflow_models(tid)

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [tid]

    conn = await aiomysql.connect(**_MYSQL_CONFIG)
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                f"UPDATE tenant SET {set_clause} WHERE id = %s",  # noqa: S608
                values,
            )
        await conn.commit()
        logger.info("Updated RAGFlow tenant %s: %s", tid, updates)
    finally:
        conn.close()

    return await get_ragflow_models(tid)
