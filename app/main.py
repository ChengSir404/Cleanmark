from __future__ import annotations

import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DEFAULT_JOB_ROOT = BASE_DIR.parent / "data" / "jobs"
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
ALLOWED_MARKS = {"auto", "gemini", "doubao", "jimeng", "samsung"}
REGION_PATTERN = re.compile(r"^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$")

app = FastAPI(title="Remove AI Watermarks Web", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def get_job_root() -> Path:
    return Path(os.environ.get("JOB_ROOT", str(DEFAULT_JOB_ROOT))).resolve()


def get_max_upload_bytes() -> int:
    mb = int(os.environ.get("MAX_UPLOAD_MB", "20"))
    return mb * 1024 * 1024


def get_process_timeout() -> int:
    return int(os.environ.get("PROCESS_TIMEOUT_SECONDS", "120"))


def safe_extension(filename: str) -> str:
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file type. Upload PNG, JPG, WEBP, BMP, or TIFF.")
    return extension


def parse_regions(raw_regions: str | None) -> list[str]:
    if not raw_regions:
        return []

    regions = [part.strip() for part in re.split(r"[;\n]+", raw_regions) if part.strip()]
    invalid = [region for region in regions if not REGION_PATTERN.match(region)]
    if invalid:
        raise HTTPException(status_code=400, detail="Region must use x,y,w,h format, for example 1640,1930,400,100.")
    return [re.sub(r"\s+", "", region) for region in regions]


def build_command(operation: str, input_path: Path, output_path: Path, mark: str, regions: list[str]) -> list[str]:
    if operation == "metadata":
        return ["remove-ai-watermarks", "metadata", str(input_path), "--remove", "-o", str(output_path)]

    if operation == "visible":
        if mark not in ALLOWED_MARKS:
            raise HTTPException(status_code=400, detail="Unknown visible mark selection.")
        return ["remove-ai-watermarks", "visible", str(input_path), "--mark", mark, "-o", str(output_path)]

    if operation == "erase":
        if not regions:
            raise HTTPException(status_code=400, detail="At least one region is required for erase.")
        command = ["remove-ai-watermarks", "erase", str(input_path), "-o", str(output_path)]
        for region in regions:
            command.extend(["--region", region])
        return command

    raise HTTPException(status_code=400, detail="Unknown operation.")


def run_watermark_command(command: list[str], timeout: int) -> str:
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Processing timed out. Try a smaller image.") from exc
    except subprocess.CalledProcessError as exc:
        message = "\n".join(part for part in [exc.stdout, exc.stderr] if part).strip()
        if exc.returncode == 2:
            raise HTTPException(status_code=422, detail=message or "No matching watermark was detected.") from exc
        raise HTTPException(status_code=500, detail=message or "Processing failed.") from exc

    return "\n".join(part for part in [completed.stdout, completed.stderr] if part).strip()


async def store_upload(upload: UploadFile, destination: Path) -> None:
    max_bytes = get_max_upload_bytes()
    total = 0
    with destination.open("wb") as target:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(status_code=413, detail=f"File is too large. Limit is {max_bytes // 1024 // 1024} MB.")
            target.write(chunk)


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/process")
async def process_image(
    file: Annotated[UploadFile, File()],
    operation: Annotated[Literal["visible", "metadata", "erase"], Form()],
    accept_terms: Annotated[bool, Form()] = False,
    mark: Annotated[str, Form()] = "auto",
    regions: Annotated[str | None, Form()] = None,
) -> dict[str, str]:
    if not accept_terms:
        raise HTTPException(status_code=400, detail="Confirm lawful use before processing.")

    extension = safe_extension(file.filename or "")
    job_id = uuid.uuid4().hex
    job_dir = get_job_root() / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    input_path = job_dir / f"input{extension}"
    output_path = job_dir / f"clean{extension}"

    try:
        await store_upload(file, input_path)
        parsed_regions = parse_regions(regions)
        command = build_command(operation, input_path, output_path, mark, parsed_regions)
        log = run_watermark_command(command, get_process_timeout())
    except Exception:
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)
        raise

    if not output_path.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Processing finished without an output file.")

    return {
        "job_id": job_id,
        "operation": operation,
        "download_url": f"/api/download/{job_id}",
        "log": log,
    }


@app.get("/api/download/{job_id}")
def download(job_id: str) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(status_code=404, detail="Result not found.")

    job_dir = get_job_root() / job_id
    matches = list(job_dir.glob("clean.*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Result not found.")

    return FileResponse(matches[0], filename=f"clean{matches[0].suffix}", media_type="application/octet-stream")
