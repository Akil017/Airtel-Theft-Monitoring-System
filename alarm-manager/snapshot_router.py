"""Serves snapshot images saved by detection-service"""
import os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()
SNAPSHOT_DIR = Path(os.getenv("SNAPSHOT_DIR", "/shared/snapshots"))

@router.get("/snapshots/{filename}")
async def get_snapshot(filename: str):
    path = SNAPSHOT_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(str(path), media_type="image/jpeg")

@router.get("/snapshots")
async def list_snapshots():
    if not SNAPSHOT_DIR.exists():
        return []
    return [f.name for f in sorted(SNAPSHOT_DIR.glob("*.jpg"), key=lambda x: x.stat().st_mtime, reverse=True)[:50]]
