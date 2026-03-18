"""Functional tests for notebook sharing — invite links, members, permissions."""
from __future__ import annotations

from backend.tests.conftest import register_user, create_notebook


class TestCreateInviteLink:
    async def test_create_viewer_invite(self, client):
        owner = await register_user(client, "owner1@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "viewer"}, headers=owner["headers"])
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "viewer"
        assert len(data["token"]) > 0

    async def test_create_editor_invite(self, client):
        owner = await register_user(client, "owner2@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "editor"}, headers=owner["headers"])
        assert resp.status_code == 200
        assert resp.json()["role"] == "editor"

    async def test_invalid_role_rejected(self, client):
        owner = await register_user(client, "owner3@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "admin"}, headers=owner["headers"])
        assert resp.status_code == 400


class TestJoinViaToken:
    async def test_join_as_viewer(self, client):
        owner = await register_user(client, "joinowner@test.dev")
        joiner = await register_user(client, "joiner@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "viewer"}, headers=owner["headers"])
        token = invite_resp.json()["token"]

        join_resp = await client.post(f"/api/join/{token}", headers=joiner["headers"])
        assert join_resp.status_code == 200
        data = join_resp.json()["data"]
        assert data["notebook_id"] == nb_id
        assert data["already_member"] is False

    async def test_join_twice_returns_already_member(self, client):
        owner = await register_user(client, "joinowner2@test.dev")
        joiner = await register_user(client, "joiner2@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "editor"}, headers=owner["headers"])
        token = invite_resp.json()["token"]

        await client.post(f"/api/join/{token}", headers=joiner["headers"])
        join2 = await client.post(f"/api/join/{token}", headers=joiner["headers"])
        assert join2.status_code == 200
        assert join2.json()["data"]["already_member"] is True

    async def test_join_invalid_token(self, client):
        user = await register_user(client, "badtoken@test.dev")
        resp = await client.post("/api/join/nonexistent-token", headers=user["headers"])
        assert resp.status_code == 404

    async def test_joined_user_can_see_notebook(self, client):
        owner = await register_user(client, "listowner@test.dev")
        joiner = await register_user(client, "listjoiner@test.dev")
        nb_id = await create_notebook(client, owner["headers"], "Shared Research")

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "viewer"}, headers=owner["headers"])
        await client.post(f"/api/join/{invite_resp.json()['token']}", headers=joiner["headers"])

        list_resp = await client.get("/api/notebooks", headers=joiner["headers"])
        names = [nb["name"] for nb in list_resp.json()]
        assert "Shared Research" in names


class TestMemberManagement:
    async def test_get_members(self, client):
        owner = await register_user(client, "memowner@test.dev")
        member = await register_user(client, "member@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "editor"}, headers=owner["headers"])
        await client.post(f"/api/join/{invite_resp.json()['token']}", headers=member["headers"])

        resp = await client.get(f"/api/notebooks/{nb_id}/members", headers=owner["headers"])
        assert resp.status_code == 200
        emails = [m["email"] for m in resp.json()]
        assert "memowner@test.dev" in emails
        assert "member@test.dev" in emails

    async def test_update_member_role(self, client):
        owner = await register_user(client, "roleowner@test.dev")
        member = await register_user(client, "rolemem@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "editor"}, headers=owner["headers"])
        await client.post(f"/api/join/{invite_resp.json()['token']}", headers=member["headers"])

        members_resp = await client.get(f"/api/notebooks/{nb_id}/members", headers=owner["headers"])
        member_entry = [m for m in members_resp.json() if m["email"] == "rolemem@test.dev"][0]

        resp = await client.patch(
            f"/api/notebooks/{nb_id}/members/{member_entry['user_id']}",
            json={"role": "viewer"}, headers=owner["headers"],
        )
        assert resp.status_code == 200

    async def test_remove_member(self, client):
        owner = await register_user(client, "rmowner@test.dev")
        member = await register_user(client, "rmmem@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "viewer"}, headers=owner["headers"])
        await client.post(f"/api/join/{invite_resp.json()['token']}", headers=member["headers"])

        members_resp = await client.get(f"/api/notebooks/{nb_id}/members", headers=owner["headers"])
        member_entry = [m for m in members_resp.json() if m["email"] == "rmmem@test.dev"][0]

        resp = await client.delete(f"/api/notebooks/{nb_id}/members/{member_entry['user_id']}", headers=owner["headers"])
        assert resp.status_code == 200

        members_resp2 = await client.get(f"/api/notebooks/{nb_id}/members", headers=owner["headers"])
        assert "rmmem@test.dev" not in [m["email"] for m in members_resp2.json()]


class TestPermissions:
    async def test_viewer_cannot_upload(self, client):
        owner = await register_user(client, "permowner@test.dev")
        viewer = await register_user(client, "permviewer@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "viewer"}, headers=owner["headers"])
        await client.post(f"/api/join/{invite_resp.json()['token']}", headers=viewer["headers"])

        resp = await client.post(f"/api/notebooks/{nb_id}/sources",
                                 files={"file": ("test.txt", b"data", "text/plain")}, headers=viewer["headers"])
        assert resp.status_code == 403

    async def test_viewer_cannot_delete_notebook(self, client):
        owner = await register_user(client, "delowner@test.dev")
        viewer = await register_user(client, "delviewer@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "viewer"}, headers=owner["headers"])
        await client.post(f"/api/join/{invite_resp.json()['token']}", headers=viewer["headers"])

        resp = await client.delete(f"/api/notebooks/{nb_id}", headers=viewer["headers"])
        assert resp.status_code == 403

    async def test_editor_can_upload(self, client):
        owner = await register_user(client, "edowner@test.dev")
        editor = await register_user(client, "ededitor@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "editor"}, headers=owner["headers"])
        await client.post(f"/api/join/{invite_resp.json()['token']}", headers=editor["headers"])

        resp = await client.post(f"/api/notebooks/{nb_id}/sources",
                                 files={"file": ("test.txt", b"editor upload", "text/plain")}, headers=editor["headers"])
        assert resp.status_code == 200

    async def test_editor_cannot_delete_notebook(self, client):
        owner = await register_user(client, "eddelowner@test.dev")
        editor = await register_user(client, "eddeleditor@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "editor"}, headers=owner["headers"])
        await client.post(f"/api/join/{invite_resp.json()['token']}", headers=editor["headers"])

        resp = await client.delete(f"/api/notebooks/{nb_id}", headers=editor["headers"])
        assert resp.status_code == 403

    async def test_non_member_cannot_view(self, client):
        owner = await register_user(client, "noviewowner@test.dev")
        stranger = await register_user(client, "stranger@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        resp = await client.get(f"/api/notebooks/{nb_id}/sources", headers=stranger["headers"])
        assert resp.status_code == 403


class TestLeaveNotebook:
    async def test_member_can_leave(self, client):
        owner = await register_user(client, "leaveowner@test.dev")
        member = await register_user(client, "leavemem@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        invite_resp = await client.post(f"/api/notebooks/{nb_id}/share", json={"role": "editor"}, headers=owner["headers"])
        await client.post(f"/api/join/{invite_resp.json()['token']}", headers=member["headers"])

        resp = await client.post(f"/api/notebooks/{nb_id}/leave", headers=member["headers"])
        assert resp.status_code == 200

        list_resp = await client.get("/api/notebooks", headers=member["headers"])
        assert nb_id not in [nb["id"] for nb in list_resp.json()]

    async def test_owner_cannot_leave(self, client):
        owner = await register_user(client, "ownerleave@test.dev")
        nb_id = await create_notebook(client, owner["headers"])

        resp = await client.post(f"/api/notebooks/{nb_id}/leave", headers=owner["headers"])
        assert resp.status_code == 400
        assert "Owner" in resp.json()["detail"]
