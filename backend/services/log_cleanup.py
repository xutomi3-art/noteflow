"""Background task to delete chat logs older than the configured retention period."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete

from backend.core.config import settings
from backend.core.database import AsyncSessionLocal
from backend.models.chat_log import ChatLog

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL_HOURS = 24  # run once per day


async def _cleanup_old_logs() -> int:
    """Delete logs older than LOG_RETENTION_DAYS. Returns count deleted."""
    retention_days = settings.LOG_RETENTION_DAYS
    if retention_days <= 0:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            delete(ChatLog).where(ChatLog.created_at < cutoff)
        )
        await db.commit()
        return result.rowcount  # type: ignore[return-value]


async def start_log_cleanup() -> None:
    """Periodically clean up old chat logs."""
    # Wait 5 minutes after startup before first cleanup
    await asyncio.sleep(300)

    while True:
        try:
            deleted = await _cleanup_old_logs()
            if deleted:
                logger.info(
                    "Log cleanup: deleted %d logs older than %d days",
                    deleted,
                    settings.LOG_RETENTION_DAYS,
                )
        except Exception as e:
            logger.error("Log cleanup failed: %s", e, exc_info=True)

        await asyncio.sleep(CLEANUP_INTERVAL_HOURS * 3600)
