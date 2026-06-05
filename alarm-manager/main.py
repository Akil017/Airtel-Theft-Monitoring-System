"""
Alarm Manager Service  (port 8002)
Persists alarms to PostgreSQL, broadcasts over WebSocket,
integrates with eNode REST API.
"""
import asyncio
import logging
import httpx
from datetime import datetime, timezone
from typing import List, Optional
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import sys
sys.path.insert(0, "/shared")
from models import SecurityAlarm, AlarmAckRequest, AlarmClearRequest, AlarmStatus
from config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ALARM-MGR] %(message)s")
log = logging.getLogger(__name__)

# ─── DB Schema ───────────────────────────────────────────────────────────────

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS alarms (
    alarm_id        TEXT PRIMARY KEY,
    site_id         TEXT NOT NULL,
    camera_id       TEXT NOT NULL,
    severity        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'ACTIVE',
    description     TEXT,
    confidence      REAL NOT NULL,
    detection_count INTEGER NOT NULL DEFAULT 1,
    first_detected  TIMESTAMPTZ NOT NULL,
    last_updated    TIMESTAMPTZ NOT NULL,
    cleared_at      TIMESTAMPTZ,
    enode_alarm_id  TEXT
);
"""

# ─── WebSocket manager ────────────────────────────────────────────────────────

class WSManager:
    def __init__(self):
        self._clients: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._clients.append(ws)
        log.info(f"WS connect. Clients: {len(self._clients)}")

    def disconnect(self, ws: WebSocket):
        self._clients.remove(ws)
        log.info(f"WS disconnect. Clients: {len(self._clients)}")

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


ws_manager = WSManager()
db_pool: asyncpg.Pool = None


# ─── App lifespan ─────────────────────────────────────────────────────────────

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
        raise RuntimeError("Cannot connect to PostgreSQL")

    yield

    await db_pool.close()


app = FastAPI(title="Alarm Manager", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ─── eNode helper ─────────────────────────────────────────────────────────────

async def post_to_enode(alarm: dict) -> Optional[str]:
    if not settings.ENODE_API_URL:
        return None
    try:
        headers = {"X-API-Key": settings.ENODE_API_KEY or "", "Content-Type": "application/json"}
        payload = {
            "alarmType": "SECURITY_INTRUSION",
            "severity": alarm["severity"],
            "source": alarm["camera_id"],
            "description": alarm["description"],
            "timestamp": alarm["first_detected"],
        }
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{settings.ENODE_API_URL}/api/alarms", json=payload, headers=headers)
            r.raise_for_status()
            eid = r.json().get("alarmId")
            log.info(f"eNode alarm created: {eid}")
            return eid
    except Exception as exc:
        log.error(f"eNode error: {exc}")
        return None


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"service": "alarm-manager", "status": "ok", "ws_clients": ws_manager.count}


@app.get("/stats")
async def get_stats():
    async with db_pool.acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM alarms")
        active = await conn.fetchval("SELECT COUNT(*) FROM alarms WHERE status='ACTIVE'")
    return {
        "total_alarms": total,
        "active_alarms": active,
        "ws_clients": ws_manager.count,
    }


@app.post("/alarms", status_code=201)
async def create_alarm(alarm: SecurityAlarm):
    # Optional eNode integration
    enode_id = await post_to_enode(alarm.model_dump(mode="json"))

    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO alarms
              (alarm_id, site_id, camera_id, severity, status, description,
               confidence, detection_count, first_detected, last_updated, enode_alarm_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (alarm_id) DO NOTHING
            """,
            alarm.alarm_id, alarm.site_id, alarm.camera_id,
            alarm.severity if isinstance(alarm.severity, str) else alarm.severity.value,
            alarm.status if isinstance(alarm.status, str) else alarm.status.value,
            alarm.description, alarm.confidence, alarm.detection_count,
            alarm.first_detected, alarm.last_updated, enode_id,
        )

    payload = {**alarm.model_dump(mode="json"), "enode_alarm_id": enode_id}
    await ws_manager.broadcast({"event": "ALARM_CREATED", "alarm": payload})
    log.info(f"Alarm created: {alarm.alarm_id} | {alarm.severity} | {alarm.site_id}")
    return payload


@app.get("/alarms")
async def list_alarms(status: Optional[str] = None, limit: int = 100):
    async with db_pool.acquire() as conn:
        if status:
            rows = await conn.fetch(
                "SELECT * FROM alarms WHERE status=$1 ORDER BY first_detected DESC LIMIT $2",
                status.upper(), limit,
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM alarms ORDER BY first_detected DESC LIMIT $1", limit
            )
    return [dict(r) for r in rows]


@app.post("/alarms/acknowledge")
async def acknowledge_alarm(req: AlarmAckRequest):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE alarms SET status='ACKNOWLEDGED', last_updated=$1 WHERE alarm_id=$2 RETURNING *",
            datetime.now(timezone.utc), req.alarm_id,
        )
    if not row:
        raise HTTPException(404, f"Alarm {req.alarm_id} not found")
    await ws_manager.broadcast({"event": "ALARM_ACKNOWLEDGED", "alarm_id": req.alarm_id})
    return {"status": "acknowledged", "alarm_id": req.alarm_id}


@app.post("/alarms/clear")
async def clear_alarm(req: AlarmClearRequest):
    now = datetime.now(timezone.utc)
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE alarms SET status='CLEARED', cleared_at=$1, last_updated=$1 WHERE alarm_id=$2 RETURNING *",
            now, req.alarm_id,
        )
    if not row:
        raise HTTPException(404, f"Alarm {req.alarm_id} not found")
    await ws_manager.broadcast({"event": "ALARM_CLEARED", "alarm_id": req.alarm_id})
    return {"status": "cleared", "alarm_id": req.alarm_id}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()   # keep-alive ping/pong
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=False)
