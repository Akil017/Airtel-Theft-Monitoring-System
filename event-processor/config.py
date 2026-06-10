from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    MIN_CONFIDENCE:              float = 0.45
    CONSECUTIVE_FRAMES_REQUIRED: int   = 3
    RESTRICTED_SITES:            str   = ""
    ALARM_MANAGER_URL:           str   = "http://alarm-manager:8002"

    @property
    def restricted_sites_list(self) -> List[str]:
        if not self.RESTRICTED_SITES:
            return []
        return [s.strip() for s in self.RESTRICTED_SITES.split(",") if s.strip()]

    class Config:
        env_file = ".env"
        extra    = "ignore"

settings = Settings()
settings.RESTRICTED_SITES = settings.restricted_sites_list  # type: ignore
