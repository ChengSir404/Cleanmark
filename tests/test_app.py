from __future__ import annotations

from pathlib import Path
import time
import zipfile

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from app.main import app, cleanup_expired_jobs, run_watermark_command


client = TestClient(app)


def image_bytes(fmt: str = "PNG") -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    Image.new("RGB", (2, 2), color=(255, 255, 255)).save(buffer, format=fmt)
    return buffer.getvalue()


def test_health_endpoint_reports_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_process_requires_terms_acceptance() -> None:
    response = client.post(
        "/api/process",
        data={"operation": "metadata", "accept_terms": "false"},
        files={"file": ("sample.png", image_bytes(), "image/png")},
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
        files={"file": ("sample.png", image_bytes(), "image/png")},
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
            ("file", ("first.png", image_bytes(), "image/png")),
            ("file", ("second.jpg", image_bytes("JPEG"), "image/jpeg")),
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
        files={"file": ("sample.png", image_bytes(), "image/png")},
    )

    assert response.status_code == 400
    assert "region" in response.json()["detail"].lower()


def test_process_rejects_too_many_files(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("JOB_ROOT", str(tmp_path))
    monkeypatch.setenv("MAX_FILES", "1")

    response = client.post(
        "/api/process",
        data={"operation": "metadata", "accept_terms": "true"},
        files=[
            ("file", ("first.png", image_bytes(), "image/png")),
            ("file", ("second.png", image_bytes(), "image/png")),
        ],
    )

    assert response.status_code == 413
    assert "too many" in response.json()["detail"].lower()


def test_process_rejects_invalid_image_content(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("JOB_ROOT", str(tmp_path))

    def fail_if_called(command: list[str], timeout: int) -> str:
        raise AssertionError("invalid image should not reach the processor")

    monkeypatch.setattr("app.main.run_watermark_command", fail_if_called)

    response = client.post(
        "/api/process",
        data={"operation": "metadata", "accept_terms": "true"},
        files={"file": ("sample.png", b"not-an-image", "image/png")},
    )

    assert response.status_code == 400
    assert "valid image" in response.json()["detail"].lower()


def test_process_rejects_total_upload_limit(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("JOB_ROOT", str(tmp_path))
    monkeypatch.setenv("MAX_TOTAL_UPLOAD_MB", "0")

    response = client.post(
        "/api/process",
        data={"operation": "metadata", "accept_terms": "true"},
        files={"file": ("sample.png", image_bytes(), "image/png")},
    )

    assert response.status_code == 413
    assert "total upload" in response.json()["detail"].lower()


def test_cli_errors_do_not_leak_internal_stderr() -> None:
    with pytest.raises(Exception) as exc_info:
        run_watermark_command(
            ["python", "-c", "import sys; sys.stderr.write('/tmp/secret-path'); sys.exit(1)"],
            timeout=5,
        )

    assert "/tmp/secret-path" not in str(exc_info.value)


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
