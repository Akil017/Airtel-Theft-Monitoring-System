"""WhatsApp alert service using CallMeBot"""
import httpx, asyncio, logging, os
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

router = APIRouter()
log = logging.getLogger("whatsapp")

class Recipient(BaseModel):
    phone: str
    apikey: str
    name: str = ""

class RecipientsUpdate(BaseModel):
    recipients: List[Recipient]

# In-memory store (loaded from env on startup)
_recipients: List[dict] = []

async def init_contacts_table(conn):
    """Called on startup - load recipients from env"""
    global _recipients
    raw = os.getenv("WHATSAPP_RECIPIENTS", "")
    _recipients = []
    for entry in raw.split(","):
        entry = entry.strip()
        if ":" in entry:
            phone, apikey = entry.split(":", 1)
            _recipients.append({"phone": phone.strip(), "apikey": apikey.strip(), "name": ""})
    log.info(f"WhatsApp: {len(_recipients)} recipients loaded")

@router.post("/settings/whatsapp")
async def update_recipients(body: RecipientsUpdate):
    global _recipients
    _recipients = [r.dict() for r in body.recipients]
    log.info(f"WhatsApp recipients updated: {len(_recipients)}")
    return {"status": "ok", "count": len(_recipients)}

@router.get("/settings/whatsapp")
async def get_recipients():
    return {"recipients": _recipients}

async def send_whatsapp_alert(alarm: dict):
    if not _recipients:
        log.info("No WhatsApp recipients configured"); return
    sev = alarm.get("severity","HIGH")
    icon = "🚨" if sev == "CRITICAL" else "⚠️"
    alm_id = str(alarm.get("alarm_id") or alarm.get("id",""))[:8].upper()
    msg = (
        f"{icon} *AIRTEL BTS {sev} ALERT*\n\n"
        f"*Alarm:* ALM-{alm_id}\n"
        f"*Site:* {alarm.get('site_id','—')}\n"
        f"*Camera:* {alarm.get('camera_id','—')}\n"
        f"*Threat:* {alarm.get('threat_level','INTRUSION DETECTED')}\n"
        f"*Persons:* {alarm.get('person_count',0)}\n"
        f"*Confidence:* {alarm.get('confidence',0)*100:.1f}%\n\n"
        f"🔴 *ACTION:* {alarm.get('response','DISPATCH SECURITY IMMEDIATELY')}\n\n"
        f"📊 NOC: http://74.225.144.11:3000\n"
        f"🎥 Live: http://74.225.144.11:8080/player.html\n\n"
        f"_Airtel BTS Monitoring — Assam Circle_"
    )
    for r in _recipients:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                resp = await c.get("https://api.callmebot.com/whatsapp.php",
                    params={"phone": r["phone"], "text": msg, "apikey": r["apikey"]})
                log.info(f"WhatsApp to {r['phone']}: {resp.status_code}")
        except Exception as e:
            log.error(f"WhatsApp failed for {r['phone']}: {e}")
