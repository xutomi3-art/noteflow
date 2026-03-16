from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from backend.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "access"},
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "refresh"},
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def decode_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def create_password_reset_token(user_id: str, password_hash: str) -> str:
    """Create a short-lived password reset token. Uses last 8 chars of password hash as
    part of the signing secret so the token auto-invalidates after a successful reset."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    secret = settings.JWT_SECRET_KEY + password_hash[-8:]
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "password_reset"},
        secret,
        algorithm=settings.JWT_ALGORITHM,
    )


def decode_password_reset_token(token: str, password_hash: str) -> str | None:
    """Decode and verify a password reset token. Returns user_id or None if invalid."""
    try:
        secret = settings.JWT_SECRET_KEY + password_hash[-8:]
        payload = jwt.decode(token, secret, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("type") != "password_reset":
            return None
        return payload.get("sub")
    except JWTError:
        return None
