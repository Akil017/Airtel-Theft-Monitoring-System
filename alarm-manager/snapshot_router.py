"""
snapshot_router.py — Snapshot storage & retrieval for NOC dashboard
Mounts at /snapshots in alarm-manager FastAPI app
"""

import os
import base64
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# ── Config ────────────────────────────────────────────────────────────────────
SNAPSHOT_DIR = Path(os.getenv("SNAPSHOT_DIR", "/shared/snapshots"))
SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/snapshots", tags=["snapshots"])


# ── Models ────────────────────────────────────────────────────────────────────
class SnapshotIngestRequest(BaseModel):
    alarm_id: str          # e.g. "ALM-0001"
    camera_id: str
    site_id: str
    timestamp: str         # ISO8601
    image_b64: str         # base64-encoded JPEG
    frame_offset_ms: int = 0   # ms after alarm trigger (0, 2000, 4000)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/ingest")
async def ingest_snapshot(req: SnapshotIngestRequest):
    """
    Called by detection-service when a person is detected.
    Saves up to 3 frames per alarm (at detection + 2s + 4s).
    """
    try:
        img_bytes = base64.b64decode(req.image_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    # Sanitise alarm_id for use in filename
    alarm_safe = req.alarm_id.replace("/", "-").replace(" ", "_")
    ts_str     = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    offset_str = f"+{req.frame_offset_ms // 1000}s"
    filename   = f"{alarm_safe}_{ts_str}_{offset_str}.jpg"
    filepath   = SNAPSHOT_DIR / filename

    filepath.write_bytes(img_bytes)

    return {
        "ok": True,
        "filename": filename,
        "url": f"/snapshots/image/{filename}",
        "size_kb": round(len(img_bytes) / 1024, 1),
    }


@router.get("/alarm/{alarm_id}")
async def list_alarm_snapshots(alarm_id: str):
    """
    Return all snapshot URLs for a given alarm_id.
    Dashboard calls this when opening the Snapshot tab.
    """
    alarm_safe = alarm_id.replace("/", "-").replace(" ", "_")
    files = sorted(SNAPSHOT_DIR.glob(f"{alarm_safe}_*.jpg"))

    snapshots = []
    for f in files:
        parts  = f.stem.split("_")
        offset = parts[-1] if parts[-1].startswith("+") else "0s"
        snapshots.append({
            "filename": f.name,
            "url":      f"/snapshots/image/{f.name}",
            "offset":   offset,
            "size_kb":  round(f.stat().st_size / 1024, 1),
            "taken_at": datetime.utcfromtimestamp(f.stat().st_mtime).isoformat() + "Z",
        })

    return {"alarm_id": alarm_id, "count": len(snapshots), "snapshots": snapshots}


@router.get("/image/{filename}")
async def serve_snapshot(filename: str):
    """Serve a snapshot image file."""
    # Security: prevent path traversal
    if ".." in filename or "/" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    filepath = SNAPSHOT_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")

    return FileResponse(str(filepath), media_type="image/jpeg")


@router.get("/recent")
async def recent_snapshots(limit: int = 20):
    """Latest N snapshots across all alarms — for dashboard overview."""
    files = sorted(SNAPSHOT_DIR.glob("*.jpg"), key=lambda f: f.stat().st_mtime, reverse=True)
    result = []
    for f in files[:limit]:
        result.append({
            "filename": f.name,
            "url":      f"/snapshots/image/{f.name}",
            "taken_at": datetime.utcfromtimestamp(f.stat().st_mtime).isoformat() + "Z",
            "size_kb":  round(f.stat().st_size / 1024, 1),
        })
    return {"count": len(result), "snapshots": result}


@router.delete("/alarm/{alarm_id}")
async def delete_alarm_snapshots(alarm_id: str):
    """Delete all snapshots for an alarm (called when alarm is cleared)."""
    alarm_safe = alarm_id.replace("/", "-").replace(" ", "_")
    files      = list(SNAPSHOT_DIR.glob(f"{alarm_safe}_*.jpg"))
    for f in files:
        f.unlink(missing_ok=True)
    return {"ok": True, "deleted": len(files)}
