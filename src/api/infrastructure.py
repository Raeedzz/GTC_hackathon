"""Infrastructure API: OpenStreetMap Overpass — fire stations, hospitals, water, water tanks."""

from __future__ import annotations

import logging
from urllib.parse import urljoin

import httpx

from src.config import Config
from src.models import InfrastructureInfo, InfrastructureItem

logger = logging.getLogger(__name__)


class InfrastructureClient:
    """Query fire stations, hospitals, water sources within radius of coordinates."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or Config.OVERPASS_API_BASE or Config.INFRASTRUCTURE_API_BASE).rstrip("/")

    def get_infrastructure(
        self,
        latitude: float,
        longitude: float,
        radius_m: int | None = None,
        radius_km: float = 10.0,
    ) -> InfrastructureInfo:
        """Get infrastructure near a point. Uses radius_km if radius_m not set."""
        radius = int(radius_km * 1000) if radius_m is None else radius_m
        try:
            return self._fetch_overpass(latitude, longitude, radius)
        except Exception as e:
            logger.warning("Overpass API failed: %s. Using fallback.", e)
            return self._fallback(latitude, longitude)

    def _fetch_overpass(self, lat: float, lon: float, radius_m: int) -> InfrastructureInfo:
        """OSM tags: amenity=fire_station, amenity=hospital, natural=water, emergency=water_tank."""
        overpass_url = urljoin(self.base_url + "/", "interpreter")
        query = f"""
        [out:json][timeout:25];
        (
          node["amenity"="fire_station"](around:{radius_m},{lat},{lon});
          node["amenity"="hospital"](around:{radius_m},{lat},{lon});
          way["amenity"="fire_station"](around:{radius_m},{lat},{lon});
          way["amenity"="hospital"](around:{radius_m},{lat},{lon});
          node["natural"="water"](around:{radius_m},{lat},{lon});
          node["emergency"="water_tank"](around:{radius_m},{lat},{lon});
        );
        out center;
        """
        with httpx.Client(timeout=30.0) as client:
            r = client.post(overpass_url, content=query)
            r.raise_for_status()
            data = r.json()
        items: list[InfrastructureItem] = []
        for el in data.get("elements", []):
            tags = el.get("tags", {})
            kind = (
                tags.get("amenity")
                or tags.get("emergency")
                or tags.get("natural")
                or ("way_hospital" if tags.get("building") == "hospital" else "poi")
            )
            name = tags.get("name", "") or str(kind)
            lat = el.get("lat")
            lon = el.get("lon")
            if lat is None and "center" in el:
                lat = el["center"].get("lat")
                lon = el["center"].get("lon")
            items.append(
                InfrastructureItem(
                    type=kind,
                    name=name,
                    latitude=lat,
                    longitude=lon,
                    metadata=tags,
                )
            )
        radius_km = radius_m / 1000.0
        summary = f"Found {len(items)} infrastructure points (fire stations, hospitals, water) within {radius_km:.0f} km."
        return InfrastructureInfo(items=items, summary=summary, raw=data)

    def _fallback(self, lat: float, lon: float) -> InfrastructureInfo:
        return InfrastructureInfo(
            items=[],
            summary="Overpass API unavailable. Plan will rely on general best practices.",
            raw={},
        )
