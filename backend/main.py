from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.core.database import engine, Base
# Import all models to register with Base.metadata before create_all
from backend.models.user import User  # noqa: F401
from backend.models.notebook import Notebook  # noqa: F401
from backend.models.source import Source  # noqa: F401
from backend.models.chat_message import ChatMessage  # noqa: F401
from backend.models.saved_note import SavedNote  # noqa: F401
from backend.models.notebook_member import NotebookMember  # noqa: F401
from backend.models.invite_link import InviteLink  # noqa: F401
from backend.api import auth, notebooks, sources, chat, notes, studio, sharing, overview


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup (dev only; use Alembic in production)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="Noteflow API", version="0.1.0", lifespan=lifespan)

app.include_router(auth.router, prefix="/api")
app.include_router(notebooks.router, prefix="/api")
app.include_router(sources.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(studio.router, prefix="/api")
app.include_router(sharing.router, prefix="/api")
app.include_router(overview.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
