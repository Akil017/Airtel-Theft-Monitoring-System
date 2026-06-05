from pydantic_settings import BaseSettings
from typing import Optional, List


class Settings(BaseSettings):
    # Business rules
    MIN_CONFIDENCE: float = 0.80
    CONSECUTIVE_FRAMES_REQUIRED: int = 3
    RESTRICTED_SITES: Optional[str] = None   # comma-separated string from env

    # Downstream
    ALARM_MANAGER_URL: str = "http://alarm-manager:8002"

    @property
    def restricted_sites_list(self) -> List[str]:
        if not self.RESTRICTED_SITES:
            return []
        return [s.strip() for s in self.RESTRICTED_SITES.split(",") if s.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Expose as simple attribute so main.py can do: settings.RESTRICTED_SITES
# and also treat empty string as "allow all"
_orig_sites = settings.RESTRICTED_SITES
settings.RESTRICTED_SITES = settings.restricted_sites_list  # type: ignore
