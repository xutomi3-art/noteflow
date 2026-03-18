"""Background health monitor — checks services periodically and emails alerts on failure.

Also monitors host CPU/memory and per-container resource usage, alerting when
thresholds are exceeded for consecutive checks.
"""

import asyncio
import logging
from datetime import datetime, timezone

from backend.core.database import async_session
from backend.services import admin_service, settings_service
from backend.services.email_service import (
    is_email_configured,
    send_health_alert_email,
    send_resource_alert_email,
)

logger = logging.getLogger(__name__)

# Track consecutive failures per service (only alert after 2 in a row)
_failure_counts: dict[str, int] = {}
# Track which services we already alerted on (don't spam)
_alerted: set[str] = set()

# Resource monitoring state
_resource_breach_counts: dict[str, int] = {}
_resource_alerted: set[str] = set()

ALERT_THRESHOLD = 2  # consecutive failures before sending alert

# Default resource thresholds (can be overridden via admin settings)
DEFAULT_CPU_THRESHOLD = 90  # percent
DEFAULT_MEMORY_THRESHOLD = 90  # percent
DEFAULT_DISK_THRESHOLD = 90  # percent
DEFAULT_CONTAINER_CPU_THRESHOLD = 80  # percent
DEFAULT_CONTAINER_MEMORY_THRESHOLD = 85  # percent


async def _get_thresholds(db) -> dict:
    """Read resource thresholds from settings, falling back to defaults."""
    cpu = await settings_service.get_setting(db, "resource_cpu_threshold")
    mem = await settings_service.get_setting(db, "resource_memory_threshold")
    disk = await settings_service.get_setting(db, "resource_disk_threshold")
    c_cpu = await settings_service.get_setting(db, "resource_container_cpu_threshold")
    c_mem = await settings_service.get_setting(db, "resource_container_memory_threshold")
    return {
        "cpu": int(cpu) if cpu else DEFAULT_CPU_THRESHOLD,
        "memory": int(mem) if mem else DEFAULT_MEMORY_THRESHOLD,
        "disk": int(disk) if disk else DEFAULT_DISK_THRESHOLD,
        "container_cpu": int(c_cpu) if c_cpu else DEFAULT_CONTAINER_CPU_THRESHOLD,
        "container_memory": int(c_mem) if c_mem else DEFAULT_CONTAINER_MEMORY_THRESHOLD,
    }


async def _check_resources(alert_email: str) -> None:
    """Check host and container resources, send alerts if thresholds breached."""
    async with async_session() as db:
        thresholds = await _get_thresholds(db)

    # Collect host metrics (runs psutil.cpu_percent with 1s interval in thread)
    host = await asyncio.to_thread(admin_service.get_host_resources)

    # Collect container metrics
    containers = await admin_service.get_container_resources()

    breaches: list[dict] = []

    # Check host CPU
    _check_metric(
        "host_cpu", host["cpu_percent"], thresholds["cpu"],
        f"Host CPU: {host['cpu_percent']}% (threshold: {thresholds['cpu']}%)",
        breaches,
    )
    # Check host memory
    _check_metric(
        "host_memory", host["memory_percent"], thresholds["memory"],
        f"Host Memory: {host['memory_percent']}% — {host['memory_used_gb']}GB / {host['memory_total_gb']}GB (threshold: {thresholds['memory']}%)",
        breaches,
    )
    # Check host disk
    _check_metric(
        "host_disk", host["disk_percent"], thresholds["disk"],
        f"Host Disk: {host['disk_percent']}% — {host['disk_used_gb']}GB / {host['disk_total_gb']}GB (threshold: {thresholds['disk']}%)",
        breaches,
    )

    # Check per-container metrics
    for c in containers:
        key_cpu = f"container_cpu_{c['name']}"
        key_mem = f"container_mem_{c['name']}"

        _check_metric(
            key_cpu, c["cpu_percent"], thresholds["container_cpu"],
            f"Container {c['name']} CPU: {c['cpu_percent']}% (threshold: {thresholds['container_cpu']}%)",
            breaches,
        )
        _check_metric(
            key_mem, c["memory_percent"], thresholds["container_memory"],
            f"Container {c['name']} Memory: {c['memory_percent']}% — {c['memory_mb']}MB (threshold: {thresholds['container_memory']}%)",
            breaches,
        )

    if breaches:
        try:
            await send_resource_alert_email(alert_email, breaches, host, containers)
            logger.warning(
                "Resource alert sent to %s: %s",
                alert_email,
                [b["metric"] for b in breaches],
            )
        except Exception as e:
            logger.error("Failed to send resource alert: %s", e)

    # Log recoveries
    recovered = [
        k for k in list(_resource_alerted)
        if k not in {b.get("_key") for b in breaches}
        and _resource_breach_counts.get(k, 0) == 0
    ]
    for k in recovered:
        _resource_alerted.discard(k)
        logger.info("Resource recovered: %s", k)


def _check_metric(
    key: str, value: float, threshold: int, description: str, breaches: list[dict]
) -> None:
    """Track consecutive breaches for a resource metric."""
    if value >= threshold:
        _resource_breach_counts[key] = _resource_breach_counts.get(key, 0) + 1
        if _resource_breach_counts[key] >= ALERT_THRESHOLD and key not in _resource_alerted:
            breaches.append({"metric": key, "description": description, "_key": key})
            _resource_alerted.add(key)
    else:
        if key in _resource_alerted:
            _resource_alerted.discard(key)
        _resource_breach_counts[key] = 0


async def _run_check() -> None:
    """Run one health check cycle."""
    async with async_session() as db:
        alert_email = await settings_service.get_setting(db, "alert_email")

    if not alert_email or not is_email_configured():
        return

    # Service health checks (existing)
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

    # Resource checks (new)
    try:
        await _check_resources(alert_email)
    except Exception as e:
        logger.error("Resource check failed: %s", e)


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
