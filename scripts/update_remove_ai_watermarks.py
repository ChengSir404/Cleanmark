from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path


PACKAGE = "remove-ai-watermarks"
ROOT = Path(__file__).resolve().parents[1]
PIN_RE = re.compile(r"(remove-ai-watermarks==)([0-9][A-Za-z0-9.!+-]*)")


def run(command: list[str], cwd: Path = ROOT, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, check=check, text=True, capture_output=True)


def pinned_versions(root: Path) -> dict[Path, str]:
    versions: dict[Path, str] = {}
    for relative in (Path("requirements.txt"), Path("pyproject.toml")):
        path = root / relative
        match = PIN_RE.search(path.read_text(encoding="utf-8"))
        if not match:
            raise RuntimeError(f"missing {PACKAGE} pin in {relative}")
        versions[relative] = match.group(2)
    return versions


def current_pinned_version(root: Path = ROOT) -> str:
    versions = pinned_versions(root)
    unique = set(versions.values())
    if len(unique) != 1:
        details = ", ".join(f"{path}: {version}" for path, version in versions.items())
        raise RuntimeError(f"{PACKAGE} version mismatch: {details}")
    return unique.pop()


def version_parts(version: str) -> tuple[int, ...]:
    release = version.split("+", 1)[0].split("-", 1)[0].split("!", 1)[-1]
    parts = []
    for piece in release.split("."):
        if not piece.isdigit():
            number = re.match(r"\d+", piece)
            parts.append(int(number.group(0)) if number else 0)
        else:
            parts.append(int(piece))
    return tuple(parts)


def is_newer(candidate: str, current: str) -> bool:
    return version_parts(candidate) > version_parts(current)


def latest_pypi_version() -> str:
    with urllib.request.urlopen(f"https://pypi.org/pypi/{PACKAGE}/json", timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    version = payload.get("info", {}).get("version")
    if not isinstance(version, str) or not version:
        raise RuntimeError(f"could not read latest {PACKAGE} version from PyPI")
    return version


def update_dependency_files(root: Path, new_version: str) -> bool:
    changed = False
    for relative in (Path("requirements.txt"), Path("pyproject.toml")):
        path = root / relative
        old = path.read_text(encoding="utf-8")
        new = PIN_RE.sub(rf"\g<1>{new_version}", old)
        if new != old:
            path.write_text(new, encoding="utf-8")
            changed = True
    return changed


def ensure_clean_worktree() -> None:
    status = run(["git", "status", "--porcelain"]).stdout.strip()
    if status:
        raise RuntimeError("working tree is not clean; aborting automated dependency update")


def commit_update(version: str) -> None:
    run(["git", "add", "requirements.txt", "pyproject.toml", "uv.lock"])
    staged = run(["git", "diff", "--cached", "--quiet"], check=False)
    if staged.returncode == 0:
        return
    run(["git", "commit", "-m", f"Update {PACKAGE} to {version}"])


def main() -> int:
    parser = argparse.ArgumentParser(description=f"Update pinned {PACKAGE} when PyPI has a newer version.")
    parser.add_argument("--check-only", action="store_true", help="Only report whether an update is available.")
    parser.add_argument("--skip-commit", action="store_true", help="Update files and test, but do not commit.")
    args = parser.parse_args()

    try:
        current = current_pinned_version(ROOT)
        latest = latest_pypi_version()
        print(f"{PACKAGE}: current={current} latest={latest}")

        if not is_newer(latest, current):
            print("No update available.")
            return 0

        if args.check_only:
            print("Update available.")
            return 0

        ensure_clean_worktree()
        update_dependency_files(ROOT, latest)
        run(["uv", "lock", "--upgrade-package", PACKAGE])
        run(["uv", "sync", "--extra", "dev"])
        run(["uv", "run", "pytest", "-q"])
        if not args.skip_commit:
            commit_update(latest)
        print(f"Updated {PACKAGE} to {latest}.")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

