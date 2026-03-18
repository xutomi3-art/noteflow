import json
import logging
import os
import shutil
import uuid as _uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from sqlalchemy import select

from backend.core.config import settings
from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.core.security import create_access_token, create_refresh_token, create_password_reset_token, decode_password_reset_token, hash_password
from backend.models.user import User
from backend.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, RefreshRequest, UserResponse, ForgotPasswordRequest, ResetPasswordRequest
from backend.services import auth_service
from backend.services import google_auth_service
from backend.services import microsoft_auth_service
from backend.services.email_service import is_smtp_configured, send_password_reset_email
from backend.services.notebook_service import create_notebook
from backend.services.note_service import create_note
from backend.services.source_service import create_source
from backend.services.document_pipeline import process_document
from backend.schemas.notebook import NotebookCreate

router = APIRouter(prefix="/auth", tags=["auth"])


_DEMO_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "demo")

_DEFAULT_NOTEBOOKS = [
    # Order: last created appears first on dashboard
    {
        "name": "My Research", "emoji": "🔬", "cover_color": "#dbeafe",
        "sources": [
            "ai-education-research-report.md",
            "ai-education-cost-analysis.xlsx",
            "ai-in-education-overview.md",
        ],
        "notes": [
            "## Key Findings: AI in Education\n\n- Global AI in Education market: **$5.1B (2024) → $47.7B (2030)**, 36% CAGR\n- Content generation & language learning are the fastest growing segments (40%+ CAGR)\n- **73% of universities** plan to deploy AI teaching assistants by 2027\n- AI tutoring shows **18% improvement** in test scores and **25% reduction** in dropout rates\n- Main barriers: data privacy (FERPA/GDPR), academic integrity concerns, faculty readiness (only 34% feel prepared)\n\n> Source: AI Education Research Report, March 2026",
            "## Budget Summary: AI Implementation\n\n| Category | Cost |\n|----------|------|\n| Infrastructure | $10,200 |\n| Software & APIs | $19,200 |\n| Personnel | $99,000 |\n| Training | $13,000 |\n| Contingency (15%) | $21,060 |\n| **Total Year 1** | **$162,460** |\n\nROI breakeven in **Year 2**. By Year 5: cumulative benefit of **$610,540** (3.8x return).\n\n> Source: Cost Analysis Spreadsheet",
        ],
        "overview": {
            "overview": "These documents analyze the AI in Education market landscape, covering market size projections, implementation costs, and strategic recommendations. They include a research report with industry trends, a detailed cost-benefit analysis spreadsheet, and an overview of AI applications in educational settings.",
            "suggested_questions": [
                "What is the projected market size for AI in Education by 2030?",
                "What are the main cost categories for implementing AI in education?",
                "What are the biggest barriers to AI adoption in universities?"
            ],
        },
    },
    {
        "name": "Meeting Notes", "emoji": "📋", "cover_color": "#fef08a",
        "sources": [
            "meeting-2026-03-03-kickoff.md",
            "meeting-2026-03-10-review.md",
            "meeting-2026-03-17-approval.md",
        ],
        "notes": [
            "## FY2026 Budget Approved: $4.425M\n\n**Key numbers:**\n- Personnel (existing): $2.16M (48.8%)\n- New hires (4 positions): $680K (15.4%)\n- AI/ML infrastructure: $312K (7.0%)\n- Cloud infrastructure: $368K (8.3%)\n- Contingency: $230K (5.2%)\n\n**Conditions:**\n1. Quarterly budget reviews with variance analysis\n2. AI ROI dashboard by end of Q1\n3. Monthly hiring progress reports\n\n> Approved by CEO Michael Zhou on March 17, 2026",
            "## Open Action Items\n\n| Owner | Task | Due |\n|-------|------|-----|\n| Kevin | Negotiate AI API volume discount | Mar 17 |\n| Rachel | Extend offers to ML engineer candidates | Mar 21 |\n| Tony | AI infrastructure provisioned | Mar 25 |\n| Tony | Cost monitoring dashboards live | Mar 28 |\n| Sarah | Q1 review meeting | Jun 15 |\n\n**Next milestone:** Budget codes activated by Mar 20",
        ],
        "overview": {
            "overview": "These documents outline the planning and approval process for the FY2026 engineering budget, tracking from initial kickoff through detailed review to final CEO approval. The total approved budget is $4.425M covering personnel, infrastructure, AI/ML initiatives, and new hires.",
            "suggested_questions": [
                "What is the total approved budget for FY2026?",
                "What new positions were approved in the budget?",
                "What are the conditions attached to the budget approval?"
            ],
        },
    },
    {
        "name": "Getting Started", "emoji": "🚀", "cover_color": "#ecfccb",
        "sources": [
            "noteflow-user-manual.md",
        ],
        "notes": [
            "## Welcome to Noteflow!\n\nNoteflow is your AI-powered knowledge base. Upload documents, ask questions, and get answers with source citations.\n\n### Quick Start\n1. **Add Sources** — Upload PDF, Word, Excel, images, or paste a URL\n2. **Ask Questions** — Select documents and chat with AI\n3. **Use Studio** — One-click Summary, FAQ, Mind Map, Podcast\n4. **Collaborate** — Share notebooks with your team",
            "## Frequently Asked Questions\n\n**Q: What file formats are supported?**\nA: PDF, DOCX, PPTX, XLSX, CSV, TXT, Markdown, and images (JPG, PNG, WebP with OCR).\n\n**Q: How do I share a notebook with my team?**\nA: Click \"Share with Team\" → invite by email or generate a link → set roles (Owner/Editor/Viewer).\n\n**Q: Can I query multiple documents at once?**\nA: Yes! Select multiple sources and ask cross-document questions. AI correlates information and cites each source.\n\n**Q: Is my data secure?**\nA: All files are stored on your private server. Supports Docker deployment, HTTPS encryption, and Google/Microsoft SSO.",
        ],
        "overview": {
            "overview": "This is the Noteflow user manual — your guide to getting started with the AI-powered knowledge base. Learn how to upload documents, ask questions with AI, use Studio tools, and collaborate with your team.",
            "suggested_questions": [
                "What file formats does Noteflow support?",
                "How do I share a notebook with my team?",
                "What can I do with Studio tools?"
            ],
        },
    },
]


async def _save_static_overviews(notebook_overview_pairs: list[tuple[str, dict]]) -> None:
    """Save pre-written overview cache for demo notebooks (no LLM call needed)."""
    from backend.core.database import async_session
    from backend.api.overview import _get_ready_sources, _compute_source_hash
    from backend.models.notebook import Notebook
    import json

    async with async_session() as db:
        for nb_id_str, overview_data in notebook_overview_pairs:
            try:
                nb_uuid = _uuid.UUID(nb_id_str)
                sources = await _get_ready_sources(db, nb_uuid)
                source_hash = _compute_source_hash(sources) if sources else "demo"

                nb_result = await db.execute(select(Notebook).where(Notebook.id == nb_uuid))
                notebook = nb_result.scalar_one_or_none()
                if notebook:
                    notebook.overview_cache = json.dumps(overview_data)
                    notebook.overview_source_hash = source_hash
                    await db.commit()
                    logger.info("Saved static overview for notebook %s", nb_id_str)
            except Exception:
                logger.warning("Failed to save static overview for notebook %s", nb_id_str)


async def _bump_notebook_updated_at(notebook_id: str) -> None:
    """Bump a notebook's updated_at to now (run as background task after all sources processed)."""
    from backend.core.database import async_session
    from backend.models.notebook import Notebook
    from datetime import datetime, timezone
    async with async_session() as db:
        result = await db.execute(select(Notebook).where(Notebook.id == _uuid.UUID(notebook_id)))
        nb = result.scalar_one_or_none()
        if nb:
            nb.updated_at = datetime.now(timezone.utc)
            await db.commit()


async def _create_default_notebooks(db: AsyncSession, user: User, background_tasks: BackgroundTasks | None = None) -> None:
    """Create default starter notebooks with demo sources, notes for a new user."""
    source_tasks: list[tuple[str, str, str, str, str]] = []  # (source_id, notebook_id, file_path, filename, file_type)
    getting_started_id: str | None = None

    for nb_data in _DEFAULT_NOTEBOOKS:
        try:
            nb = await create_notebook(
                db,
                owner_id=user.id,
                req=NotebookCreate(name=nb_data["name"], emoji=nb_data["emoji"], cover_color=nb_data["cover_color"]),
            )
            nb_id = str(nb.id)

            # Write static overview immediately (no LLM, no background task)
            if nb_data.get("overview"):
                nb.overview_cache = json.dumps(nb_data["overview"])
                nb.overview_source_hash = "_demo_"  # Special hash: only invalidated when user uploads NEW sources
                await db.commit()

            if nb_data["name"] == "Getting Started":
                getting_started_id = nb_id

            # Create demo sources
            for filename in nb_data.get("sources", []):
                try:
                    src_path = os.path.join(_DEMO_DIR, filename)
                    if not os.path.isfile(src_path):
                        continue

                    upload_dir = os.path.join(settings.UPLOAD_DIR, nb_id)
                    os.makedirs(upload_dir, exist_ok=True)

                    source_id = str(_uuid.uuid4())
                    ext = os.path.splitext(filename)[1]
                    dest_path = os.path.join(upload_dir, f"{source_id}{ext}")
                    shutil.copy2(src_path, dest_path)

                    file_type = ext.lstrip(".").lower()
                    if file_type in ("xls",):
                        file_type = "xlsx"

                    source = await create_source(
                        db,
                        notebook_id=nb.id,
                        uploaded_by=user.id,
                        filename=filename,
                        file_type=file_type,
                        file_size=os.path.getsize(dest_path),
                        storage_url=dest_path,
                    )
                    source_tasks.append((str(source.id), nb_id, dest_path, filename, file_type))
                except Exception:
                    logger.warning("Failed to create demo source '%s' for user %s", filename, user.id)

            # Create notes
            for note_content in nb_data.get("notes", []):
                try:
                    await create_note(db, nb.id, note_content, user_id=user.id)
                except Exception:
                    pass
        except Exception:
            logger.warning("Failed to create default notebook '%s' for user %s", nb_data["name"], user.id)

    # Queue demo documents for background processing
    if background_tasks:
        for sid, nid, fpath, fname, ftype in source_tasks:
            background_tasks.add_task(process_document, source_id=sid, notebook_id=nid, file_path=fpath, filename=fname, file_type=ftype)
        # Ensure Getting Started has the newest updated_at (appears first on dashboard)
        if getting_started_id:
            background_tasks.add_task(_bump_notebook_updated_at, getting_started_id)


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    try:
        user = await auth_service.register(db, req)
        await _create_default_notebooks(db, user, background_tasks)
        return await auth_service.login(db, LoginRequest(email=req.email, password=req.password))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await auth_service.login(db, req)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await auth_service.refresh_tokens(db, req.refresh_token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        avatar=user.avatar,
        is_admin=user.is_admin,
        auth_provider=user.auth_provider,
    )


@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Send a password reset email. Always returns 200 to avoid user enumeration."""
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if user and user.password_hash and is_smtp_configured():
        token = create_password_reset_token(str(user.id), user.password_hash)
        reset_url = f"{settings.APP_BASE_URL}/reset-password?token={token}"
        try:
            await send_password_reset_email(user.email, reset_url)
        except Exception:
            logger.exception("Failed to send password reset email to %s", user.email)
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Validate the reset token and update the user's password."""
    # We need to find the user without knowing their ID yet — decode the token's sub claim
    # by first doing a lightweight decode (no signature check) just to extract user_id,
    # then loading the user and re-verifying with the correct secret.
    from jose import jwt as _jwt
    try:
        unverified = _jwt.get_unverified_claims(req.token)
        user_id = unverified.get("sub")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    verified_id = decode_password_reset_token(req.token, user.password_hash)
    if not verified_id or verified_id != str(user.id):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.password_hash = hash_password(req.new_password)
    await db.commit()
    return {"message": "Password updated successfully."}


@router.get("/google")
async def google_login(db: AsyncSession = Depends(get_db)):
    """Redirect to Google OAuth consent screen."""
    client_id, _secret, redirect_uri = await google_auth_service.get_google_config(db)
    if not client_id or not redirect_uri:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured")
    url = google_auth_service.build_google_auth_url(client_id, redirect_uri)
    return RedirectResponse(url=url)


@router.get("/google/callback")
async def google_callback(background_tasks: BackgroundTasks, code: str = "", error: str = "", db: AsyncSession = Depends(get_db)):
    """Handle Google OAuth callback, exchange code, issue JWT, redirect to frontend."""
    if error or not code:
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=google_denied")

    try:
        client_id, client_secret, redirect_uri = await google_auth_service.get_google_config(db)
        tokens = await google_auth_service.exchange_code_for_tokens(code, client_id, client_secret, redirect_uri)
        user_info = await google_auth_service.get_google_user_info(tokens["access_token"])

        google_id = user_info.get("id") or user_info.get("sub")
        email = user_info.get("email")
        name = user_info.get("name") or email
        avatar = user_info.get("picture")

        if not google_id or not email:
            return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=google_missing_info")

        user, is_new = await auth_service.find_or_create_google_user(db, google_id, email, name, avatar)
        if is_new:
            await _create_default_notebooks(db, user, background_tasks)

        access_token = create_access_token(str(user.id))
        refresh_token = create_refresh_token(str(user.id))

        return RedirectResponse(
            url=f"{settings.APP_BASE_URL}/auth/callback?token={access_token}&refresh={refresh_token}"
        )
    except Exception:
        logger.exception("Google OAuth callback failed")
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=google_failed")


@router.get("/microsoft")
async def microsoft_login(db: AsyncSession = Depends(get_db)):
    """Redirect to Microsoft OAuth consent screen."""
    client_id, _secret, tenant_id, redirect_uri = await microsoft_auth_service.get_microsoft_config(db)
    if not client_id or not redirect_uri:
        raise HTTPException(status_code=503, detail="Microsoft OAuth is not configured")
    url = microsoft_auth_service.build_microsoft_auth_url(client_id, tenant_id, redirect_uri)
    return RedirectResponse(url=url)


@router.get("/microsoft/callback")
async def microsoft_callback(background_tasks: BackgroundTasks, code: str = "", error: str = "", db: AsyncSession = Depends(get_db)):
    """Handle Microsoft OAuth callback, exchange code, issue JWT, redirect to frontend."""
    if error or not code:
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=microsoft_denied")

    try:
        client_id, client_secret, tenant_id, redirect_uri = await microsoft_auth_service.get_microsoft_config(db)
        tokens = await microsoft_auth_service.exchange_code_for_tokens(code, client_id, client_secret, tenant_id, redirect_uri)
        user_info = await microsoft_auth_service.get_microsoft_user_info(tokens["access_token"])

        microsoft_id = user_info.get("id")
        email = user_info.get("mail") or user_info.get("userPrincipalName")
        name = user_info.get("displayName") or email
        avatar = None  # Microsoft Graph /me doesn't return avatar URL

        if not microsoft_id or not email:
            return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=microsoft_missing_info")

        user, is_new = await auth_service.find_or_create_microsoft_user(db, microsoft_id, email, name, avatar)
        if is_new:
            await _create_default_notebooks(db, user, background_tasks)

        access_token = create_access_token(str(user.id))
        refresh_token = create_refresh_token(str(user.id))

        return RedirectResponse(
            url=f"{settings.APP_BASE_URL}/auth/callback?token={access_token}&refresh={refresh_token}"
        )
    except Exception:
        logger.exception("Microsoft OAuth callback failed")
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=microsoft_failed")
