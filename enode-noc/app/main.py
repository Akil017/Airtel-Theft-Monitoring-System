"""
eNode NOC Server
-----------------
Temporary/production NOC server for Airtel BTS Theft Monitoring System.
Receives alarms from alarm-manager, serves the NOC operator dashboard.

Endpoints:
  POST /api/alarms              — receive alarm from alarm-manager
  POST /api/alarms/:id/clear    — clear alarm (from dashboard or API)
  GET  /api/alarms              — list alarms
  GET  /api/alarms/active       — active alarms only
  GET  /                        — NOC dashboard UI
  WS   /ws                      — real-time push to dashboard
"""
import uuid, logging, asyncio
from datetime import datetime, timezone
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [ENODE-NOC] %(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ── In-memory store (swap for PostgreSQL in prod) ─────────────────────────────
alarms_db: dict = {}   # alarm_id -> dict


# ── WebSocket ─────────────────────────────────────────────────────────────────
class WSManager:
    def __init__(self):
        self._clients: List[WebSocket] = []

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
        for d in dead:
            self._clients.remove(d)

ws_manager = WSManager()


# ── Models ────────────────────────────────────────────────────────────────────
class IncomingAlarm(BaseModel):
    alarmType:   str = "SECURITY_INTRUSION"
    severity:    str = "HIGH"
    threatLevel: str = ""
    source:      str = ""
    description: str = ""
    timestamp:   str = ""

class ClearRequest(BaseModel):
    operator: str = "NOC"
    reason:   str = ""


# ── App ───────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    log.info("eNode NOC Server started")
    yield

app = FastAPI(title="eNode NOC Server", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.post("/api/alarms", status_code=201)
async def receive_alarm(alarm: IncomingAlarm):
    alarm_id = str(uuid.uuid4())[:8].upper()
    record = {
        "alarmId":     alarm_id,
        "alarmType":   alarm.alarmType,
        "severity":    alarm.severity,
        "threatLevel": alarm.threatLevel,
        "source":      alarm.source,
        "description": alarm.description,
        "status":      "ACTIVE",
        "timestamp":   alarm.timestamp or datetime.now(timezone.utc).isoformat(),
        "receivedAt":  datetime.now(timezone.utc).isoformat(),
        "clearedAt":   None,
        "clearedBy":   None,
        "clearReason": None,
    }
    alarms_db[alarm_id] = record
    await ws_manager.broadcast({"event": "ALARM_RECEIVED", "alarm": record})
    log.info(f"Alarm received: {alarm_id} | {alarm.severity} | {alarm.threatLevel} | {alarm.source}")
    return {"alarmId": alarm_id, "status": "received"}


@app.post("/api/alarms/{alarm_id}/clear")
async def clear_alarm(alarm_id: str, req: ClearRequest):
    if alarm_id not in alarms_db:
        raise HTTPException(404, f"Alarm {alarm_id} not found")
    alarms_db[alarm_id].update({
        "status":      "CLEARED",
        "clearedAt":   datetime.now(timezone.utc).isoformat(),
        "clearedBy":   req.operator,
        "clearReason": req.reason,
    })
    await ws_manager.broadcast({
        "event":    "ALARM_CLEARED",
        "alarmId":  alarm_id,
        "operator": req.operator,
        "reason":   req.reason,
    })
    log.info(f"Alarm cleared: {alarm_id} by {req.operator}")
    return {"alarmId": alarm_id, "status": "cleared"}


@app.get("/api/alarms")
async def list_alarms():
    return sorted(alarms_db.values(), key=lambda x: x["receivedAt"], reverse=True)


@app.get("/api/alarms/active")
async def active_alarms():
    return [a for a in alarms_db.values() if a["status"] == "ACTIVE"]


@app.get("/api/stats")
async def stats():
    total   = len(alarms_db)
    active  = sum(1 for a in alarms_db.values() if a["status"] == "ACTIVE")
    cleared = total - active
    return {"total": total, "active": active, "cleared": cleared,
            "ws_clients": ws_manager.count}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


@app.get("/health")
async def health():
    return {"service": "enode-noc", "status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def dashboard():
    with open("/app/static/index.html") as f:
        return f.read()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9000, reload=False)
