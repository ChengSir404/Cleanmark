from __future__ import annotations

from pathlib import Path
import time
import zipfile

from fastapi.testclient import TestClient

from app.main import app, cleanup_expired_jobs


client = TestClient(app)


def test_health_endpoint_reports_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_process_requires_terms_acceptance() -> None:
    response = client.post(
        "/api/process",
        data={"operation": "metadata", "accept_terms": "false"},
        files={"file": ("sample.png", b"not-an-image", "image/png")},
    )

    assert response.status_code == 400
    assert "lawful" in response.json()["detail"].lower()


def test_process_rejects_unsupported_file_extension() -> None:
    response = client.post(
        "/api/process",
        data={"operation": "metadata", "accept_terms": "true"},
        files={"file": ("sample.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 400
    assert "unsupported" in response.json()["detail"].lower()


def test_metadata_process_returns_download_url(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("JOB_ROOT", str(tmp_path))

    def fake_run_command(command: list[str], timeout: int) -> str:
        output_path = Path(command[command.index("-o") + 1])
        output_path.write_bytes(b"clean-image")
        return "ok"

    monkeypatch.setattr("app.main.run_watermark_command", fake_run_command)

    response = client.post(
        "/api/process",
        data={"operation": "metadata", "accept_terms": "true"},
        files={"file": ("sample.png", b"fake-png", "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["operation"] == "metadata"
    assert body["download_url"].startswith("/api/download/")
    assert body["download_all_url"].startswith("/api/download/")
    assert body["files"][0]["download_url"].startswith("/api/download/")


def test_batch_metadata_process_returns_individual_and_zip_downloads(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("JOB_ROOT", str(tmp_path))

    def fake_run_command(command: list[str], timeout: int) -> str:
        output_path = Path(command[command.index("-o") + 1])
        output_path.write_bytes(f"clean-{output_path.name}".encode())
        return "ok"

    monkeypatch.setattr("app.main.run_watermark_command", fake_run_command)

    response = client.post(
        "/api/process",
        data={"operation": "metadata", "accept_terms": "true"},
        files=[
            ("file", ("first.png", b"fake-png-1", "image/png")),
            ("file", ("second.jpg", b"fake-jpg-2", "image/jpeg")),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    assert len(body["files"]) == 2

    first_download = client.get(body["files"][0]["download_url"])
    assert first_download.status_code == 200
    assert first_download.content

    zip_download = client.get(body["download_all_url"])
    assert zip_download.status_code == 200
    archive_path = tmp_path / "results.zip"
    archive_path.write_bytes(zip_download.content)
    with zipfile.ZipFile(archive_path) as archive:
        assert len(archive.namelist()) == 2


def test_erase_requires_region() -> None:
    response = client.post(
        "/api/process",
        data={"operation": "erase", "accept_terms": "true"},
        files={"file": ("sample.png", b"fake-png", "image/png")},
    )

    assert response.status_code == 400
    assert "region" in response.json()["detail"].lower()


def test_cleanup_expired_jobs_removes_old_directories(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("JOB_ROOT", str(tmp_path))
    monkeypatch.setenv("CACHE_TTL_HOURS", "1")
    old_job = tmp_path / "old"
    fresh_job = tmp_path / "fresh"
    old_job.mkdir()
    fresh_job.mkdir()
    old_time = time.time() - 7200
    old_job.touch()
    fresh_job.touch()
    import os

    os.utime(old_job, (old_time, old_time))

    removed = cleanup_expired_jobs()

    assert removed == 1
    assert not old_job.exists()
    assert fresh_job.exists()
