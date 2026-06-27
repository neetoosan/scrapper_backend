"""
Application configuration loaded from environment variables.
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings with sensible defaults."""

    # API
    API_HOST: str = os.getenv('API_HOST', '0.0.0.0')
    API_PORT: int = int(os.getenv('PORT', os.getenv('API_PORT', '8000')))
    CORS_ORIGINS: str = os.getenv('CORS_ORIGINS', '*')

    # Scraper
    MAX_CONCURRENT_JOBS: int = int(os.getenv('SCRAPER_MAX_CONCURRENT_JOBS', '5'))
    DEFAULT_MAX_PAGES: int = int(os.getenv('SCRAPER_DEFAULT_MAX_PAGES', '12'))
    DOWNLOAD_DELAY: float = float(os.getenv('SCRAPER_DOWNLOAD_DELAY', '0.5'))

    @property
    def cors_origin_list(self) -> list[str]:
        """Parse CORS origins string into a list."""
        if self.CORS_ORIGINS == '*':
            return ['*']
        return [origin.strip() for origin in self.CORS_ORIGINS.split(',') if origin.strip()]


settings = Settings()
