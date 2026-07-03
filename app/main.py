from __future__ import annotations

import os
import re
import shutil
# Commands are built as argv lists with validated user parameters.
import subprocess  # nosec B404
import time
import uuid
import zipfile
import logging
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from PIL.Image import DecompressionBombError


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DEFAULT_JOB_ROOT = BASE_DIR.parent / "data" / "jobs"
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
ALLOWED_MARKS = {"auto", "gemini", "doubao", "jimeng", "samsung"}
IMAGE_FORMATS_BY_EXTENSION = {
    ".png": "PNG",
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".webp": "WEBP",
    ".bmp": "BMP",
    ".tif": "TIFF",
    ".tiff": "TIFF",
}
REGION_PATTERN = re.compile(r"^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$")
logger = logging.getLogger(__name__)

app = FastAPI(title="Remove AI Watermarks Web", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def get_job_root() -> Path:
    return Path(os.environ.get("JOB_ROOT", str(DEFAULT_JOB_ROOT))).resolve()


def get_max_upload_bytes() -> int:
    mb = int(os.environ.get("MAX_UPLOAD_MB", "20"))
    return mb * 1024 * 1024


def get_max_total_upload_bytes() -> int:
    mb = int(os.environ.get("MAX_TOTAL_UPLOAD_MB", "100"))
    return max(mb, 0) * 1024 * 1024


def get_max_files() -> int:
    return max(int(os.environ.get("MAX_FILES", "10")), 1)


def get_max_image_pixels() -> int:
    return max(int(os.environ.get("MAX_IMAGE_PIXELS", "50000000")), 1)


def get_process_timeout() -> int:
    return int(os.environ.get("PROCESS_TIMEOUT_SECONDS", "120"))


def get_cache_ttl_seconds() -> int:
    hours = int(os.environ.get("CACHE_TTL_HOURS", "24"))
    return max(hours, 1) * 60 * 60


def cleanup_expired_jobs() -> int:
    root = get_job_root()
    if not root.exists():
        return 0

    cutoff = time.time() - get_cache_ttl_seconds()
    removed = 0
    for child in root.iterdir():
        if not child.is_dir():
            continue
        try:
            if child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
        except OSError:
            continue
    return removed


def safe_extension(filename: str) -> str:
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file type. Upload PNG, JPG, WEBP, BMP, or TIFF.")
    return extension


def validate_image_file(path: Path, extension: str) -> None:
    Image.MAX_IMAGE_PIXELS = get_max_image_pixels()
    try:
        with Image.open(path) as image:
            image.verify()
            detected = image.format
    except (UnidentifiedImageError, OSError, DecompressionBombError) as exc:
        raise HTTPException(status_code=400, detail="Upload a valid image file.") from exc

    expected = IMAGE_FORMATS_BY_EXTENSION[extension]
    if detected != expected:
        raise HTTPException(status_code=400, detail="Image content does not match the file extension.")


def parse_regions(raw_regions: str | None) -> list[str]:
    if not raw_regions:
        return []

    regions = [part.strip() for part in re.split(r"[;\n]+", raw_regions) if part.strip()]
    invalid = [region for region in regions if not REGION_PATTERN.match(region)]
    if invalid:
        raise HTTPException(status_code=400, detail="Region must use x,y,w,h format, for example 1640,1930,400,100.")
    return [re.sub(r"\s+", "", region) for region in regions]


def safe_stem(filename: str, fallback: str) -> str:
    stem = Path(filename).stem.lower()
    stem = re.sub(r"[^a-z0-9._-]+", "-", stem).strip(".-")
    return stem[:60] or fallback


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
        # The command uses a fixed executable, validated arguments, and shell=False.
        completed = subprocess.run(  # nosec B603
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
        logger.warning("remove-ai-watermarks failed with code %s: %s", exc.returncode, message)
        if exc.returncode == 2:
            raise HTTPException(status_code=422, detail="No matching watermark was detected.") from exc
        raise HTTPException(status_code=500, detail="Processing failed.") from exc

    message = "\n".join(part for part in [completed.stdout, completed.stderr] if part).strip()
    if message:
        logger.debug("remove-ai-watermarks output: %s", message)
    return ""


async def store_upload(upload: UploadFile, destination: Path) -> int:
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
    return total


@app.get("/", include_in_schema=False)
@app.head("/", include_in_schema=False)
def index() -> RedirectResponse:
    return RedirectResponse(url="/static/index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/process")
async def process_image(
    files: Annotated[list[UploadFile], File(alias="file")],
    operation: Annotated[Literal["visible", "metadata", "erase"], Form()],
    accept_terms: Annotated[bool, Form()] = False,
    mark: Annotated[str, Form()] = "auto",
    regions: Annotated[str | None, Form()] = None,
) -> dict[str, object]:
    if not accept_terms:
        raise HTTPException(status_code=400, detail="Confirm lawful use before processing.")

    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one image.")
    if len(files) > get_max_files():
        raise HTTPException(status_code=413, detail=f"Too many files. Upload at most {get_max_files()} files at a time.")

    cleanup_expired_jobs()

    job_id = uuid.uuid4().hex
    job_dir = get_job_root() / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    parsed_regions = parse_regions(regions)
    processed_files: list[dict[str, str]] = []
    logs: list[str] = []
    total_upload_bytes = 0
    max_total_upload_bytes = get_max_total_upload_bytes()

    try:
        for index, upload in enumerate(files, start=1):
            extension = safe_extension(upload.filename or "")
            stem = safe_stem(upload.filename or "", f"image-{index}")
            input_path = job_dir / f"input-{index:03d}-{stem}{extension}"
            output_name = f"clean-{index:03d}-{stem}{extension}"
            output_path = job_dir / output_name

            total_upload_bytes += await store_upload(upload, input_path)
            if total_upload_bytes > max_total_upload_bytes:
                raise HTTPException(status_code=413, detail=f"Total upload is too large. Limit is {max_total_upload_bytes // 1024 // 1024} MB.")
            validate_image_file(input_path, extension)
            command = build_command(operation, input_path, output_path, mark, parsed_regions)
            log = run_watermark_command(command, get_process_timeout())
            logs.append(log)

            if not output_path.exists():
                raise HTTPException(status_code=500, detail="Processing finished without an output file.")

            processed_files.append(
                {
                    "name": output_name,
                    "original_name": upload.filename or input_path.name,
                    "download_url": f"/api/download/{job_id}/{output_name}",
                }
            )
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    return {
        "job_id": job_id,
        "operation": operation,
        "download_url": f"/api/download/{job_id}",
        "download_all_url": f"/api/download/{job_id}",
        "count": len(processed_files),
        "files": processed_files,
        "log": "\n".join(log for log in logs if log),
    }


@app.get("/api/download/{job_id}")
def download(job_id: str) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(status_code=404, detail="Result not found.")

    job_dir = get_job_root() / job_id
    matches = list(job_dir.glob("clean.*"))
    if not matches:
        matches = sorted(job_dir.glob("clean-*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Result not found.")

    if len(matches) > 1:
        archive_path = job_dir / "cleanmark-results.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for output_path in matches:
                archive.write(output_path, arcname=output_path.name)
        return FileResponse(archive_path, filename="cleanmark-results.zip", media_type="application/zip")

    return FileResponse(matches[0], filename=f"clean{matches[0].suffix}", media_type="application/octet-stream")


@app.get("/api/download/{job_id}/{filename}")
def download_file(job_id: str, filename: str) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(status_code=404, detail="Result not found.")
    if "/" in filename or "\\" in filename or not filename.startswith("clean-"):
        raise HTTPException(status_code=404, detail="Result not found.")

    path = get_job_root() / job_id / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Result not found.")

    return FileResponse(path, filename=filename, media_type="application/octet-stream")
