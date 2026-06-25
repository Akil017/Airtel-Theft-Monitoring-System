from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    DATABASE_URL:           str           = "postgresql+asyncpg://airtel:airtel@postgres:5432/airtel_monitor"
    ENODE_API_URL:          Optional[str] = None
    ENODE_API_KEY:          Optional[str] = None
    DETECTION_SERVICE_URL:  Optional[str] = "http://detection-service:8003"

    # Telegram
    TELEGRAM_BOT_TOKEN:     Optional[str] = None
    TELEGRAM_CHAT_ID:       Optional[str] = None

    class Config:
        env_file = ".env"
        extra    = "ignore"

settings = Settings()
