import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import select

from backend.core.config import settings
from backend.core.database import engine, Base, async_session
# Import all models to register with Base.metadata before create_all
from backend.models.user import User  # noqa: F401
from backend.models.notebook import Notebook  # noqa: F401
from backend.models.source import Source  # noqa: F401
from backend.models.chat_message import ChatMessage  # noqa: F401
from backend.models.saved_note import SavedNote  # noqa: F401
from backend.models.notebook_member import NotebookMember  # noqa: F401
from backend.models.invite_link import InviteLink  # noqa: F401
from backend.models.system_setting import SystemSetting  # noqa: F401
from backend.models.feedback import Feedback  # noqa: F401
from backend.api import auth, notebooks, sources, chat, notes, studio, sharing, overview, admin, asr, feedback

logger = logging.getLogger(__name__)


async def bootstrap_admin():
    """Promote ADMIN_EMAIL user to admin on startup."""
    if not settings.ADMIN_EMAIL:
        return
    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.email == settings.ADMIN_EMAIL)
        )
        user = result.scalar_one_or_none()
        if user and not user.is_admin:
            user.is_admin = True
            await db.commit()
            logger.info(f"Promoted {settings.ADMIN_EMAIL} to admin")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup (dev only; use Alembic in production)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await bootstrap_admin()

    # Recover sources stuck in processing states after restart
    from backend.services.document_pipeline import recover_stuck_sources
    try:
        logger.info("Running stuck source recovery...")
        await recover_stuck_sources()
        logger.info("Stuck source recovery complete")
    except Exception as e:
        logger.error("Failed to recover stuck sources: %s", e, exc_info=True)

    # MinerU warmup disabled — using RAGFlow built-in parser instead

    # Initialize ASR service
    from backend.services.asr_service import asr_service
    asr_service.configure(
        app_id=settings.VOLCENGINE_ASR_APPID,
        access_token=settings.VOLCENGINE_ASR_ACCESS_KEY,
        public_base_url=settings.PUBLIC_BASE_URL,
    )

    yield


app = FastAPI(title="Noteflow API", version="0.1.0", lifespan=lifespan)

app.include_router(auth.router, prefix="/api")
app.include_router(notebooks.router, prefix="/api")
app.include_router(sources.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(studio.router, prefix="/api")
app.include_router(studio.ppt_router, prefix="/api")
app.include_router(sharing.router, prefix="/api")
app.include_router(overview.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(asr.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
