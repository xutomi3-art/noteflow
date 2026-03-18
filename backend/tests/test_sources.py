"""Functional tests for Source (document upload) operations."""
from __future__ import annotations

from backend.tests.conftest import NONEXISTENT_UUID, create_notebook


class TestUploadSource:
    async def test_upload_txt_file(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.post(
            f"/api/notebooks/{nb_id}/sources",
            files={"file": ("test.txt", b"Hello world content", "text/plain")},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["filename"] == "test.txt"
        assert data["file_type"] == "txt"
        assert data["status"] == "uploading"
        assert data["file_size"] > 0

    async def test_upload_csv_file(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        csv_content = b"name,age,city\nAlice,30,Beijing\nBob,25,Shanghai"
        resp = await client.post(
            f"/api/notebooks/{nb_id}/sources",
            files={"file": ("data.csv", csv_content, "text/csv")},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["file_type"] == "csv"

    async def test_upload_md_file(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.post(
            f"/api/notebooks/{nb_id}/sources",
            files={"file": ("readme.md", b"# Title\n\nContent", "text/markdown")},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["file_type"] == "md"

    async def test_upload_unsupported_type_rejected(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.post(
            f"/api/notebooks/{nb_id}/sources",
            files={"file": ("malware.exe", b"MZ...", "application/octet-stream")},
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert "Unsupported file type" in resp.json()["detail"]

    async def test_upload_empty_file_rejected(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.post(
            f"/api/notebooks/{nb_id}/sources",
            files={"file": ("empty.txt", b"", "text/plain")},
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert "empty" in resp.json()["detail"].lower()

    async def test_upload_unauthenticated(self, client):
        resp = await client.post(
            f"/api/notebooks/{NONEXISTENT_UUID}/sources",
            files={"file": ("test.txt", b"data", "text/plain")},
        )
        assert resp.status_code in (401, 403)


class TestListSources:
    async def test_list_sources_empty(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.get(f"/api/notebooks/{nb_id}/sources", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_list_sources_after_upload(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        await client.post(f"/api/notebooks/{nb_id}/sources",
                          files={"file": ("doc1.txt", b"content 1", "text/plain")}, headers=auth_headers)
        await client.post(f"/api/notebooks/{nb_id}/sources",
                          files={"file": ("doc2.txt", b"content 2", "text/plain")}, headers=auth_headers)

        resp = await client.get(f"/api/notebooks/{nb_id}/sources", headers=auth_headers)
        assert resp.status_code == 200
        filenames = {s["filename"] for s in resp.json()}
        assert filenames == {"doc1.txt", "doc2.txt"}


class TestDeleteSource:
    async def test_delete_source(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        upload_resp = await client.post(f"/api/notebooks/{nb_id}/sources",
                                        files={"file": ("to_delete.txt", b"temp", "text/plain")}, headers=auth_headers)
        source_id = upload_resp.json()["id"]

        resp = await client.delete(f"/api/notebooks/{nb_id}/sources/{source_id}", headers=auth_headers)
        assert resp.status_code == 200

        list_resp = await client.get(f"/api/notebooks/{nb_id}/sources", headers=auth_headers)
        assert source_id not in [s["id"] for s in list_resp.json()]

    async def test_delete_source_not_found(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.delete(f"/api/notebooks/{nb_id}/sources/{NONEXISTENT_UUID}", headers=auth_headers)
        assert resp.status_code == 404


class TestFileTypeDetection:
    async def test_pdf_by_extension(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.post(f"/api/notebooks/{nb_id}/sources",
                                 files={"file": ("report.pdf", b"%PDF-1.4 fake", "application/octet-stream")},
                                 headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["file_type"] == "pdf"

    async def test_xlsx_by_content_type(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.post(f"/api/notebooks/{nb_id}/sources",
                                 files={"file": ("data.xlsx", b"PK\x03\x04fake",
                                         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                                 headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["file_type"] == "xlsx"

    async def test_image_jpg(self, client, auth_headers):
        nb_id = await create_notebook(client, auth_headers)
        resp = await client.post(f"/api/notebooks/{nb_id}/sources",
                                 files={"file": ("photo.jpg", b"\xff\xd8\xff\xe0fake", "image/jpeg")},
                                 headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["file_type"] == "jpg"
