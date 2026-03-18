import os

import httpx
from urllib.parse import urlencode
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings

MICROSOFT_AUTH_URL_TEMPLATE = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
MICROSOFT_TOKEN_URL_TEMPLATE = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
MICROSOFT_GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me"

# SOCKS5 proxy for servers that cannot reach Microsoft directly
MICROSOFT_PROXY = os.getenv("MICROSOFT_PROXY", "")


async def get_microsoft_config(db: AsyncSession) -> tuple[str, str, str, str]:
    """Get Microsoft OAuth config from DB settings or env fallback.

    Returns (client_id, client_secret, tenant_id, redirect_uri).
    """
    from backend.services.settings_service import get_setting
    client_id = await get_setting(db, "microsoft_client_id") or settings.MICROSOFT_CLIENT_ID
    client_secret = await get_setting(db, "microsoft_client_secret") or settings.MICROSOFT_CLIENT_SECRET
    tenant_id = await get_setting(db, "microsoft_tenant_id") or settings.MICROSOFT_TENANT_ID
    redirect_uri = await get_setting(db, "microsoft_redirect_uri") or settings.MICROSOFT_REDIRECT_URI
    return client_id, client_secret, tenant_id, redirect_uri


def _resolve_tenant(tenant_id: str) -> str:
    """Force 'common' tenant to 'consumers' to avoid login.live.com redirect.

    When tenant=common, Microsoft routes personal accounts (@outlook, @live,
    @hotmail) through login.live.com, which triggers a redirect to
    ms-sso.copilot.microsoft.com for Copilot cookie sync. That domain is
    blocked in China (ERR_CONNECTION_RESET).

    Using tenant=consumers keeps the entire flow on login.microsoftonline.com.
    """
    if tenant_id in ("common", ""):
        return "consumers"
    return tenant_id


def build_microsoft_auth_url(client_id: str, tenant_id: str, redirect_uri: str) -> str:
    """Build Microsoft OAuth consent URL."""
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile User.Read",
        "response_mode": "query",
        "prompt": "select_account",
    }
    base_url = MICROSOFT_AUTH_URL_TEMPLATE.format(tenant=_resolve_tenant(tenant_id))
    return f"{base_url}?{urlencode(params)}"


def _http_client() -> httpx.AsyncClient:
    """Create an httpx client, optionally with SOCKS5 proxy."""
    kwargs: dict = {"timeout": 15.0}
    if MICROSOFT_PROXY:
        kwargs["proxy"] = MICROSOFT_PROXY
    return httpx.AsyncClient(**kwargs)


async def exchange_code_for_tokens(
    code: str, client_id: str, client_secret: str, tenant_id: str, redirect_uri: str
) -> dict:
    """Exchange authorization code for Microsoft tokens."""
    token_url = MICROSOFT_TOKEN_URL_TEMPLATE.format(tenant=_resolve_tenant(tenant_id))
    async with _http_client() as client:
        resp = await client.post(token_url, data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "scope": "openid email profile User.Read",
        })
        resp.raise_for_status()
        return resp.json()


async def get_microsoft_user_info(access_token: str) -> dict:
    """Fetch user profile from Microsoft Graph API."""
    async with _http_client() as client:
        resp = await client.get(MICROSOFT_GRAPH_ME_URL, headers={
            "Authorization": f"Bearer {access_token}",
        })
        resp.raise_for_status()
        return resp.json()
