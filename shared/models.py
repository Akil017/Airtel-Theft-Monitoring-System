"""
Shared data models — imported by event-processor and alarm-manager.
"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List
from enum import Enum


class EventType(str, Enum):
    HUMAN_DETECTED = "HUMAN_DETECTED"


class AlarmSeverity(str, Enum):
    CRITICAL = "CRITICAL"
    MAJOR = "MAJOR"
    MINOR = "MINOR"
    WARNING = "WARNING"
    CLEARED = "CLEARED"


class AlarmStatus(str, Enum):
    ACTIVE = "ACTIVE"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    CLEARED = "CLEARED"


class DetectionEvent(BaseModel):
    camera_id: str
    site_id: str
    event_type: EventType
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: Optional[List[int]] = None
    timestamp: datetime
    frame: Optional[int] = None


class SecurityAlarm(BaseModel):
    alarm_id: str
    site_id: str
    camera_id: str
    severity: AlarmSeverity
    status: AlarmStatus
    description: str
    confidence: float
    detection_count: int
    first_detected: datetime
    last_updated: datetime
    cleared_at: Optional[datetime] = None

    class Config:
        use_enum_values = True


class AlarmAckRequest(BaseModel):
    alarm_id: str
    operator_id: str
    note: Optional[str] = None


class AlarmClearRequest(BaseModel):
    alarm_id: str
    operator_id: str
    reason: Optional[str] = None
