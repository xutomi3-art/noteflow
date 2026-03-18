"""Integration tests for auth API endpoints."""
from __future__ import annotations

from backend.tests.conftest import TEST_PASSWORD


class TestRegisterEndpoint:
    async def test_register_success(self, client):
        resp = await client.post("/api/auth/register", json={
            "email": "new@noteflow.dev",
            "name": "New User",
            "password": TEST_PASSWORD,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    async def test_register_duplicate_email(self, client):
        payload = {"email": "dup@noteflow.dev", "name": "User", "password": TEST_PASSWORD}
        resp1 = await client.post("/api/auth/register", json=payload)
        assert resp1.status_code == 200
        resp2 = await client.post("/api/auth/register", json=payload)
        assert resp2.status_code == 400

    async def test_register_weak_password(self, client):
        resp = await client.post("/api/auth/register", json={
            "email": "weak@noteflow.dev",
            "name": "User",
            "password": "short",
        })
        assert resp.status_code == 422

    async def test_register_invalid_email(self, client):
        resp = await client.post("/api/auth/register", json={
            "email": "not-email",
            "name": "User",
            "password": TEST_PASSWORD,
        })
        assert resp.status_code == 422


class TestLoginEndpoint:
    async def test_login_success(self, client, test_user):
        resp = await client.post("/api/auth/login", json={
            "email": test_user["email"],
            "password": test_user["password"],
        })
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    async def test_login_wrong_password(self, client, test_user):
        resp = await client.post("/api/auth/login", json={
            "email": test_user["email"],
            "password": "WrongPass1",
        })
        assert resp.status_code == 401

    async def test_login_nonexistent_user(self, client):
        resp = await client.post("/api/auth/login", json={
            "email": "ghost@noteflow.dev",
            "password": "Whatever1",
        })
        assert resp.status_code == 401


class TestMeEndpoint:
    async def test_me_authenticated(self, client, auth_headers):
        resp = await client.get("/api/auth/me", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "email" in data
        assert "name" in data

    async def test_me_unauthenticated(self, client):
        resp = await client.get("/api/auth/me")
        assert resp.status_code in (401, 403)


class TestRefreshEndpoint:
    async def test_refresh_success(self, client, test_user):
        resp = await client.post("/api/auth/refresh", json={
            "refresh_token": test_user["tokens"]["refresh_token"],
        })
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    async def test_refresh_invalid_token(self, client):
        resp = await client.post("/api/auth/refresh", json={
            "refresh_token": "invalid-token",
        })
        assert resp.status_code == 401


class TestHealthEndpoint:
    async def test_health(self, client):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
