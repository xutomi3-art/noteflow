"""Migrate from per-notebook to per-user RAGFlow datasets.

For each user who has notebooks with ragflow_dataset_id:
1. Pick the first dataset as the user's primary dataset
2. Set users.ragflow_dataset_id to that dataset

Existing sources keep their original ragflow_dataset_id/ragflow_doc_id
unchanged (documents are already indexed there). The retrieval code
reads dataset_ids from sources, so old data continues to work.

New uploads will go to the user's single dataset.

Usage:
    cd /opt/noteflow
    docker compose exec backend python -m backend.scripts.migrate_per_user_dataset
"""
import asyncio
import logging
import sys

from sqlalchemy import select, text

from backend.core.database import async_session
from backend.models.user import User
from backend.models.notebook import Notebook

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def migrate() -> None:
    async with async_session() as db:
        # Find all users who have notebooks with ragflow datasets
        result = await db.execute(
            text("""
                SELECT DISTINCT n.owner_id,
                    (SELECT n2.ragflow_dataset_id
                     FROM notebooks n2
                     WHERE n2.owner_id = n.owner_id
                       AND n2.ragflow_dataset_id IS NOT NULL
                     ORDER BY n2.created_at ASC
                     LIMIT 1) AS first_dataset_id
                FROM notebooks n
                WHERE n.ragflow_dataset_id IS NOT NULL
            """)
        )
        rows = result.fetchall()
        logger.info("Found %d users with RAGFlow datasets to migrate", len(rows))

        migrated = 0
        skipped = 0
        for owner_id, first_dataset_id in rows:
            if not first_dataset_id:
                continue

            user_result = await db.execute(select(User).where(User.id == owner_id))
            user = user_result.scalar_one_or_none()
            if user is None:
                logger.warning("User %s not found, skipping", owner_id)
                skipped += 1
                continue

            if user.ragflow_dataset_id:
                logger.info("User %s already has dataset %s, skipping", user.email, user.ragflow_dataset_id)
                skipped += 1
                continue

            user.ragflow_dataset_id = first_dataset_id
            migrated += 1
            logger.info("User %s -> dataset %s", user.email, first_dataset_id)

        await db.commit()
        logger.info("Migration complete: %d migrated, %d skipped", migrated, skipped)

        # Stats
        total_users = (await db.execute(text("SELECT count(*) FROM users"))).scalar()
        users_with_ds = (await db.execute(
            text("SELECT count(*) FROM users WHERE ragflow_dataset_id IS NOT NULL")
        )).scalar()
        total_notebooks = (await db.execute(text("SELECT count(*) FROM notebooks"))).scalar()
        notebooks_with_ds = (await db.execute(
            text("SELECT count(*) FROM notebooks WHERE ragflow_dataset_id IS NOT NULL")
        )).scalar()
        logger.info(
            "Stats: %d/%d users have dataset, %d/%d notebooks have dataset",
            users_with_ds, total_users, notebooks_with_ds, total_notebooks,
        )


if __name__ == "__main__":
    asyncio.run(migrate())
