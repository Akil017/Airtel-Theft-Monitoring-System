from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from enum import Enum


class SeverityLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AlarmStatus(str, Enum):
    ACTIVE = "ACTIVE"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    CLEARED = "CLEARED"


class DetectionEvent(BaseModel):
    camera_id: str
    event_type: str = "HUMAN_DETECTED"
    confidence: float = Field(..., ge=0.0, le=1.0)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    site_id: Optional[str] = None
    zone_id: Optional[str] = None
    bbox: Optional[dict] = None
    snapshot_path: Optional[str] = None


class AlarmEvent(BaseModel):
    id: Optional[str] = None
    camera_id: str
    site_id: Optional[str] = None
    zone_id: Optional[str] = None
    severity: SeverityLevel = SeverityLevel.HIGH
    status: AlarmStatus = AlarmStatus.ACTIVE
    confidence: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    acknowledged_at: Optional[datetime] = None
    cleared_at: Optional[datetime] = None
    snapshot_path: Optional[str] = None
    enode_alarm_id: Optional[str] = None


class AlarmUpdate(BaseModel):
    status: AlarmStatus
    notes: Optional[str] = None
