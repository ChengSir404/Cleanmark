from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


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


def test_erase_requires_region() -> None:
    response = client.post(
        "/api/process",
        data={"operation": "erase", "accept_terms": "true"},
        files={"file": ("sample.png", b"fake-png", "image/png")},
    )

    assert response.status_code == 400
    assert "region" in response.json()["detail"].lower()

