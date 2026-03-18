"""Background health monitor — checks services periodically and emails alerts on failure."""

import asyncio
import logging
from datetime import datetime, timezone

from backend.core.database import async_session
from backend.services import admin_service, settings_service
from backend.services.email_service import is_email_configured, send_health_alert_email

logger = logging.getLogger(__name__)

# Track consecutive failures per service (only alert after 2 in a row)
_failure_counts: dict[str, int] = {}
# Track which services we already alerted on (don't spam)
_alerted: set[str] = set()

ALERT_THRESHOLD = 2  # consecutive failures before sending alert


async def _run_check() -> None:
    """Run one health check cycle."""
    async with async_session() as db:
        alert_email = await settings_service.get_setting(db, "alert_email")

    if not alert_email or not is_email_configured():
        return

    async with async_session() as db:
        services = await admin_service.check_service_health(db)

    newly_failed: list[dict] = []
    recovered: list[str] = []

    for name, info in services.items():
        if info["status"] == "error":
            _failure_counts[name] = _failure_counts.get(name, 0) + 1
            if _failure_counts[name] >= ALERT_THRESHOLD and name not in _alerted:
                newly_failed.append({"name": name, "message": info.get("message", "unreachable")})
                _alerted.add(name)
        else:
            if name in _alerted:
                recovered.append(name)
                _alerted.discard(name)
            _failure_counts[name] = 0

    if newly_failed:
        try:
            await send_health_alert_email(alert_email, newly_failed)
            logger.warning("Health alert sent to %s: %s", alert_email, [s["name"] for s in newly_failed])
        except Exception as e:
            logger.error("Failed to send health alert: %s", e)

    if recovered:
        logger.info("Services recovered: %s", recovered)


async def start_monitor() -> None:
    """Start the background health monitor loop."""
    logger.info("Health monitor started")
    # Wait 60s after startup before first check (let services stabilize)
    await asyncio.sleep(60)

    while True:
        try:
            # Read interval from settings each cycle (can be changed at runtime)
            async with async_session() as db:
                interval_str = await settings_service.get_setting(db, "alert_check_interval_minutes")
            interval = max(int(interval_str or "5"), 1) * 60
        except Exception:
            interval = 300  # 5 min default

        try:
            await _run_check()
        except Exception as e:
            logger.error("Health monitor check failed: %s", e)

        await asyncio.sleep(interval)
