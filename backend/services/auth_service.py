from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from backend.models.user import User
from backend.schemas.auth import RegisterRequest, LoginRequest, TokenResponse


async def register(db: AsyncSession, req: RegisterRequest) -> User:
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise ValueError("Email already registered")

    user = User(
        email=req.email,
        name=req.name,
        password_hash=hash_password(req.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def login(db: AsyncSession, req: LoginRequest) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if user and not user.password_hash:
        raise ValueError("This account uses Google sign-in. Please use the Google button.")
    if not user or not verify_password(req.password, user.password_hash):
        raise ValueError("Invalid email or password")

    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


async def find_or_create_google_user(db: AsyncSession, google_id: str, email: str, name: str, avatar: str | None) -> User:
    """Find or create a user for Google OAuth sign-in."""
    # 1. Lookup by google_id first
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()
    if user:
        return user

    # 2. Lookup by email — link existing local account to Google
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        user.google_id = google_id
        user.auth_provider = "google"
        if avatar and not user.avatar:
            user.avatar = avatar
        await db.commit()
        await db.refresh(user)
        return user

    # 3. Create new Google-only user
    user = User(
        email=email,
        name=name,
        password_hash=None,
        avatar=avatar,
        google_id=google_id,
        auth_provider="google",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def refresh_tokens(db: AsyncSession, refresh_token: str) -> TokenResponse:
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise ValueError("Invalid refresh token")

    user_id = payload["sub"]
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("User not found")

    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )
