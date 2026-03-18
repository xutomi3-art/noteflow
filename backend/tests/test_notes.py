"""Functional tests for Saved Notes operations."""
from __future__ import annotations

from backend.tests.conftest import NONEXISTENT_UUID, create_notebook


class TestSaveNote:
    async def test_save_note(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.post(f"/api/notebooks/{nb_id}/notes", json={
            "content": "This is an important finding.",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] == "This is an important finding."
        assert data["notebook_id"] == nb_id

    async def test_save_note_with_markdown(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        content = "## Key Points\n\n- Point 1\n- Point 2\n\n**Bold text**"
        resp = await client.post(f"/api/notebooks/{nb_id}/notes", json={"content": content}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["content"] == content

    async def test_save_note_without_source_message_id(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.post(f"/api/notebooks/{nb_id}/notes", json={
            "content": "Manual note without source",
        }, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["source_message_id"] is None

    async def test_save_note_unauthenticated(self, client):
        resp = await client.post(
            f"/api/notebooks/{NONEXISTENT_UUID}/notes", json={"content": "test"},
        )
        assert resp.status_code in (401, 403)


class TestListNotes:
    async def test_list_notes_empty(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.get(f"/api/notebooks/{nb_id}/notes", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_list_notes_returns_saved_notes(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        await client.post(f"/api/notebooks/{nb_id}/notes", json={"content": "Note A"}, headers=auth_headers)
        await client.post(f"/api/notebooks/{nb_id}/notes", json={"content": "Note B"}, headers=auth_headers)

        resp = await client.get(f"/api/notebooks/{nb_id}/notes", headers=auth_headers)
        assert resp.status_code == 200
        contents = {n["content"] for n in resp.json()}
        assert contents == {"Note A", "Note B"}

    async def test_notes_isolation_between_notebooks(self, client, auth_headers):
        nb_a = await create_notebook(client, auth_headers, "NB A")
        nb_b = await create_notebook(client, auth_headers, "NB B")
        await client.post(f"/api/notebooks/{nb_a}/notes", json={"content": "A's note"}, headers=auth_headers)

        resp = await client.get(f"/api/notebooks/{nb_b}/notes", headers=auth_headers)
        assert resp.json() == []


class TestDeleteNote:
    async def test_delete_note(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        save_resp = await client.post(f"/api/notebooks/{nb_id}/notes", json={"content": "To delete"}, headers=auth_headers)
        note_id = save_resp.json()["id"]

        resp = await client.delete(f"/api/notebooks/{nb_id}/notes/{note_id}", headers=auth_headers)
        assert resp.status_code == 200

        list_resp = await client.get(f"/api/notebooks/{nb_id}/notes", headers=auth_headers)
        assert note_id not in [n["id"] for n in list_resp.json()]

    async def test_delete_note_not_found(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.delete(f"/api/notebooks/{nb_id}/notes/{NONEXISTENT_UUID}", headers=auth_headers)
        assert resp.status_code == 404
