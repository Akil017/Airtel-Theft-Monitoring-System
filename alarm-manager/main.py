"""
Alarm Manager Service  (port 8002)
------------------------------------
Persists alarms to PostgreSQL, broadcasts over WebSocket,
integrates with eNode NOC REST API.

NOC Operators can:
  - Acknowledge an alarm (tech dispatched)
  - Clear an alarm (tech validated, work done, hooter stopped)

Hooter stop: on CLEAR, alarm-manager calls detector's /hooter/stop
endpoint so the relay turns off immediately.
"""
import asyncio, logging, httpx
from datetime import datetime, timezone
from typing import List, Optional
from contextlib import asynccontextmanager
from snapshot_router import router as snapshot_router
from whatsapp_service import router as whatsapp_router, init_contacts_table

import asyncio
import asyncpg
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import sys
sys.path.insert(0, "/shared")
from models import SecurityAlarm, AlarmAckRequest, AlarmClearRequest
from config import settings

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [ALARM-MGR] %(levelname)s: %(message)s")
log = logging.getLogger(__name__)

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS alarms (
    alarm_id        TEXT PRIMARY KEY,
    site_id         TEXT NOT NULL,
    camera_id       TEXT NOT NULL,
    severity        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE',
    threat_level    TEXT,
    description     TEXT,
    confidence      REAL NOT NULL,
    person_count    INTEGER NOT NULL DEFAULT 0,
    animal_count    INTEGER NOT NULL DEFAULT 0,
    detection_count INTEGER NOT NULL DEFAULT 1,
    response        TEXT,
    first_detected  TIMESTAMPTZ NOT NULL,
    last_updated    TIMESTAMPTZ NOT NULL,
    cleared_at      TIMESTAMPTZ,
    snapshot_path   TEXT,
    enode_alarm_id  TEXT,
    ack_operator    TEXT,
    ack_note        TEXT,
    clear_operator  TEXT,
    clear_reason    TEXT
);
"""

class WSManager:
    def __init__(self):
        self._clients = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._clients.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self._clients:
            self._clients.remove(ws)

    async def broadcast(self, payload: dict):
        dead = []
        for ws in self._clients:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self._clients.remove(ws)

    @property
    def count(self):
        return len(self._clients)


async def _send_whatsapp(alarm):
    payload = {
        "alarm_id": alarm.alarm_id,
        "site_id": alarm.site_id,
        "camera_id": alarm.camera_id,
        "severity": alarm.severity,
        "threat_level": alarm.threat_level or "INTRUSION DETECTED",
        "person_count": alarm.person_count or 0,
        "confidence": alarm.confidence or 0.0,
        "snapshot_url": None,
        "timestamp": alarm.first_detected.isoformat() + "Z",
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(
            "http://localhost:8002/alerts/whatsapp/send",
            json=payload
        )
ws_manager = WSManager()
db_pool: asyncpg.Pool = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    for attempt in range(15):
        try:
            db_pool = await asyncpg.create_pool(
                settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://"),
                min_size=2, max_size=10,
            )
            async with db_pool.acquire() as conn:
                await conn.execute(CREATE_TABLE)
            log.info("Database ready")
            break
        except Exception as exc:
            log.warning(f"DB attempt {attempt+1}/15: {exc}")
            await asyncio.sleep(3)
    else:
        raise RuntimeError("Cannot connect to PostgreSQL after 15 attempts")
    yield
    await db_pool.close()


app = FastAPI(title="Alarm Manager", version="2.0.0", lifespan=lifespan)
app.include_router(snapshot_router)
app.include_router(whatsapp_router)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── eNode integration ─────────────────────────────────────────────────────────
async def post_to_enode(alarm: dict) -> Optional[str]:
    if not settings.ENODE_API_URL:
        return None
    try:
        headers = {"X-API-Key": settings.ENODE_API_KEY or "", "Content-Type": "application/json"}
        payload = {
            "alarmType":   "SECURITY_INTRUSION",
            "severity":    alarm["severity"],
            "threatLevel": alarm.get("threat_level", ""),
            "source":      alarm["camera_id"],
            "description": alarm["description"],
            "timestamp":   alarm["first_detected"],
        }
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{settings.ENODE_API_URL}/api/alarms",
                                  json=payload, headers=headers)
            r.raise_for_status()
            eid = r.json().get("alarmId")
            log.info(f"eNode alarm created: {eid}")
            return eid
    except Exception as exc:
        log.error(f"eNode error: {exc}")
        return None


async def notify_enode_clear(alarm_id: str, enode_alarm_id: str, operator: str, reason: str):
    """Tell eNode NOC that this alarm has been cleared by an operator."""
    if not settings.ENODE_API_URL or not enode_alarm_id:
        return
    try:
        headers = {"X-API-Key": settings.ENODE_API_KEY or ""}
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{settings.ENODE_API_URL}/api/alarms/{enode_alarm_id}/clear",
                json={"operator": operator, "reason": reason},
                headers=headers
            )
    except Exception as exc:
        log.error(f"eNode clear notify error: {exc}")


async def stop_hooter_on_camera(camera_id: str):
    """
    Tell detection-service to stop the hooter for this camera.
    Called when NOC operator clears an alarm after tech validates the site.
    """
    if not settings.DETECTION_SERVICE_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                f"{settings.DETECTION_SERVICE_URL}/hooter/stop",
                json={"camera_id": camera_id}
            )
            log.info(f"Hooter stop sent for {camera_id} → {r.status_code}")
    except Exception as exc:
        log.warning(f"Hooter stop failed for {camera_id}: {exc}")


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"service": "alarm-manager", "status": "ok", "ws_clients": ws_manager.count}

@app.get("/stats")
async def get_stats():
    async with db_pool.acquire() as conn:
        total  = await conn.fetchval("SELECT COUNT(*) FROM alarms")
        active = await conn.fetchval("SELECT COUNT(*) FROM alarms WHERE status='ACTIVE'")
        acked  = await conn.fetchval("SELECT COUNT(*) FROM alarms WHERE status='ACKNOWLEDGED'")
    return {"total_alarms": total, "active_alarms": active,
            "acknowledged_alarms": acked, "ws_clients": ws_manager.count}

@app.post("/alarms", status_code=201)
async def create_alarm(alarm: SecurityAlarm):
    enode_id = await post_to_enode(alarm.model_dump(mode="json"))
    sev = alarm.severity if isinstance(alarm.severity, str) else alarm.severity.value
    sta = alarm.status   if isinstance(alarm.status,   str) else alarm.status.value

    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO alarms (
                alarm_id, site_id, camera_id, severity, status,
                threat_level, description, confidence,
                person_count, animal_count, detection_count,
                response, first_detected, last_updated,
                snapshot_path, enode_alarm_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT (alarm_id) DO NOTHING
        """,
        alarm.alarm_id, alarm.site_id, alarm.camera_id, sev, sta,
        alarm.threat_level, alarm.description, alarm.confidence,
        alarm.person_count, alarm.animal_count, alarm.detection_count,
        alarm.response, alarm.first_detected, alarm.last_updated,
        alarm.snapshot_path, enode_id)

    payload = {**alarm.model_dump(mode="json"), "enode_alarm_id": enode_id}
    await ws_manager.broadcast({"event": "ALARM_CREATED", "alarm": payload})
    log.info(f"Alarm created: {alarm.alarm_id} | {sev} | {alarm.threat_level}")
    asyncio.create_task(_send_whatsapp(alarm))
    return payload
@app.get("/alarms")
async def list_alarms(status: Optional[str] = None, limit: int = 100):
    async with db_pool.acquire() as conn:
        if status:
            rows = await conn.fetch(
                "SELECT * FROM alarms WHERE status=$1 ORDER BY first_detected DESC LIMIT $2",
                status.upper(), limit)
        else:
            rows = await conn.fetch(
                "SELECT * FROM alarms ORDER BY first_detected DESC LIMIT $1", limit)
    return [dict(r) for r in rows]

@app.post("/alarms/acknowledge")
async def acknowledge_alarm(req: AlarmAckRequest):
    """
    NOC operator acknowledges — tech has been dispatched to site.
    Hooter keeps ringing until Clear.
    """
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE alarms
               SET status='ACKNOWLEDGED', last_updated=$1,
                   ack_operator=$2, ack_note=$3
               WHERE alarm_id=$4 AND status='ACTIVE'
               RETURNING *""",
            datetime.now(timezone.utc), req.operator_id, req.note, req.alarm_id)
    if not row:
        raise HTTPException(404, f"Alarm {req.alarm_id} not found or already actioned")
    await ws_manager.broadcast({"event": "ALARM_ACKNOWLEDGED",
                                 "alarm_id": req.alarm_id,
                                 "operator": req.operator_id})
    return {"status": "acknowledged", "alarm_id": req.alarm_id}

@app.post("/alarms/clear")
async def clear_alarm(req: AlarmClearRequest):
    """
    NOC operator clears — tech has physically validated site, work confirmed real/false.
    This stops the hooter immediately via the detection service.
    """
    now = datetime.now(timezone.utc)
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE alarms
               SET status='CLEARED', cleared_at=$1, last_updated=$1,
                   clear_operator=$2, clear_reason=$3
               WHERE alarm_id=$4
               RETURNING *""",
            now, req.operator_id, req.reason, req.alarm_id)
    if not row:
        raise HTTPException(404, f"Alarm {req.alarm_id} not found")

    alarm_data = dict(row)

    # Stop the hooter on the physical camera
    await stop_hooter_on_camera(alarm_data["camera_id"])

    # Notify eNode if integrated
    if alarm_data.get("enode_alarm_id"):
        await notify_enode_clear(
            req.alarm_id, alarm_data["enode_alarm_id"],
            req.operator_id, req.reason or "Cleared by NOC"
        )

    await ws_manager.broadcast({"event": "ALARM_CLEARED",
                                 "alarm_id": req.alarm_id,
                                 "operator": req.operator_id,
                                 "reason": req.reason})
    return {"status": "cleared", "alarm_id": req.alarm_id}

@app.on_event("startup")
async def startup():
    await init_contacts_table()   

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=False)
