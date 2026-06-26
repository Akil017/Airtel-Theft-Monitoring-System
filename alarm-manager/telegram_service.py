"""
Telegram Alert Service — replaces WhatsApp/CallMeBot
Sends alarm notifications with snapshot photos to Telegram.
"""
import httpx, logging, os
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()
log = logging.getLogger("telegram")

SNAPSHOT_DIR = Path(os.getenv("SNAPSHOT_DIR", "/shared/snapshots"))

class TelegramSettings(BaseModel):
    bot_token: str
    chat_id: str

# Runtime config — loaded from env, overridable via API
_bot_token: str = ""
_chat_id:   str = ""

def init_telegram():
    global _bot_token, _chat_id
    _bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    _chat_id   = os.getenv("TELEGRAM_CHAT_ID",   "")
    if _bot_token and _chat_id:
        log.info("Telegram: configured OK")
    else:
        log.warning("Telegram: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set")

@router.get("/settings/telegram")
async def get_telegram_settings():
    return {
        "configured": bool(_bot_token and _chat_id),
        "chat_id": _chat_id,
        "bot_token_set": bool(_bot_token),
    }

@router.post("/settings/telegram")
async def update_telegram_settings(body: TelegramSettings):
    global _bot_token, _chat_id
    _bot_token = body.bot_token
    _chat_id   = body.chat_id
    log.info(f"Telegram settings updated — chat_id: {_chat_id}")
    return {"status": "ok"}

@router.post("/alerts/telegram/test")
async def test_telegram():
    ok = await send_telegram_alert({
        "alarm_id":    "TEST0001",
        "site_id":     "AIRTEL_ASM_001",
        "camera_id":   "CAM01",
        "severity":    "CRITICAL",
        "threat_level":"TEST INTRUSION — Manual Trigger",
        "person_count": 2,
        "confidence":   0.99,
        "response":    "THIS IS A TEST — NO ACTION REQUIRED",
        "first_detected": "now",
    }, snapshot_path=None)
    return {"status": "sent" if ok else "failed"}


async def send_telegram_alert(alarm: dict, snapshot_path: Optional[str] = None) -> bool:
    """
    Main send function — called from main.py on every new alarm.
    Sends photo+caption if snapshot exists, else text message.
    """
    if not _bot_token or not _chat_id:
        log.warning("Telegram not configured — skipping alert")
        return False

    sev      = alarm.get("severity", "HIGH")
    emoji    = {"CRITICAL": "🚨", "HIGH": "⚠️", "MEDIUM": "🟡", "LOW": "🔵"}.get(sev, "🔔")
    alm_id   = str(alarm.get("alarm_id", ""))[:8].upper()
    conf_pct = f"{alarm.get('confidence', 0) * 100:.1f}%"
    ts       = alarm.get("first_detected", "—")

    text = (
        f"{emoji} *{sev} ALARM — AIRTEL BTS NOC*\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🆔 *Alarm:* `ALM-{alm_id}`\n"
        f"📍 *Site:* `{alarm.get('site_id', '—')}`\n"
        f"📷 *Camera:* `{alarm.get('camera_id', '—')}`\n"
        f"⚡ *Threat:* `{alarm.get('threat_level', 'INTRUSION DETECTED')}`\n"
        f"👥 *Persons:* `{alarm.get('person_count', 0)}`\n"
        f"🎯 *Confidence:* `{conf_pct}`\n"
        f"🕐 *Detected:* `{ts}`\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🔴 *Action:* {alarm.get('response', 'DISPATCH SECURITY IMMEDIATELY')}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"📊 [Open NOC Dashboard](http://74.225.144.11:3000)\n"
        f"🎥 [Live Camera Feed](http://74.225.144.11:8080/player.html)"
    )

    base = f"https://api.telegram.org/bot{_bot_token}"

    # Resolve snapshot path
    snap_file = None
    if snapshot_path:
        p = Path(snapshot_path)
        if not p.is_absolute():
            p = SNAPSHOT_DIR / p.name
        if p.exists():
            snap_file = p

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if snap_file:
                with open(snap_file, "rb") as f:
                    resp = await client.post(
                        f"{base}/sendPhoto",
                        data={"chat_id": _chat_id, "caption": text,
                              "parse_mode": "Markdown"},
                        files={"photo": (snap_file.name, f, "image/jpeg")},
                    )
            else:
                resp = await client.post(
                    f"{base}/sendMessage",
                    json={"chat_id": _chat_id, 
                          "text": text,
                          "parse_mode": "Markdown",
                          "disable_notification": False,
                          "disable_web_page_preview": False},
                )
            if resp.status_code == 200:
                log.info(f"Telegram alert sent — ALM-{alm_id} "
                         f"{'with snapshot' if snap_file else '(text only)'}")
                return True
            else:
                log.error(f"Telegram API error {resp.status_code}: {resp.text}")
                return False
    except Exception as exc:
        log.error(f"Telegram send failed: {exc}")
        return False


async def send_telegram_status(alarm_id: str, new_status: str, operator: str):
    """Notify on ACK or CLEAR events."""
    if not _bot_token or not _chat_id:
        return
    icon  = "✅" if new_status == "CLEARED" else "🔔"
    label = "CLEARED" if new_status == "CLEARED" else "ACKNOWLEDGED"
    text  = (
        f"{icon} *ALARM {label}*\n"
        f"🆔 `ALM-{alarm_id[:8].upper()}`\n"
        f"👤 Operator: `{operator}`\n"
        f"📊 [NOC Dashboard](http://74.225.144.11:3000)"
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"https://api.telegram.org/bot{_bot_token}/sendMessage",
                json={"chat_id": _chat_id, "text": text, "parse_mode": "Markdown"},
            )
    except Exception as exc:
        log.error(f"Telegram status notify failed: {exc}")
