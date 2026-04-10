import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.models.system_setting import SystemSetting

logger = logging.getLogger(__name__)

# Keys that can be configured via admin panel
CONFIGURABLE_KEYS = {
    "llm_base_url", "llm_model", "llm_max_output_tokens", "llm_context_window", "rag_top_k", "rag_similarity_threshold", "rag_vector_weight", "rag_rewrite_model", "rag_decompose_model", "rag_think_rounds", "rag_rerank_id",
    "qwen_api_key",
    "llm_backup_enabled", "llm_backup_base_url", "llm_backup_model", "llm_backup_api_key", "llm_backup_context_window",
    "ragflow_api_key", "ragflow_base_url", "raptor_enabled", "query_rewrite_enabled", "pageindex_enabled",
    "llm_vision_model", "llm_vision_base_url", "llm_vision_api_key", "vision_enabled",
    "docmee_api_key",
    "max_file_size_mb",
    "web_scraper_remove_selector",
    "smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_from",
    "alibaba_tts_appkey", "alibaba_tts_token",
    "google_client_id", "google_client_secret", "google_redirect_uri", "google_proxy",
    "microsoft_client_id", "microsoft_client_secret", "microsoft_tenant_id", "microsoft_redirect_uri",
    "log_retention_days",
    "alert_email", "alert_check_interval_minutes",
    "resource_cpu_threshold", "resource_memory_threshold", "resource_disk_threshold",
    "resource_container_cpu_threshold", "resource_container_memory_threshold",
}

# Keys that contain sensitive values — mask on read
SENSITIVE_KEYS = {"qwen_api_key", "llm_backup_api_key", "ragflow_api_key", "docmee_api_key", "smtp_password", "alibaba_tts_token", "google_client_secret", "microsoft_client_secret", "llm_vision_api_key"}

# Mapping from setting key to Settings attribute
_ENV_MAP = {
    "llm_base_url": "LLM_BASE_URL",
    "llm_model": "LLM_MODEL",
    "llm_max_output_tokens": "LLM_MAX_OUTPUT_TOKENS",
    "llm_context_window": "LLM_CONTEXT_WINDOW",
    "rag_top_k": "RAG_TOP_K",
    "rag_similarity_threshold": "RAG_SIMILARITY_THRESHOLD",
    "rag_vector_weight": "RAG_VECTOR_WEIGHT",
    "rag_rewrite_model": "RAG_REWRITE_MODEL",
    "rag_decompose_model": "RAG_DECOMPOSE_MODEL",
    "rag_think_rounds": "RAG_THINK_ROUNDS",
    "rag_rerank_id": "RAG_RERANK_ID",
    "qwen_api_key": "QWEN_API_KEY",
    "llm_backup_enabled": "LLM_BACKUP_ENABLED",
    "llm_backup_base_url": "LLM_BACKUP_BASE_URL",
    "llm_backup_model": "LLM_BACKUP_MODEL",
    "llm_backup_api_key": "LLM_BACKUP_API_KEY",
    "llm_backup_context_window": "LLM_BACKUP_CONTEXT_WINDOW",
    "ragflow_api_key": "RAGFLOW_API_KEY",
    "ragflow_base_url": "RAGFLOW_BASE_URL",
    "raptor_enabled": "RAPTOR_ENABLED",
    "query_rewrite_enabled": "QUERY_REWRITE_ENABLED",
    "pageindex_enabled": "PAGEINDEX_ENABLED",
    "llm_vision_model": "LLM_VISION_MODEL",
    "llm_vision_base_url": "LLM_VISION_BASE_URL",
    "llm_vision_api_key": "LLM_VISION_API_KEY",
    "vision_enabled": "VISION_ENABLED",
    "docmee_api_key": "DOCMEE_API_KEY",
    "max_file_size_mb": "MAX_FILE_SIZE_MB",
    "web_scraper_remove_selector": "WEB_SCRAPER_REMOVE_SELECTOR",
    "smtp_host": "SMTP_HOST",
    "smtp_port": "SMTP_PORT",
    "smtp_user": "SMTP_USER",
    "smtp_password": "SMTP_PASSWORD",
    "smtp_from": "SMTP_FROM",
    "alibaba_tts_appkey": "ALIBABA_TTS_APPKEY",
    "alibaba_tts_token": "ALIBABA_TTS_TOKEN",
    "google_client_id": "GOOGLE_CLIENT_ID",
    "google_client_secret": "GOOGLE_CLIENT_SECRET",
    "google_redirect_uri": "GOOGLE_REDIRECT_URI",
    "google_proxy": "GOOGLE_PROXY",
    "microsoft_client_id": "MICROSOFT_CLIENT_ID",
    "microsoft_client_secret": "MICROSOFT_CLIENT_SECRET",
    "microsoft_tenant_id": "MICROSOFT_TENANT_ID",
    "microsoft_redirect_uri": "MICROSOFT_REDIRECT_URI",
    "log_retention_days": "LOG_RETENTION_DAYS",
    "alert_email": "ALERT_EMAIL",
    "alert_check_interval_minutes": "ALERT_CHECK_INTERVAL_MINUTES",
}


def _mask_value(key: str, value: str) -> str:
    if key in SENSITIVE_KEYS and value and len(value) > 4:
        return "****" + value[-4:]
    return value


def _get_env_value(key: str) -> str:
    attr = _ENV_MAP.get(key)
    if attr:
        return str(getattr(settings, attr, ""))
    return ""


async def get_setting(db: AsyncSession, key: str) -> str:
    """Get setting value: DB takes priority, fallback to env."""
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    row = result.scalar_one_or_none()
    if row:
        return row.value
    return _get_env_value(key)


async def set_setting(db: AsyncSession, key: str, value: str, user_id: uuid.UUID) -> None:
    if key not in CONFIGURABLE_KEYS:
        raise ValueError(f"Unknown setting key: {key}")

    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    existing = result.scalar_one_or_none()

    if existing:
        existing.value = value
        existing.updated_at = datetime.now(timezone.utc)
        existing.updated_by = user_id
    else:
        db.add(SystemSetting(
            key=key,
            value=value,
            updated_at=datetime.now(timezone.utc),
            updated_by=user_id,
        ))

    await db.commit()

    # Hot-reload: update the in-memory settings object
    attr = _ENV_MAP.get(key)
    if attr:
        current = getattr(settings, attr, None)
        if isinstance(current, bool):
            setattr(settings, attr, value.lower() in ("true", "1", "yes"))
        elif isinstance(current, int):
            setattr(settings, attr, int(value))
        elif isinstance(current, float):
            setattr(settings, attr, float(value))
        else:
            setattr(settings, attr, value)

    # Reinitialize llm_client if LLM credentials changed
    if key in ("qwen_api_key", "llm_base_url", "llm_model"):
        from backend.services.llm_client import llm_client
        llm_client.__init__()
    # Reinitialize backup client if backup settings changed
    elif key in ("llm_backup_enabled", "llm_backup_base_url", "llm_backup_model", "llm_backup_api_key"):
        from backend.services.llm_client import llm_client
        llm_client._init_backup()


async def load_db_settings() -> None:
    """Load all DB settings into the in-memory settings object on startup."""
    from backend.core.database import async_session as _async_session
    async with _async_session() as db:
        result = await db.execute(select(SystemSetting))
        for row in result.scalars():
            attr = _ENV_MAP.get(row.key)
            if attr:
                current = getattr(settings, attr, None)
                if isinstance(current, bool):
                    setattr(settings, attr, row.value.lower() in ("true", "1", "yes"))
                elif isinstance(current, int):
                    setattr(settings, attr, int(row.value))
                elif isinstance(current, float):
                    setattr(settings, attr, float(row.value))
                else:
                    setattr(settings, attr, row.value)
    # Reinitialize llm_client with DB-loaded settings
    from backend.services.llm_client import llm_client
    llm_client.__init__()
    logger.info(
        "Loaded DB settings — LLM_MODEL=%s, LLM_BASE_URL=%s, RAG_TOP_K=%s, QWEN_API_KEY=%s...",
        settings.LLM_MODEL, settings.LLM_BASE_URL, settings.RAG_TOP_K,
        settings.QWEN_API_KEY[:15] if settings.QWEN_API_KEY else "empty",
    )
    # Verify llm_client was reinitialized correctly
    logger.info(
        "llm_client reinit — model=%s, base_url=%s",
        llm_client.model, str(llm_client.client.base_url),
    )


async def get_all_settings(db: AsyncSession) -> list[dict]:
    result = await db.execute(select(SystemSetting))
    db_settings = {s.key: s for s in result.scalars().all()}

    items = []
    for key in sorted(CONFIGURABLE_KEYS):
        if key in db_settings:
            row = db_settings[key]
            items.append({
                "key": key,
                "value": _mask_value(key, row.value),
                "source": "db",
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            })
        else:
            env_val = _get_env_value(key)
            items.append({
                "key": key,
                "value": _mask_value(key, env_val),
                "source": "env",
                "updated_at": None,
            })

    return items
