import os

import httpx
from urllib.parse import urlencode
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

# SOCKS5 proxy for servers that cannot reach Google directly (e.g. China mainland)
GOOGLE_PROXY = os.getenv("GOOGLE_PROXY", "")


async def get_google_config(db: AsyncSession) -> tuple[str, str, str]:
    """Get Google OAuth config from DB settings or env fallback."""
    from backend.services.settings_service import get_setting
    client_id = await get_setting(db, "google_client_id") or settings.GOOGLE_CLIENT_ID
    client_secret = await get_setting(db, "google_client_secret") or settings.GOOGLE_CLIENT_SECRET
    redirect_uri = await get_setting(db, "google_redirect_uri") or settings.GOOGLE_REDIRECT_URI
    return client_id, client_secret, redirect_uri


def build_google_auth_url(client_id: str, redirect_uri: str) -> str:
    """Build Google OAuth consent URL."""
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def _http_client() -> httpx.AsyncClient:
    """Create an httpx client, optionally with SOCKS5 proxy."""
    kwargs: dict = {"timeout": 30.0}
    if GOOGLE_PROXY:
        kwargs["proxy"] = GOOGLE_PROXY
    return httpx.AsyncClient(**kwargs)


async def exchange_code_for_tokens(code: str, client_id: str, client_secret: str, redirect_uri: str) -> dict:
    """Exchange authorization code for Google tokens."""
    async with _http_client() as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
        resp.raise_for_status()
        return resp.json()


async def get_google_user_info(access_token: str) -> dict:
    """Fetch user profile from Google."""
    async with _http_client() as client:
        resp = await client.get(GOOGLE_USERINFO_URL, headers={
            "Authorization": f"Bearer {access_token}",
        })
        resp.raise_for_status()
        return resp.json()
