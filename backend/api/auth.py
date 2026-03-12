from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.database import get_db
from backend.core.deps import get_current_user
from backend.core.security import create_access_token, create_refresh_token
from backend.models.user import User
from backend.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, RefreshRequest, UserResponse
from backend.services import auth_service
from backend.services import google_auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    try:
        user = await auth_service.register(db, req)
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
        return RedirectResponse(url=f"{settings.APP_BASE_URL}/login?error=google_failed")
