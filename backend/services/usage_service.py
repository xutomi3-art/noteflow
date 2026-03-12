from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.chat_message import ChatMessage
from backend.models.source import Source
from backend.models.notebook import Notebook
from backend.models.user import User


async def get_usage_stats(db: AsyncSession, period_days: int = 7) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=period_days)

    # Total queries in period (user messages only)
    total_queries = (await db.execute(
        select(func.count(ChatMessage.id)).where(
            ChatMessage.role == "user",
            ChatMessage.created_at >= cutoff,
        )
    )).scalar() or 0

    # Document counts by status (all-time)
    docs_ready = (await db.execute(
        select(func.count(Source.id)).where(Source.status == "ready")
    )).scalar() or 0

    docs_failed = (await db.execute(
        select(func.count(Source.id)).where(Source.status == "failed")
    )).scalar() or 0

    # Total storage (all-time)
    total_storage_bytes = (await db.execute(
        select(func.coalesce(func.sum(Source.file_size), 0))
    )).scalar() or 0

    # Success rate
    total_processed = docs_ready + docs_failed
    success_rate = (docs_ready / total_processed * 100.0) if total_processed > 0 else 100.0

    # Queries per day in period
    qpd_rows = (await db.execute(
        select(
            cast(ChatMessage.created_at, Date).label("day"),
            func.count(ChatMessage.id).label("count"),
        )
        .where(
            ChatMessage.role == "user",
            ChatMessage.created_at >= cutoff,
        )
        .group_by(cast(ChatMessage.created_at, Date))
        .order_by(cast(ChatMessage.created_at, Date))
    )).all()
    queries_per_day = [{"date": str(row.day), "count": row.count} for row in qpd_rows]

    # Active (distinct) users per day in period
    apd_rows = (await db.execute(
        select(
            cast(ChatMessage.created_at, Date).label("day"),
            func.count(func.distinct(ChatMessage.user_id)).label("count"),
        )
        .where(
            ChatMessage.role == "user",
            ChatMessage.created_at >= cutoff,
        )
        .group_by(cast(ChatMessage.created_at, Date))
        .order_by(cast(ChatMessage.created_at, Date))
    )).all()
    active_users_per_day = [{"date": str(row.day), "count": row.count} for row in apd_rows]

    # Top 10 users by query count in period
    top_users_rows = (await db.execute(
        select(
            User.name,
            User.email,
            func.count(ChatMessage.id).label("query_count"),
        )
        .join(User, ChatMessage.user_id == User.id)
        .where(
            ChatMessage.role == "user",
            ChatMessage.created_at >= cutoff,
        )
        .group_by(User.id, User.name, User.email)
        .order_by(func.count(ChatMessage.id).desc())
        .limit(10)
    )).all()
    top_users = [
        {"name": row.name, "email": row.email, "query_count": row.query_count}
        for row in top_users_rows
    ]

    # Top 10 notebooks by source count (all-time)
    top_notebooks_rows = (await db.execute(
        select(
            Notebook.name,
            Notebook.emoji,
            func.count(Source.id).label("source_count"),
        )
        .join(Source, Source.notebook_id == Notebook.id)
        .group_by(Notebook.id, Notebook.name, Notebook.emoji)
        .order_by(func.count(Source.id).desc())
        .limit(10)
    )).all()
    top_notebooks = [
        {"name": row.name, "emoji": row.emoji, "source_count": row.source_count}
        for row in top_notebooks_rows
    ]

    return {
        "period_days": period_days,
        "total_queries": total_queries,
        "docs_ready": docs_ready,
        "docs_failed": docs_failed,
        "total_storage_bytes": int(total_storage_bytes),
        "success_rate": round(success_rate, 1),
        "queries_per_day": queries_per_day,
        "active_users_per_day": active_users_per_day,
        "top_users": top_users,
        "top_notebooks": top_notebooks,
    }
