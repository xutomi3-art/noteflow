import logging

from fastapi import APIRouter, Depends, HTTPException
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
from backend.schemas.notebook import NotebookCreate

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    try:
        user = await auth_service.register(db, req)

        # Create default starter notebooks for new users
        # "Getting Started" is created LAST so it has the newest updated_at and appears first
        default_notebooks = [
            {"name": "Meeting Notes", "emoji": "📋", "cover_color": "#fef08a"},
            {"name": "My Research", "emoji": "🔬", "cover_color": "#dbeafe"},
            {"name": "Getting Started", "emoji": "🚀", "cover_color": "#ecfccb"},
        ]
        for nb_data in default_notebooks:
            try:
                nb = await create_notebook(
                    db,
                    owner_id=user.id,
                    req=NotebookCreate(**nb_data),
                )
                # Populate "Getting Started" with welcome content
                if nb_data["name"] == "Getting Started":
                    welcome_notes = [
                        "**Welcome to Noteflow!** 🎉\n\nNoteflow is your AI-powered knowledge base. Upload documents (PDF, DOCX, PPTX, TXT, Excel) and ask questions — AI will answer with citations pointing to the exact source.",
                        "**Quick Start Guide:**\n\n1. Click **Add Sources** on the left to upload documents\n2. Select sources to chat with using the checkboxes\n3. Ask questions in the **Chat** panel — AI responds with inline citations [1][2]\n4. Use **Studio** on the right to generate Summaries, FAQs, Mind Maps, and Slide Decks\n5. Save important answers as **Notes** for quick reference",
                        "**Tips & Tricks:**\n\n- Upload multiple file types together (PDF + Excel + TXT) for cross-document Q&A\n- Click on citation numbers [1] to jump to the source excerpt\n- Use **Share with Team** to collaborate with others on the same notebook\n- Try the **Think** button for deeper, step-by-step reasoning on complex questions",
                    ]
                    for note_content in welcome_notes:
                        try:
                            await create_note(db, nb.id, note_content)
                        except Exception:
                            pass
            except Exception:
                logger.warning("Failed to create default notebook '%s' for user %s", nb_data["name"], user.id)

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
async def google_callback(code: str = "", error: str = "", db: AsyncSession = Depends(get_db)):
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

        user = await auth_service.find_or_create_google_user(db, google_id, email, name, avatar)

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
async def microsoft_callback(code: str = "", error: str = "", db: AsyncSession = Depends(get_db)):
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

        user = await auth_service.find_or_create_microsoft_user(db, microsoft_id, email, name, avatar)

        access_token = create_access_token(str(user.id))
        refresh_token = create_refresh_token(str(user.id))

        return RedirectResponse(
            url=f"{settings.APP_BASE_URL}/auth/callback?token={access_token}&refresh={refresh_token}"
        )
    except Exception:
        logger.exception("Microsoft OAuth callback failed")
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=microsoft_failed")
