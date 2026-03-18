"""Shared test fixtures for Noteflow backend tests.

Uses an in-memory SQLite database so tests are fast and don't need PostgreSQL.
Patches PostgreSQL-specific types (JSONB, UUID, DateTime) to SQLite equivalents.
"""
from __future__ import annotations

import atexit
import os
import shutil
import sys
import tempfile
import uuid

import pytest

# ---------------------------------------------------------------------------
# Environment setup (must happen before any app imports)
# ---------------------------------------------------------------------------
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only")
os.environ.setdefault("ADMIN_EMAIL", "")

_test_upload_dir = tempfile.mkdtemp(prefix="noteflow_test_uploads_")
os.environ["UPLOAD_DIR"] = _test_upload_dir
atexit.register(shutil.rmtree, _test_upload_dir, ignore_errors=True)

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------
TEST_PASSWORD = "ValidPass1"
NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000"

# ---------------------------------------------------------------------------
# Skip entire test collection on Python < 3.10
# (models use `X | Y` union syntax which requires 3.10+)
# ---------------------------------------------------------------------------
pytestmark = pytest.mark.skipif(
    sys.version_info < (3, 10),
    reason="Backend tests require Python 3.10+ (model type syntax)",
)

# ---------------------------------------------------------------------------
# App-level fixtures (only defined when Python can actually import the app)
# ---------------------------------------------------------------------------
if sys.version_info >= (3, 10):
    import pytest_asyncio
    from datetime import datetime, timezone
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import JSON, DateTime, event, String, TypeDecorator
    from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

    # Speed up bcrypt from ~150ms to ~2ms per hash in tests
    from passlib.context import CryptContext
    from unittest.mock import patch as _mock_patch
    _fast_pwd_ctx = CryptContext(schemes=["bcrypt"], bcrypt__rounds=4)
    _mock_patch("backend.core.security.pwd_context", _fast_pwd_ctx).start()

    # -- SQLite type adapters -----------------------------------------------

    class SQLiteUUID(TypeDecorator):
        """UUID stored as String(36) in SQLite with auto-conversion."""
        impl = String(36)
        cache_ok = True

        def process_bind_param(self, value, dialect):
            return str(value) if value is not None else value

        def process_result_value(self, value, dialect):
            if value is not None and not isinstance(value, uuid.UUID):
                return uuid.UUID(value)
            return value

    class SQLiteDateTime(TypeDecorator):
        """DateTime that ensures timezone-aware results from SQLite."""
        impl = DateTime()
        cache_ok = True

        def process_result_value(self, value, dialect):
            if value is not None and isinstance(value, datetime) and value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value

    # -- Import app after env + patches are ready ---------------------------

    from backend.core.database import Base, get_db
    from backend.main import app

    def _patch_pg_types_for_sqlite():
        """Replace PostgreSQL-specific column types with SQLite equivalents.

        Idempotent — safe to call multiple times.
        """
        for table in Base.metadata.tables.values():
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON()
                elif isinstance(column.type, PG_UUID):
                    column.type = SQLiteUUID()
                elif isinstance(column.type, DateTime) and getattr(column.type, "timezone", False):
                    column.type = SQLiteDateTime()

    # -- Database fixtures --------------------------------------------------

    @pytest_asyncio.fixture
    async def db_engine():
        """Create an in-memory SQLite engine and initialise all tables."""
        _patch_pg_types_for_sqlite()
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)

        @event.listens_for(engine.sync_engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, _):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        yield engine
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    @pytest_asyncio.fixture
    async def db_session(db_engine):
        session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
        async with session_factory() as session:
            yield session

    @pytest_asyncio.fixture
    async def client(db_engine):
        session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

        async def _override_get_db():
            async with session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = _override_get_db

        # Override module-level async_session used by background tasks
        import backend.core.database as db_module
        original_session = db_module.async_session
        db_module.async_session = session_factory

        # Mock process_document to avoid external service calls (RAGFlow, MinerU)
        import backend.api.sources as sources_module
        original_process = sources_module.process_document

        async def _noop_process_document(**kwargs):
            pass

        sources_module.process_document = _noop_process_document

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

        app.dependency_overrides.clear()
        db_module.async_session = original_session
        sources_module.process_document = original_process

    # -- Shared helpers -----------------------------------------------------

    async def register_user(client: AsyncClient, email: str | None = None) -> dict:
        """Register a user via API. Returns {"email", "password", "tokens", "headers"}."""
        email = email or f"test-{uuid.uuid4().hex[:8]}@noteflow.dev"
        payload = {"email": email, "name": email.split("@")[0], "password": TEST_PASSWORD}
        resp = await client.post("/api/auth/register", json=payload)
        assert resp.status_code == 200, resp.text
        tokens = resp.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        return {**payload, "tokens": tokens, "headers": headers}

    async def create_notebook(client: AsyncClient, headers: dict, name: str = "Test NB") -> str:
        """Create a notebook via API. Returns notebook ID."""
        resp = await client.post("/api/notebooks", json={"name": name}, headers=headers)
        assert resp.status_code == 200, resp.text
        return resp.json()["id"]

    # -- User fixtures (use the helpers above) ------------------------------

    @pytest_asyncio.fixture
    async def test_user(client: AsyncClient):
        return await register_user(client)

    @pytest_asyncio.fixture
    async def auth_headers(test_user):
        return test_user["headers"]
