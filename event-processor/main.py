"""
Event Processor Service  (port 8001)
--------------------------------------
Receives raw detection events from the Detection Service,
applies business rules (confidence threshold, consecutive-frame
sliding window, restricted-area check), and forwards valid
alarm events to the Alarm Manager.
"""

import httpx
import logging
import os
from collections import defaultdict, deque
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Deque

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [event-processor] %(levelname)s: %(message)s"
)
log = logging.getLogger(__name__)

app = FastAPI(
    title="Event Processor",
    description="Applies business rules to raw detection events before raising alarms.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Configuration ────────────────────────────────────────────────────────────
ALARM_MANAGER_URL = os.getenv("ALARM_MANAGER_URL", "http://alarm-manager:8002/alarm")
MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.80"))
CONSECUTIVE_FRAMES = int(os.getenv("CONSECUTIVE_FRAMES", "3"))
RESTRICTED_SITES = set(
    os.getenv("RESTRICTED_SITES", "BTS_SITE_001,BTS_SITE_002,BTS_SITE_003").split(",")
)
WINDOW_SECONDS = int(os.getenv("WINDOW_SECONDS", "30"))

# Sliding window: camera_id → deque of (timestamp, confidence) tuples
detection_windows: dict[str, Deque] = defaultdict(lambda: deque())


# ── Models ───────────────────────────────────────────────────────────────────
class DetectionEvent(BaseModel):
    camera_id: str
    event_type: str = "HUMAN_DETECTED"
    confidence: float = Field(..., ge=0.0, le=1.0)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    site_id: Optional[str] = None
    zone_id: Optional[str] = None
    bbox: Optional[dict] = None
    snapshot_path: Optional[str] = None


# ── Business Rule Engine ──────────────────────────────────────────────────────
def evaluate(event: DetectionEvent) -> tuple[bool, str]:
    """
    Returns (should_alarm, reason).
    Rules (all must pass):
      1. confidence >= MIN_CONFIDENCE
      2. site_id in RESTRICTED_SITES
      3. at least CONSECUTIVE_FRAMES detections within WINDOW_SECONDS
    """
    # Rule 1 — confidence
    if event.confidence < MIN_CONFIDENCE:
        return False, f"confidence {event.confidence:.2f} < threshold {MIN_CONFIDENCE}"

    # Rule 2 — restricted area
    if event.site_id and event.site_id not in RESTRICTED_SITES:
        return False, f"site '{event.site_id}' is not a restricted site"

    # Rule 3 — consecutive frames / sliding window
    window = detection_windows[event.camera_id]
    now = event.timestamp.timestamp()
    window.append((now, event.confidence))

    # Evict entries older than WINDOW_SECONDS
    while window and (now - window[0][0]) > WINDOW_SECONDS:
        window.popleft()

    if len(window) < CONSECUTIVE_FRAMES:
        return False, (
            f"only {len(window)}/{CONSECUTIVE_FRAMES} consecutive detections "
            f"within {WINDOW_SECONDS}s window"
        )

    return True, "all business rules passed"


async def forward_alarm(event: DetectionEvent, avg_confidence: float) -> None:
    payload = {
        "camera_id": event.camera_id,
        "site_id": event.site_id,
        "zone_id": event.zone_id,
        "confidence": avg_confidence,
        "timestamp": event.timestamp.isoformat(),
        "snapshot_path": event.snapshot_path,
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(ALARM_MANAGER_URL, json=payload, timeout=5)
            resp.raise_for_status()
            log.info(f"Alarm forwarded to manager → {resp.status_code}")
    except Exception as exc:
        log.error(f"Failed to forward alarm: {exc}")


# ── Routes ───────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "event-processor"}


@app.post("/detection")
async def receive_detection(event: DetectionEvent):
    log.info(
        f"Received event | camera={event.camera_id} "
        f"conf={event.confidence:.2f} site={event.site_id}"
    )

    should_alarm, reason = evaluate(event)
    log.info(f"Evaluation → alarm={should_alarm} | reason: {reason}")

    if should_alarm:
        window = detection_windows[event.camera_id]
        avg_conf = round(sum(c for _, c in window) / len(window), 4)
        await forward_alarm(event, avg_conf)
        # Reset window after alarm to avoid duplicate alarms
        detection_windows[event.camera_id].clear()
        return {"status": "alarm_raised", "reason": reason, "avg_confidence": avg_conf}

    return {"status": "filtered", "reason": reason}


@app.get("/windows")
def get_windows():
    """Debug endpoint — shows current sliding window state per camera."""
    return {
        cam: [{"ts": ts, "conf": conf} for ts, conf in list(window)]
        for cam, window in detection_windows.items()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=False)
