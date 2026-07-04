"""
Shared Pydantic models — imported by event-processor and alarm-manager.
Severity logic matches demo.py exactly:
  1-2 intruders -> HIGH
  3+ intruders  -> CRITICAL
"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List
from enum import Enum


class EventType(str, Enum):
    HUMAN_DETECTED    = "HUMAN_DETECTED"
    ANIMAL_DETECTED   = "ANIMAL_DETECTED"
    INTRUDER_DETECTED = "INTRUDER_DETECTED"


class AlarmSeverity(str, Enum):
    CRITICAL = "CRITICAL"   # 3+ intruders
    HIGH     = "HIGH"       # 1-2 intruders


class AlarmStatus(str, Enum):
    ACTIVE       = "ACTIVE"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    CLEARED      = "CLEARED"


class DetectionEvent(BaseModel):
    camera_id:  str
    site_id:    str
    event_type: EventType
    confidence: float = Field(ge=0.0, le=1.0)
    label:      str = "Person"
    bbox:       Optional[List[int]] = None
    timestamp:  datetime
    frame:      Optional[int] = None
    snapshot_path: Optional[str] = None


class SecurityAlarm(BaseModel):
    alarm_id:        str
    site_id:         str
    camera_id:       str
    severity:        AlarmSeverity
    status:          AlarmStatus
    threat_level:    str
    description:     str
    confidence:      float
    person_count:    int = 0
    animal_count:    int = 0
    detection_count: int
    response:        str
    first_detected:  datetime
    last_updated:    datetime
    cleared_at:      Optional[datetime] = None
    snapshot_path:   Optional[str] = None

    class Config:
        use_enum_values = True


class AlarmAckRequest(BaseModel):
    alarm_id:    str
    operator_id: str
    note:        Optional[str] = None


class AlarmClearRequest(BaseModel):
    alarm_id:    str
    operator_id: str
    reason:      Optional[str] = None
