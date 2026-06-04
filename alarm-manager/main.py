"""
Alarm Manager Service  (port 8002)
------------------------------------
Responsibilities:
  1. Persist alarm events to PostgreSQL
  2. Broadcast new/updated alarms over WebSocket to the dashboard
  3. POST alarm to eNode REST API (optional — set ENODE_URL env var)
  4. Expose REST endpoints for dashboard (list, acknowledge, clear)
"""

import asyncio
import httpx
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, List

import asyncpg
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [alarm-manager] %(levelname)s: %(message)s"
)
log = logging.getLogger(__name__)

app = FastAPI(
    title="Alarm Manager",
    description="Persists alarms, broadcasts over WebSocket, integrates with eNode.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Configuration ────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://airtel:airtelpass@postgres:5432/alarmdb"
)
ENODE_URL = os.getenv("ENODE_URL", "")           # leave blank to skip eNode
ENODE_API_KEY = os.getenv("ENODE_API_KEY", "")

# ── WebSocket connection manager ──────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        log.info(f"WS client connected. Total: {len(self.active)}")

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)
        log.info(f"WS client disconnected. Total: {len(self.active)}")

    async def broadcast(self, message: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.remove(ws)


manager = ConnectionManager()
db_pool: asyncpg.Pool | None = None


# ── DB setup ─────────────────────────────────────────────────────────────────
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS alarms (
    id            TEXT PRIMARY KEY,
    camera_id     TEXT NOT NULL,
    site_id       TEXT,
    zone_id       TEXT,
    severity      TEXT NOT NULL DEFAULT 'HIGH',
    status        TEXT NOT NULL DEFAULT 'ACTIVE',
    confidence    REAL NOT NULL,
    timestamp     TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    cleared_at    TIMESTAMPTZ,
    snapshot_path TEXT,
    enode_alarm_id TEXT
);
"""


@app.on_event("startup")
async def startup():
    global db_pool
    retries = 10
    for i in range(retries):
        try:
            db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
            async with db_pool.acquire() as conn:
                await conn.execute(CREATE_TABLE_SQL)
            log.info("Database connected and schema ready")
            return
        except Exception as exc:
            log.warning(f"DB connect attempt {i+1}/{retries} failed: {exc}")
            await asyncio.sleep(3)
    raise RuntimeError("Could not connect to database after retries")


@app.on_event("shutdown")
async def shutdown():
    if db_pool:
        await db_pool.close()


# ── Models ───────────────────────────────────────────────────────────────────
class IncomingAlarm(BaseModel):
    camera_id: str
    site_id: Optional[str] = None
    zone_id: Optional[str] = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    snapshot_path: Optional[str] = None


class AlarmRecord(BaseModel):
    id: str
    camera_id: str
    site_id: Optional[str]
    zone_id: Optional[str]
    severity: str
    status: str
    confidence: float
    timestamp: datetime
    acknowledged_at: Optional[datetime]
    cleared_at: Optional[datetime]
    snapshot_path: Optional[str]
    enode_alarm_id: Optional[str]


class AlarmUpdate(BaseModel):
    status: str       # ACKNOWLEDGED | CLEARED
    notes: Optional[str] = None


# ── eNode integration ─────────────────────────────────────────────────────────
async def post_to_enode(alarm: dict) -> Optional[str]:
    if not ENODE_URL:
        log.info("eNode URL not configured — skipping eNode integration")
        return None
    try:
        payload = {
            "alarmType": "SECURITY_INTRUSION",
            "severity": "MAJOR",
            "source": alarm["camera_id"],
            "description": (
                f"Human detected at {alarm.get('site_id','unknown')} "
                f"zone {alarm.get('zone_id','unknown')} "
                f"(confidence {alarm['confidence']:.0%})"
            ),
            "timestamp": alarm["timestamp"],
        }
        headers = {"X-API-Key": ENODE_API_KEY, "Content-Type": "application/json"}
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{ENODE_URL}/api/alarms", json=payload, headers=headers, timeout=10
            )
            resp.raise_for_status()
            enode_id = resp.json().get("alarmId")
            log.info(f"eNode alarm created: {enode_id}")
            return enode_id
    except Exception as exc:
        log.error(f"eNode integration failed: {exc}")
        return None


# ── Routes ───────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "alarm-manager", "ws_clients": len(manager.active)}


@app.post("/alarm", response_model=AlarmRecord)
async def create_alarm(incoming: IncomingAlarm):
    alarm_id = str(uuid.uuid4())

    # Determine severity from confidence
    if incoming.confidence >= 0.95:
        severity = "CRITICAL"
    elif incoming.confidence >= 0.85:
        severity = "HIGH"
    elif incoming.confidence >= 0.70:
        severity = "MEDIUM"
    else:
        severity = "LOW"

    alarm_dict = {
        "id": alarm_id,
        "camera_id": incoming.camera_id,
        "site_id": incoming.site_id,
        "zone_id": incoming.zone_id,
        "severity": severity,
        "status": "ACTIVE",
        "confidence": incoming.confidence,
        "timestamp": incoming.timestamp,
        "acknowledged_at": None,
        "cleared_at": None,
        "snapshot_path": incoming.snapshot_path,
        "enode_alarm_id": None,
    }

    # 1. Post to eNode (optional, non-blocking)
    enode_id = await post_to_enode(alarm_dict)
    alarm_dict["enode_alarm_id"] = enode_id

    # 2. Persist to PostgreSQL
    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO alarms
              (id, camera_id, site_id, zone_id, severity, status, confidence,
               timestamp, snapshot_path, enode_alarm_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            """,
            alarm_id, incoming.camera_id, incoming.site_id, incoming.zone_id,
            severity, "ACTIVE", incoming.confidence, incoming.timestamp,
            incoming.snapshot_path, enode_id,
        )

    # 3. Broadcast via WebSocket
    await manager.broadcast({"event": "new_alarm", "alarm": {
        **alarm_dict,
        "timestamp": alarm_dict["timestamp"].isoformat(),
    }})

    log.info(f"Alarm created: {alarm_id} | {severity} | {incoming.camera_id}")
    return AlarmRecord(**alarm_dict)


@app.get("/alarms", response_model=List[AlarmRecord])
async def list_alarms(status: Optional[str] = None, limit: int = 100):
    async with db_pool.acquire() as conn:
        if status:
            rows = await conn.fetch(
                "SELECT * FROM alarms WHERE status=$1 ORDER BY timestamp DESC LIMIT $2",
                status.upper(), limit
            )
        else:
            rows = await conn.fetch(
                "SELECT * FROM alarms ORDER BY timestamp DESC LIMIT $1", limit
            )
    return [AlarmRecord(**dict(row)) for row in rows]


@app.patch("/alarms/{alarm_id}", response_model=AlarmRecord)
async def update_alarm(alarm_id: str, update: AlarmUpdate):
    now = datetime.now(timezone.utc)
    new_status = update.status.upper()

    if new_status not in ("ACKNOWLEDGED", "CLEARED"):
        raise HTTPException(400, "status must be ACKNOWLEDGED or CLEARED")

    async with db_pool.acquire() as conn:
        if new_status == "ACKNOWLEDGED":
            row = await conn.fetchrow(
                "UPDATE alarms SET status=$1, acknowledged_at=$2 WHERE id=$3 RETURNING *",
                new_status, now, alarm_id
            )
        else:
            row = await conn.fetchrow(
                "UPDATE alarms SET status=$1, cleared_at=$2 WHERE id=$3 RETURNING *",
                new_status, now, alarm_id
            )

    if not row:
        raise HTTPException(404, f"Alarm {alarm_id} not found")

    alarm = AlarmRecord(**dict(row))
    await manager.broadcast({"event": "alarm_updated", "alarm": {
        **dict(row),
        "timestamp": row["timestamp"].isoformat(),
        "acknowledged_at": row["acknowledged_at"].isoformat() if row["acknowledged_at"] else None,
        "cleared_at": row["cleared_at"].isoformat() if row["cleared_at"] else None,
    }})
    return alarm


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()   # keep-alive / ping
    except WebSocketDisconnect:
        manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=False)
