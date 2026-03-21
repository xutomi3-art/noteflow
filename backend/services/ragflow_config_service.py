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

TENANT_ID = "b89c34f31c6411f1a89302a7118c9470"

MODEL_FIELDS = ("llm_id", "embd_id", "rerank_id")


async def get_ragflow_models(tenant_id: str = TENANT_ID) -> dict:
    """Read llm_id, embd_id, rerank_id from RAGFlow tenant table."""
    conn = await aiomysql.connect(**_MYSQL_CONFIG)
    try:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT llm_id, embd_id, rerank_id FROM tenant WHERE id = %s",
                (tenant_id,),
            )
            row = await cur.fetchone()
            if not row:
                raise ValueError(f"RAGFlow tenant {tenant_id} not found")
            return {k: row[k] for k in MODEL_FIELDS}
    finally:
        conn.close()


async def update_ragflow_models(
    tenant_id: str = TENANT_ID,
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

    if not updates:
        return await get_ragflow_models(tenant_id)

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [tenant_id]

    conn = await aiomysql.connect(**_MYSQL_CONFIG)
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                f"UPDATE tenant SET {set_clause} WHERE id = %s",  # noqa: S608
                values,
            )
        await conn.commit()
        logger.info("Updated RAGFlow tenant %s: %s", tenant_id, updates)
    finally:
        conn.close()

    return await get_ragflow_models(tenant_id)
