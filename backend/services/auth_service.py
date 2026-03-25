import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from backend.models.user import User
from backend.schemas.auth import RegisterRequest, LoginRequest, TokenResponse

logger = logging.getLogger(__name__)


def _normalize_email(email: str) -> str:
    """Normalize email to lowercase for case-insensitive matching."""
    return email.strip().lower()


async def register(db: AsyncSession, req: RegisterRequest) -> User:
    normalized_email = _normalize_email(req.email)
    existing = await db.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none():
        raise ValueError("Email already registered")

    user = User(
        email=normalized_email,
        name=req.name,
        password_hash=hash_password(req.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Auto-join notebooks where user has pending email invites
    await _auto_join_pending_invites(db, user)

    return user


async def login(db: AsyncSession, req: LoginRequest) -> TokenResponse:
    normalized_email = _normalize_email(req.email)
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    if user and not user.password_hash:
        provider = user.auth_provider.title()
        raise ValueError(f"This account uses {provider} sign-in. Please use the {provider} button.")
    if not user or not verify_password(req.password, user.password_hash):
        raise ValueError("Invalid email or password")

    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


async def find_or_create_google_user(db: AsyncSession, google_id: str, email: str, name: str, avatar: str | None) -> tuple[User, bool]:
    """Find or create a user for Google OAuth sign-in. Returns (user, is_new)."""
    normalized_email = _normalize_email(email)
    # 1. Lookup by google_id first
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()
    if user:
        return user, False

    # 2. Lookup by email — link existing local account to Google
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    if user:
        user.google_id = google_id
        user.auth_provider = "google"
        if avatar and not user.avatar:
            user.avatar = avatar
        await db.commit()
        await db.refresh(user)
        return user, False

    # 3. Create new Google-only user
    user = User(
        email=normalized_email,
        name=name,
        password_hash=None,
        avatar=avatar,
        google_id=google_id,
        auth_provider="google",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user, True


async def find_or_create_microsoft_user(db: AsyncSession, microsoft_id: str, email: str, name: str, avatar: str | None) -> tuple[User, bool]:
    """Find or create a user for Microsoft OAuth sign-in. Returns (user, is_new)."""
    normalized_email = _normalize_email(email)
    # 1. Lookup by microsoft_id first
    result = await db.execute(select(User).where(User.microsoft_id == microsoft_id))
    user = result.scalar_one_or_none()
    if user:
        return user, False

    # 2. Lookup by email — link existing account to Microsoft
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()
    if user:
        user.microsoft_id = microsoft_id
        if user.auth_provider == "local":
            user.auth_provider = "microsoft"
        if avatar and not user.avatar:
            user.avatar = avatar
        await db.commit()
        await db.refresh(user)
        return user, False

    # 3. Create new Microsoft-only user
    user = User(
        email=normalized_email,
        name=name,
        password_hash=None,
        avatar=avatar,
        microsoft_id=microsoft_id,
        auth_provider="microsoft",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user, True


async def _auto_join_pending_invites(db: AsyncSession, user: User) -> None:
    """Auto-join notebooks where user has pending email invites."""
    from backend.models.invite_link import InviteLink
    from backend.models.notebook import Notebook
    from backend.models.notebook_member import NotebookMember

    try:
        result = await db.execute(
            select(InviteLink).where(
                func.lower(InviteLink.email) == user.email.lower(),
                InviteLink.expires_at > datetime.now(timezone.utc),
            )
        )
        links = list(result.scalars().all())
        if not links:
            return

        for link in links:
            # Skip if already a member or owner
            is_owner = (await db.execute(
                select(Notebook).where(Notebook.id == link.notebook_id, Notebook.owner_id == user.id)
            )).scalar_one_or_none()
            if is_owner:
                continue

            is_member = (await db.execute(
                select(NotebookMember).where(
                    NotebookMember.notebook_id == link.notebook_id,
                    NotebookMember.user_id == user.id,
                )
            )).scalar_one_or_none()
            if is_member:
                continue

            db.add(NotebookMember(
                notebook_id=link.notebook_id,
                user_id=user.id,
                role=link.role,
            ))
            # Mark notebook as shared
            nb = (await db.execute(
                select(Notebook).where(Notebook.id == link.notebook_id)
            )).scalar_one_or_none()
            if nb and not nb.is_shared:
                nb.is_shared = True

            logger.info("Auto-joined user %s to notebook %s via pending invite", user.email, link.notebook_id)

        await db.commit()
    except Exception as e:
        logger.warning("Auto-join pending invites failed for %s: %s", user.email, e)


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
