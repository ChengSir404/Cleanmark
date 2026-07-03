from __future__ import annotations

from pathlib import Path

from scripts.update_remove_ai_watermarks import (
    current_pinned_version,
    is_newer,
    update_dependency_files,
)


def test_current_pinned_version_reads_requirements(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text("fastapi\nremove-ai-watermarks==0.12.1\n", encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text(
        '[project]\ndependencies = ["remove-ai-watermarks==0.12.1"]\n',
        encoding="utf-8",
    )

    assert current_pinned_version(tmp_path) == "0.12.1"


def test_current_pinned_version_rejects_mismatched_files(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text("remove-ai-watermarks==0.12.1\n", encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text(
        '[project]\ndependencies = ["remove-ai-watermarks==0.12.2"]\n',
        encoding="utf-8",
    )

    try:
        current_pinned_version(tmp_path)
    except RuntimeError as exc:
        assert "mismatch" in str(exc).lower()
    else:
        raise AssertionError("expected mismatched pins to fail")


def test_update_dependency_files_rewrites_both_pins(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text("remove-ai-watermarks==0.12.1\n", encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text(
        '[project]\ndependencies = ["remove-ai-watermarks==0.12.1"]\n',
        encoding="utf-8",
    )

    changed = update_dependency_files(tmp_path, "0.12.3")

    assert changed is True
    assert "remove-ai-watermarks==0.12.3" in (tmp_path / "requirements.txt").read_text(encoding="utf-8")
    assert "remove-ai-watermarks==0.12.3" in (tmp_path / "pyproject.toml").read_text(encoding="utf-8")


def test_update_dependency_files_is_noop_when_version_matches(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text("remove-ai-watermarks==0.12.1\n", encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text(
        '[project]\ndependencies = ["remove-ai-watermarks==0.12.1"]\n',
        encoding="utf-8",
    )

    assert update_dependency_files(tmp_path, "0.12.1") is False


def test_is_newer_compares_release_versions() -> None:
    assert is_newer("0.12.2", "0.12.1") is True
    assert is_newer("0.12.1", "0.12.1") is False
    assert is_newer("0.11.9", "0.12.1") is False

