"""
Event Processor Service  (port 8001)
--------------------------------------
Receives detection events, applies business rules,
forwards validated alarms to Alarm Manager.

Severity matches demo.py exactly:
  1-2 intruders -> HIGH
  3+ intruders  -> CRITICAL
"""
import asyncio, logging, uuid, httpx
from collections import defaultdict, deque
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys
sys.path.insert(0, "/shared")
from models import DetectionEvent, SecurityAlarm, AlarmSeverity, AlarmStatus
from config import settings

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [EVENT-PROC] %(levelname)s: %(message)s")
log = logging.getLogger(__name__)

camera_windows: dict = defaultdict(lambda: deque(maxlen=settings.CONSECUTIVE_FRAMES_REQUIRED))
camera_labels:  dict = defaultdict(list)


@asynccontextmanager
async def lifespan(app):
    log.info("Event Processor started")
    yield

app = FastAPI(title="Event Processor", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Severity helpers — mirrors demo.py ───────────────────────────────────────
def get_severity(person_count: int) -> AlarmSeverity:
    return AlarmSeverity.CRITICAL if person_count >= 3 else AlarmSeverity.HIGH

def get_threat_level(total: int, labels: list) -> str:
    humans  = labels.count("Person")
    animals = total - humans
    if total == 0:               return "NONE"
    if humans == 0 and animals:  return f"ANIMAL INTRUSION ({animals} animal{'s' if animals > 1 else ''})"
    if total >= 3:               return "MASS INTRUSION"
    if total == 2:               return "COORDINATED INTRUSION"
    return "SINGLE INTRUDER"

def get_response(total: int, labels: list) -> str:
    humans  = labels.count("Person")
    animals = total - humans
    if humans == 0 and animals:  return "INVESTIGATE — ANIMAL IN RESTRICTED ZONE"
    if total >= 3:               return "DISPATCH MULTIPLE UNITS — MASS INTRUSION"
    if total == 2:               return "DISPATCH SECURITY — COORDINATED ENTRY SUSPECTED"
    return "DISPATCH SECURITY — SINGLE INTRUDER DETECTED"


# ── Business rules ────────────────────────────────────────────────────────────
def apply_rules(event: DetectionEvent, window: deque, labels: list) -> tuple:
    if event.confidence < settings.MIN_CONFIDENCE:
        return False, f"confidence {event.confidence:.2f} < {settings.MIN_CONFIDENCE}"

    window.append(event.confidence)
    labels.append(event.label)
    while len(labels) > settings.CONSECUTIVE_FRAMES_REQUIRED:
        labels.pop(0)

    if len(window) < settings.CONSECUTIVE_FRAMES_REQUIRED:
        return False, f"only {len(window)}/{settings.CONSECUTIVE_FRAMES_REQUIRED} consecutive frames"

    if settings.RESTRICTED_SITES and event.site_id not in settings.RESTRICTED_SITES:
        return False, f"site {event.site_id} not restricted"

    return True, "all rules passed"


# ── Routes ────────────────────────────────────────────────────────────────────
@app.post("/events/detection", status_code=202)
async def receive_detection(event: DetectionEvent):
    window = camera_windows[event.camera_id]
    labels = camera_labels[event.camera_id]
    passed, reason = apply_rules(event, window, labels)

    log.info(f"[{event.camera_id}] {event.label} conf={event.confidence:.2f} "
             f"{'PASS' if passed else 'FAIL'} | {reason}")

    if not passed:
        return {"status": "filtered", "reason": reason}

    person_count = labels.count("Person")
    animal_count = len(labels) - person_count
    total        = len(labels)
    severity     = get_severity(person_count)
    threat       = get_threat_level(total, labels)
    response     = get_response(total, labels)

    alarm = SecurityAlarm(
        alarm_id        = str(uuid.uuid4()),
        site_id         = event.site_id,
        camera_id       = event.camera_id,
        severity        = severity,
        status          = AlarmStatus.ACTIVE,
        threat_level    = threat,
        description     = f"{threat} at {event.site_id} — {event.camera_id}",
        confidence      = event.confidence,
        person_count    = person_count,
        animal_count    = animal_count,
        detection_count = len(window),
        response        = response,
        first_detected  = event.timestamp,
        last_updated    = datetime.now(timezone.utc),
    )

    await forward_alarm(alarm)
    camera_windows[event.camera_id].clear()
    camera_labels[event.camera_id].clear()

    return {"status": "alarm_raised", "alarm_id": alarm.alarm_id,
            "severity": alarm.severity, "threat": threat}


@app.get("/health")
async def health():
    return {"service": "event-processor", "status": "ok"}

@app.get("/stats")
async def stats():
    return {
        "active_cameras": len(camera_windows),
        "camera_windows": {
            cam: {"detections": len(w), "required": settings.CONSECUTIVE_FRAMES_REQUIRED,
                  "labels": list(camera_labels[cam])}
            for cam, w in camera_windows.items()
        },
    }

async def forward_alarm(alarm: SecurityAlarm):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(f"{settings.ALARM_MANAGER_URL}/alarms",
                                  json=alarm.model_dump(mode="json"))
            log.info(f"Alarm forwarded -> {r.status_code} | {alarm.alarm_id} | {alarm.threat_level}")
    except Exception as e:
        log.error(f"Failed to forward alarm: {e}")
