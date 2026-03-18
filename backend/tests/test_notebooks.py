"""Functional tests for Notebook CRUD operations."""
from __future__ import annotations

from backend.tests.conftest import NONEXISTENT_UUID, register_user, create_notebook


class TestCreateNotebook:
    async def test_create_notebook(self, client, auth_headers):
        resp = await client.post("/api/notebooks", json={
            "name": "My Research",
            "emoji": "🔬",
            "cover_color": "#dbeafe",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "My Research"
        assert data["emoji"] == "🔬"
        assert data["cover_color"] == "#dbeafe"
        assert data["user_role"] == "owner"
        assert data["source_count"] == 0

    async def test_create_notebook_default_values(self, client, auth_headers):
        resp = await client.post("/api/notebooks", json={"name": "Minimal"}, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["emoji"] == "📒"
        assert data["cover_color"] == "#4A90D9"

    async def test_create_notebook_empty_name_rejected(self, client, auth_headers):
        resp = await client.post("/api/notebooks", json={"name": "   "}, headers=auth_headers)
        assert resp.status_code == 422

    async def test_create_notebook_long_name_rejected(self, client, auth_headers):
        resp = await client.post("/api/notebooks", json={"name": "A" * 101}, headers=auth_headers)
        assert resp.status_code == 422

    async def test_create_notebook_unauthenticated(self, client):
        resp = await client.post("/api/notebooks", json={"name": "Test"})
        assert resp.status_code in (401, 403)


class TestListNotebooks:
    async def test_list_notebooks_empty(self, client, auth_headers):
        resp = await client.get("/api/notebooks", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 3  # 3 default starter notebooks from registration
        names = [nb["name"] for nb in data]
        assert "Getting Started" in names

    async def test_list_notebooks_after_create(self, client, auth_headers):
        await create_notebook(client, auth_headers, "Custom NB")
        resp = await client.get("/api/notebooks", headers=auth_headers)
        names = [nb["name"] for nb in resp.json()]
        assert "Custom NB" in names

    async def test_list_notebooks_isolation(self, client):
        """User A's notebooks should not appear for User B."""
        user_a = await register_user(client, "usera@test.dev")
        user_b = await register_user(client, "userb@test.dev")

        await create_notebook(client, user_a["headers"], "A's Private NB")

        resp = await client.get("/api/notebooks", headers=user_b["headers"])
        names = [nb["name"] for nb in resp.json()]
        assert "A's Private NB" not in names


class TestGetNotebook:
    async def test_get_notebook(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers, "Detail Test")
        resp = await client.get(f"/api/notebooks/{nb_id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["name"] == "Detail Test"

    async def test_get_notebook_not_found(self, client, auth_headers):
        resp = await client.get(f"/api/notebooks/{NONEXISTENT_UUID}", headers=auth_headers)
        assert resp.status_code == 404


class TestUpdateNotebook:
    async def test_rename_notebook(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers, "Original")
        resp = await client.patch(f"/api/notebooks/{nb_id}", json={"name": "Renamed"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed"

    async def test_update_emoji(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers, "Emoji Test")
        resp = await client.patch(f"/api/notebooks/{nb_id}", json={"emoji": "🎯"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["emoji"] == "🎯"

    async def test_update_cover_color(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers, "Color Test")
        resp = await client.patch(f"/api/notebooks/{nb_id}", json={"cover_color": "#ff0000"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["cover_color"] == "#ff0000"

    async def test_rename_empty_name_rejected(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers, "Valid")
        resp = await client.patch(f"/api/notebooks/{nb_id}", json={"name": "  "}, headers=auth_headers)
        assert resp.status_code == 422


class TestDeleteNotebook:
    async def test_delete_notebook(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers, "To Delete")
        resp = await client.delete(f"/api/notebooks/{nb_id}", headers=auth_headers)
        assert resp.status_code == 200
        get_resp = await client.get(f"/api/notebooks/{nb_id}", headers=auth_headers)
        assert get_resp.status_code == 404

    async def test_delete_notebook_not_found(self, client, auth_headers):
        resp = await client.delete(f"/api/notebooks/{NONEXISTENT_UUID}", headers=auth_headers)
        assert resp.status_code in (403, 404)
