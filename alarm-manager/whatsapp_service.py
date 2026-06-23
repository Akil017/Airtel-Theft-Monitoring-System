"""
whatsapp_service.py — WhatsApp Alert Service for Airtel BTS NOC
===============================================================
Sends WhatsApp alerts via Twilio when alarms fire.
Manages contact list (add/remove/edit numbers).
Stores contacts in PostgreSQL via the alarm-manager DB.

Endpoints:
  POST /alerts/whatsapp/send         — called by alarm-manager on new alarm
  GET  /alerts/contacts              — list all alert contacts
  POST /alerts/contacts              — add contact
  PUT  /alerts/contacts/{id}         — update contact
  DELETE /alerts/contacts/{id}       — remove contact
  POST /alerts/contacts/{id}/test    — send test message to one contact
"""

import os
import json
import asyncio
import logging
from datetime import datetime
from typing import Optional, List

import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, validator
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import Column, String, Boolean, DateTime, Text, Integer, select
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID  = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN   = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")  # Twilio sandbox
DATABASE_URL        = os.getenv("DATABASE_URL", "postgresql+asyncpg://airtel:airtel@postgres:5432/airtel_monitor")

# ── DB Setup ──────────────────────────────────────────────────────────────────
engine       = create_async_engine(DATABASE_URL, echo=False)
AsyncSession_ = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

class AlertContact(Base):
    __tablename__ = "alert_contacts"
    id          = Column(String, primary_key=True, default=lambda: __import__("uuid").uuid4().hex)
    name        = Column(String(100), nullable=False)
    phone       = Column(String(20),  nullable=False)   # E.164 format: +919876543210
    role        = Column(String(50),  default="NOC Operator")
    enabled     = Column(Boolean,     default=True)
    notify_high     = Column(Boolean, default=True)
    notify_critical = Column(Boolean, default=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    notes       = Column(Text, default="")

async def init_contacts_table():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with AsyncSession_() as session:
        yield session

# ── Pydantic Models ───────────────────────────────────────────────────────────
class ContactCreate(BaseModel):
    name:            str
    phone:           str        # will be validated to E.164
    role:            str = "NOC Operator"
    enabled:         bool = True
    notify_high:     bool = True
    notify_critical: bool = True
    notes:           str  = ""

    @validator("phone")
    def validate_phone(cls, v):
        v = v.strip().replace(" ", "").replace("-", "")
        if not v.startswith("+"):
            # Assume India if no country code
            v = "+91" + v.lstrip("0")
        if len(v) < 10 or len(v) > 16:
            raise ValueError("Phone must be 10–15 digits with country code (e.g. +919876543210)")
        return v

class ContactUpdate(BaseModel):
    name:            Optional[str]  = None
    phone:           Optional[str]  = None
    role:            Optional[str]  = None
    enabled:         Optional[bool] = None
    notify_high:     Optional[bool] = None
    notify_critical: Optional[bool] = None
    notes:           Optional[str]  = None

class AlarmAlertPayload(BaseModel):
    alarm_id:     str
    site_id:      str
    camera_id:    str
    severity:     str
    threat_level: str
    person_count: int
    confidence:   float
    snapshot_url: Optional[str] = None
    timestamp:    str

# ── Router ────────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/alerts", tags=["alerts"])

# ── WhatsApp Message Templates ────────────────────────────────────────────────
CRITICAL_SOUND_URL = "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3"  # siren
HIGH_SOUND_URL     = "https://assets.mixkit.co/active_storage/sfx/209/209-preview.mp3"    # alert

def build_whatsapp_message(payload: AlarmAlertPayload) -> str:
    sev_emoji = "🔴🚨" if payload.severity == "CRITICAL" else "🟠⚠️"
    ts = datetime.fromisoformat(payload.timestamp.replace("Z", "")).strftime("%d %b %Y %H:%M:%S IST")

    lines = [
        f"{sev_emoji} *AIRTEL BTS SECURITY ALERT*",
        f"",
        f"*Alarm ID:*  `{payload.alarm_id}`",
        f"*Severity:*  {payload.severity}",
        f"*Site:*  {payload.site_id}",
        f"*Camera:*  {payload.camera_id}",
        f"*Threat:*  {payload.threat_level}",
        f"*Persons:*  {payload.person_count} detected",
        f"*Confidence:*  {payload.confidence * 100:.1f}%",
        f"*Time:*  {ts}",
        f"",
    ]

    if payload.severity == "CRITICAL":
        lines += [
            f"🔊 *ALARM SOUND:* {CRITICAL_SOUND_URL}",
            f"",
            f"⚡ *MASS INTRUSION — DISPATCH MULTIPLE UNITS IMMEDIATELY*",
            f"",
            f"👉 Open NOC Dashboard to acknowledge: http://74.225.144.11:3000",
        ]
    else:
        lines += [
            f"🔊 *ALARM:* {HIGH_SOUND_URL}",
            f"",
            f"⚡ *Action Required — Dispatch Security Unit*",
            f"",
            f"👉 NOC Dashboard: http://74.225.144.11:3000",
        ]

    if payload.snapshot_url:
        lines.append(f"📸 Snapshot: http://74.225.144.11:8002{payload.snapshot_url}")

    return "\n".join(lines)


async def send_whatsapp_message(to_phone: str, message: str) -> dict:
    """Send WhatsApp message via Twilio."""
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        logger.warning("Twilio credentials not set — skipping WhatsApp send")
        return {"status": "skipped", "reason": "no_credentials"}

    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"

    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                url,
                data={
                    "From": TWILIO_WHATSAPP_FROM,
                    "To":   f"whatsapp:{to_phone}",
                    "Body": message,
                },
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                timeout=10.0,
            )
            result = r.json()
            if r.status_code == 201:
                logger.info(f"WhatsApp sent to {to_phone}: SID={result.get('sid')}")
                return {"status": "sent", "sid": result.get("sid")}
            else:
                logger.error(f"Twilio error {r.status_code}: {result}")
                return {"status": "error", "code": r.status_code, "detail": result}
        except Exception as e:
            logger.error(f"WhatsApp send failed for {to_phone}: {e}")
            return {"status": "error", "detail": str(e)}


# ── Alert Endpoint ────────────────────────────────────────────────────────────
@router.post("/whatsapp/send")
async def send_alarm_alerts(payload: AlarmAlertPayload, db: AsyncSession = Depends(get_db)):
    """
    Called by alarm-manager when a new alarm fires.
    Sends WhatsApp to all enabled contacts matching the severity.
    """
    result  = await db.execute(select(AlertContact).where(AlertContact.enabled == True))
    contacts = result.scalars().all()

    if not contacts:
        return {"ok": True, "sent": 0, "message": "No enabled contacts"}

    message = build_whatsapp_message(payload)
    tasks   = []
    targets = []

    for contact in contacts:
        if payload.severity == "CRITICAL" and contact.notify_critical:
            targets.append(contact)
        elif payload.severity in ("HIGH", "MID-HIGH") and contact.notify_high:
            targets.append(contact)

    results = []
    for contact in targets:
        r = await send_whatsapp_message(contact.phone, message)
        results.append({"contact": contact.name, "phone": contact.phone, **r})

    return {
        "ok":      True,
        "alarm_id": payload.alarm_id,
        "sent":    len([r for r in results if r.get("status") == "sent"]),
        "total":   len(targets),
        "results": results,
    }


# ── Contact CRUD ──────────────────────────────────────────────────────────────
@router.get("/contacts")
async def list_contacts(db: AsyncSession = Depends(get_db)):
    result   = await db.execute(select(AlertContact).order_by(AlertContact.created_at))
    contacts = result.scalars().all()
    return [
        {
            "id":             c.id,
            "name":           c.name,
            "phone":          c.phone,
            "role":           c.role,
            "enabled":        c.enabled,
            "notify_high":    c.notify_high,
            "notify_critical": c.notify_critical,
            "notes":          c.notes,
            "created_at":     c.created_at.isoformat() + "Z" if c.created_at else None,
        }
        for c in contacts
    ]


@router.post("/contacts", status_code=201)
async def add_contact(data: ContactCreate, db: AsyncSession = Depends(get_db)):
    import uuid as _uuid
    contact = AlertContact(
        id              = _uuid.uuid4().hex,
        name            = data.name,
        phone           = data.phone,
        role            = data.role,
        enabled         = data.enabled,
        notify_high     = data.notify_high,
        notify_critical = data.notify_critical,
        notes           = data.notes,
        created_at      = datetime.utcnow(),
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return {"ok": True, "id": contact.id, "name": contact.name, "phone": contact.phone}


@router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, data: ContactUpdate, db: AsyncSession = Depends(get_db)):
    result  = await db.execute(select(AlertContact).where(AlertContact.id == contact_id))
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    for field, value in data.dict(exclude_none=True).items():
        setattr(contact, field, value)

    await db.commit()
    return {"ok": True, "id": contact.id}


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, db: AsyncSession = Depends(get_db)):
    result  = await db.execute(select(AlertContact).where(AlertContact.id == contact_id))
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    await db.delete(contact)
    await db.commit()
    return {"ok": True}


@router.post("/contacts/{contact_id}/test")
async def test_contact(contact_id: str, db: AsyncSession = Depends(get_db)):
    """Send a test WhatsApp message to one contact."""
    result  = await db.execute(select(AlertContact).where(AlertContact.id == contact_id))
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    test_msg = (
        f"🧪 *AIRTEL BTS NOC — TEST ALERT*\n\n"
        f"Hi {contact.name}, this is a test message from the Airtel BTS "
        f"Theft Monitoring System.\n\n"
        f"✅ Your number is correctly registered for alarm notifications.\n"
        f"📍 Site: AIRTEL-ASM-BTS-001\n\n"
        f"🔊 Test alarm sound: {CRITICAL_SOUND_URL}\n\n"
        f"If you received this, your WhatsApp alert is working correctly."
    )
    r = await send_whatsapp_message(contact.phone, test_msg)
    return {"ok": True, "contact": contact.name, "phone": contact.phone, **r}
