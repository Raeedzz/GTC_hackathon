"""Location API client: Zippopotam.us — ZIP to city, state, lat/lon."""

from __future__ import annotations

import logging
import re
from urllib.parse import urljoin

import httpx

from src.config import Config
from src.models import LocationInfo

logger = logging.getLogger(__name__)

US_ZIP_RE = re.compile(r"^\d{5}(-\d{4})?$")


class LocationClient:
    """Fetches location from Zippopotam.us: ZIP code → city, state, lat, lon."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or Config.ZIPPO_API_BASE or Config.LOCATION_API_BASE).rstrip("/")

    def get_location_by_zip(self, zip_code: str) -> LocationInfo:
        """Convert US ZIP to city, state, lat, lon. Entry point for everything else."""
        zip_code = zip_code.strip()
        if not US_ZIP_RE.match(zip_code):
            # allow 5-digit only for API (Zippopotam uses 5-digit)
            zip_code = zip_code.split("-")[0][:5] if zip_code else ""
        if not zip_code:
            return LocationInfo(query=zip_code, summary="Invalid or empty ZIP code.")
        try:
            return self._fetch_zippopotam(zip_code)
        except Exception as e:
            logger.warning("Zippopotam API failed: %s. Using fallback.", e)
            return self._fallback(zip_code)

    def _fetch_zippopotam(self, zip_code: str) -> LocationInfo:
        """GET api.zippopotam.us/us/{zip}"""
        url = urljoin(self.base_url + "/", f"us/{zip_code}")
        with httpx.Client(timeout=15.0) as client:
            r = client.get(url)
            r.raise_for_status()
            data = r.json()
        # Response: { "post code": "90210", "country": "United States", "places": [ { "place name": "Beverly Hills", "longitude": "-118.4065", "latitude": "34.0901", "state": "California", "state abbreviation": "CA" } ] }
        places = data.get("places") or []
        if not places:
            return self._fallback(zip_code)
        place = places[0] if isinstance(places[0], dict) else {}
        lat = place.get("latitude")
        lon = place.get("longitude")
        if lat is not None:
            lat = float(lat)
        if lon is not None:
            lon = float(lon)
        city = place.get("place name", place.get("place_name", ""))
        state = place.get("state abbreviation") or place.get("state", "")
        if not state and place.get("state"):
            state = place["state"]
        display = f"{city}, {state}" if city or state else f"ZIP {zip_code}"
        return LocationInfo(
            query=zip_code,
            zip_code=zip_code,
            city=city,
            state=state,
            region=state,
            latitude=lat,
            longitude=lon,
            display_name=display,
            country=data.get("country", "United States"),
            raw=data,
        )

    def get_location_from_coords(self, latitude: float, longitude: float) -> LocationInfo:
        """Return a LocationInfo from coordinates (no reverse geocode; Zippopotam is ZIP-only)."""
        return LocationInfo(
            latitude=latitude,
            longitude=longitude,
            display_name=f"{latitude}, {longitude}",
        )

    def _fallback(self, zip_code: str) -> LocationInfo:
        return LocationInfo(
            query=zip_code,
            zip_code=zip_code,
            display_name=f"ZIP {zip_code}",
            summary="Location API unavailable or ZIP not found.",
        )
