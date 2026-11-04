"""Basic CLI compatibility check after an upstream package upgrade.

Only checks CLI availability; it does not process or modify user images.
"""
from __future__ import annotations

import subprocess  # nosec B404


def main() -> None:
    for command in ("metadata", "visible", "erase"):
        result = subprocess.run(  # nosec B603
            ["remove-ai-watermarks", command, "--help"],
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
        )
        if result.returncode:
            details = "\n".join((result.stderr, result.stdout)).strip()
            raise RuntimeError(
                f"Upstream CLI subcommand {command!r} is unavailable "
                f"(exit {result.returncode}): {details[-4000:]}"
            )
        print(f"Upstream CLI smoke check passed: {command}")


if __name__ == "__main__":
    main()
