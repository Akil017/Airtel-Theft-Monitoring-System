"""
Alarm Manager / eNode Integration Service  (port 8002)
- Stores alarms in PostgreSQL
- Broadcasts live updates via WebSocket
- Exposes REST for dashboard & future Netcool connector
- Calls eNode REST API to create / update / clear alarms
"""
import logging
import asyncio
import httpx
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import databases
import sqlalchemy

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../shared"))
from models import SecurityAlarm, AlarmStatus, AlarmSeverity, AlarmAckRequest, AlarmClearRequest
from config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ALARM-MGR] %(message)s")
log = logging.getLogger(__name__)

# ─── Database setup ──────────────────────────────────────────────────────────

database = databases.Database(settings.DATABASE_URL)
metadata = sqlalchemy.MetaData()

alarms_table = sqlalchemy.Table(
    "alarms", metadata,
    sqlalchemy.Column("alarm_id", sqlalchemy.String, primary_key=True),
    sqlalchemy.Column("site_id", sqlalchemy.String, index=True),
    sqlalchemy.Column("camera_id", sqlalchemy.String),
    sqlalchemy.Column("severity", sqlalchemy.String),
    sqlalchemy.Column("status", sqlalchemy.String, index=True),
    sqlalchemy.Column("description", sqlalchemy.Text),
    sqlalchemy.Column("confidence", sqlalchemy.Float),
    sqlalchemy.Column("detection_count", sqlalchemy.Integer),
    sqlalchemy.Column("first_detected", sqlalchemy.DateTime(timezone=True)),
    sqlalchemy.Column("last_updated", sqlalchemy.DateTime(timezone=True)),
    sqlalchemy.Column("cleared_at", sqlalchemy.DateTime(timezone=True), nullable=True),
    sqlalchemy.Column("enode_alarm_id", sqlalchemy.String, nullable=True),
)

engine = sqlalchemy.create_engine(settings.DATABASE_URL.replace("+asyncpg", ""))


# ─── WebSocket connection manager ────────────────────────────────────────────

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

    async def broadcast(self, data: dict):
        for ws in list(self.active):
            try:
                await ws.send_json(data)
            except Exception:
                self.active.remove(ws)


manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    metadata.create_all(engine)
    await database.connect()
    log.info("Alarm Manager started — DB connected")
    yield
    await database.disconnect()


app = FastAPI(title="Alarm Manager", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.post("/alarms", status_code=201)
async def create_alarm(alarm: SecurityAlarm):
    # Persist to DB
    await database.execute(
        alarms_table.insert().values(
            alarm_id=alarm.alarm_id,
            site_id=alarm.site_id,
            camera_id=alarm.camera_id,
            severity=alarm.severity,
            status=alarm.status,
            description=alarm.description,
            confidence=alarm.confidence,
            detection_count=alarm.detection_count,
            first_detected=alarm.first_detected,
            last_updated=alarm.last_updated,
            cleared_at=None,
            enode_alarm_id=None,
        )
    )

    # Push to eNode
    enode_id = await push_to_enode(alarm)
    if enode_id:
        await database.execute(
            alarms_table.update()
            .where(alarms_table.c.alarm_id == alarm.alarm_id)
            .values(enode_alarm_id=enode_id)
        )

    # Broadcast to dashboard WebSocket clients
    await manager.broadcast({
        "event": "ALARM_CREATED",
        "alarm": alarm.model_dump(mode="json"),
    })

    log.info(f"Alarm created: {alarm.alarm_id} | {alarm.severity} | {alarm.site_id}")
    return {"alarm_id": alarm.alarm_id, "enode_alarm_id": enode_id}


@app.get("/alarms", response_model=List[dict])
async def list_alarms(status: Optional[str] = None, site_id: Optional[str] = None, limit: int = 50):
    query = alarms_table.select().order_by(alarms_table.c.last_updated.desc()).limit(limit)
    if status:
        query = query.where(alarms_table.c.status == status)
    if site_id:
        query = query.where(alarms_table.c.site_id == site_id)
    rows = await database.fetch_all(query)
    return [dict(r) for r in rows]


@app.get("/alarms/{alarm_id}")
async def get_alarm(alarm_id: str):
    row = await database.fetch_one(
        alarms_table.select().where(alarms_table.c.alarm_id == alarm_id)
    )
    if not row:
        raise HTTPException(404, "Alarm not found")
    return dict(row)


@app.post("/alarms/acknowledge")
async def acknowledge_alarm(req: AlarmAckRequest):
    now = datetime.now(timezone.utc)
    await database.execute(
        alarms_table.update()
        .where(alarms_table.c.alarm_id == req.alarm_id)
        .values(status=AlarmStatus.ACKNOWLEDGED, last_updated=now)
    )
    await manager.broadcast({"event": "ALARM_ACKNOWLEDGED", "alarm_id": req.alarm_id, "operator": req.operator_id})
    return {"status": "acknowledged"}


@app.post("/alarms/clear")
async def clear_alarm(req: AlarmClearRequest):
    now = datetime.now(timezone.utc)
    await database.execute(
        alarms_table.update()
        .where(alarms_table.c.alarm_id == req.alarm_id)
        .values(status=AlarmStatus.CLEARED, cleared_at=now, last_updated=now)
    )
    await manager.broadcast({"event": "ALARM_CLEARED", "alarm_id": req.alarm_id})
    return {"status": "cleared"}


@app.get("/stats")
async def stats():
    total = await database.fetch_val(sqlalchemy.select(sqlalchemy.func.count()).select_from(alarms_table))
    active = await database.fetch_val(
        sqlalchemy.select(sqlalchemy.func.count())
        .select_from(alarms_table)
        .where(alarms_table.c.status == "ACTIVE")
    )
    return {"total_alarms": total, "active_alarms": active, "ws_clients": len(manager.active)}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()   # keep-alive ping handling
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/health")
async def health():
    return {"service": "alarm-manager", "status": "ok"}


# ─── eNode integration ───────────────────────────────────────────────────────

async def push_to_enode(alarm: SecurityAlarm) -> Optional[str]:
    """POST alarm to eNode REST API. Returns eNode alarm ID or None."""
    if not settings.ENODE_API_URL:
        log.info("eNode URL not configured — skipping push")
        return None
    payload = {
        "alarmType": "INTRUSION",
        "severity": alarm.severity,
        "source": alarm.site_id,
        "camera": alarm.camera_id,
        "description": alarm.description,
        "timestamp": alarm.first_detected.isoformat(),
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            headers = {"Authorization": f"Bearer {settings.ENODE_API_KEY}"}
            r = await client.post(f"{settings.ENODE_API_URL}/alarms", json=payload, headers=headers)
            r.raise_for_status()
            enode_id = r.json().get("alarmId")
            log.info(f"eNode alarm created: {enode_id}")
            return enode_id
    except Exception as e:
        log.warning(f"eNode push failed: {e}")
        return None
