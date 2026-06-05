"""
Event Processing Service  (port 8001)
Receives raw detection events from the YOLO service,
applies business rules, and forwards validated alarms to the Alarm Manager.
"""
import asyncio
import logging
import uuid
import httpx
from collections import defaultdict, deque
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

import sys, os
sys.path.insert(0, "/shared")
from models import DetectionEvent, SecurityAlarm, AlarmSeverity, AlarmStatus
from config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [EVENT-PROC] %(message)s")
log = logging.getLogger(__name__)

# Per-camera sliding window: stores recent confidences for frame-count rule
camera_windows: dict[str, deque] = defaultdict(lambda: deque(maxlen=settings.CONSECUTIVE_FRAMES_REQUIRED))


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Event Processing Service started")
    yield
    log.info("Event Processing Service stopped")


app = FastAPI(title="Event Processing Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ─── Business rules ──────────────────────────────────────────────────────────

def apply_rules(event: DetectionEvent, window: deque) -> tuple[bool, str]:
    """
    Returns (should_alarm, reason).
    Rules:
      1. confidence >= threshold
      2. detected in N consecutive frames
      3. site is in restricted-area list
    """
    if event.confidence < settings.MIN_CONFIDENCE:
        return False, f"confidence {event.confidence:.2f} below threshold {settings.MIN_CONFIDENCE}"

    window.append(event.confidence)

    if len(window) < settings.CONSECUTIVE_FRAMES_REQUIRED:
        return False, f"only {len(window)}/{settings.CONSECUTIVE_FRAMES_REQUIRED} consecutive detections"

    if settings.RESTRICTED_SITES and event.site_id not in settings.RESTRICTED_SITES:
        return False, f"site {event.site_id} not in restricted list"

    return True, "all rules passed"


def determine_severity(confidence: float) -> AlarmSeverity:
    if confidence >= 0.90:
        return AlarmSeverity.CRITICAL
    if confidence >= 0.75:
        return AlarmSeverity.MAJOR
    return AlarmSeverity.MINOR


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.post("/events/detection", status_code=202)
async def receive_detection(event: DetectionEvent):
    window = camera_windows[event.camera_id]
    passed, reason = apply_rules(event, window)

    log.info(f"[{event.camera_id}] conf={event.confidence:.2f} | rule={'PASS' if passed else 'FAIL'} | {reason}")

    if not passed:
        return {"status": "filtered", "reason": reason}

    # Build alarm and forward to alarm manager
    alarm = SecurityAlarm(
        alarm_id=str(uuid.uuid4()),
        site_id=event.site_id,
        camera_id=event.camera_id,
        severity=determine_severity(event.confidence),
        status=AlarmStatus.ACTIVE,
        description=f"Unauthorised person detected at {event.site_id} on {event.camera_id}",
        confidence=event.confidence,
        detection_count=len(window),
        first_detected=event.timestamp,
        last_updated=datetime.now(timezone.utc),
    )

    await forward_alarm(alarm)
    return {"status": "alarm_raised", "alarm_id": alarm.alarm_id, "severity": alarm.severity}


@app.get("/health")
async def health():
    return {"service": "event-processor", "status": "ok"}


@app.get("/stats")
async def stats():
    return {
        "active_cameras": len(camera_windows),
        "camera_windows": {
            cam: {"detections": len(w), "required": settings.CONSECUTIVE_FRAMES_REQUIRED}
            for cam, w in camera_windows.items()
        },
    }


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def forward_alarm(alarm: SecurityAlarm):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                f"{settings.ALARM_MANAGER_URL}/alarms",
                json=alarm.model_dump(mode="json"),
            )
            log.info(f"Alarm forwarded → {r.status_code} | {alarm.alarm_id}")
    except Exception as e:
        log.error(f"Failed to forward alarm: {e}")
