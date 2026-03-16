"""Configuration loaded from environment variables."""

import os
from pathlib import Path

# Load .env if present (optional dependency: python-dotenv)
_env_path = Path(__file__).resolve().parents[1] / ".env"
if _env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_path)
    except ImportError:
        pass


class Config:
    """API and LLM configuration."""

    # Zippopotam.us — ZIP to city/state/lat/lon (no key)
    ZIPPO_API_BASE: str = os.getenv("ZIPPO_API_BASE", "https://api.zippopotam.us")

    # US Census ACS 5-Year — population + housing by ZIP (key: ~5 min at api.census.gov)
    CENSUS_API_BASE: str = os.getenv("CENSUS_API_BASE", "https://api.census.gov")
    CENSUS_API_KEY: str = os.getenv("CENSUS_API_KEY", "")

    # OpenStreetMap Overpass — infrastructure (no key)
    OVERPASS_API_BASE: str = os.getenv("OVERPASS_API_BASE", "https://overpass-api.de/api")

    # NOAA Weather — alerts + grid forecast (no key)
    NOAA_API_BASE: str = os.getenv("NOAA_API_BASE", "https://api.weather.gov")

    # LLM for plan generation (OpenAI)
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Legacy aliases (optional overrides)
    LOCATION_API_BASE: str = os.getenv("LOCATION_API_BASE", "https://api.zippopotam.us")
    INFRASTRUCTURE_API_BASE: str = os.getenv("INFRASTRUCTURE_API_BASE", OVERPASS_API_BASE)
    DISASTER_API_BASE: str = os.getenv("DISASTER_API_BASE", NOAA_API_BASE)

    @classmethod
    def validate_llm(cls) -> bool:
        return bool(cls.OPENAI_API_KEY)
