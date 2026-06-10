from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    CAMERA_ID:                str   = "CAM-BTS-01"
    SITE_ID:                  str   = "AIRTEL-ASM-BTS-001"
    RTSP_URL:                 Optional[str] = None
    MODEL_PATH:               str   = "yolov8s.pt"
    CONFIDENCE_THRESHOLD:     float = 0.45
    INFERENCE_EVERY_N_FRAMES: int   = 3
    EVENT_THROTTLE_SECONDS:   float = 2.0
    DETECT_CLASSES:           str   = "0,15,16,17,18,19,20,21,22,23"
    EVENT_PROCESSOR_URL:      str   = "http://event-processor:8001"

    class Config:
        env_file = ".env"
        extra    = "ignore"

settings = Settings()
