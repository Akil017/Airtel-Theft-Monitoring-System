from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Camera
    CAMERA_ID: str = "CAM01"
    SITE_ID: str = "AIRTEL_ASM_001"
    RTSP_URL: Optional[str] = None

    # YOLO
    MODEL_PATH: str = "yolov8n.pt"
    CONFIDENCE_THRESHOLD: float = 0.70
    INFERENCE_EVERY_N_FRAMES: int = 5
    EVENT_THROTTLE_SECONDS: float = 2.0

    # Downstream
    EVENT_PROCESSOR_URL: str = "http://event-processor:8001"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
