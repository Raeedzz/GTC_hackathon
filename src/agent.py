"""Main AI agent: orchestrates data fetching and plan generation."""

from __future__ import annotations

import logging
import re
from typing import Any

from src.api import CensusClient, DisasterClient, InfrastructureClient, LocationClient
from src.models import (
    DemographicsInfo,
    DisasterInfo,
    InfrastructureInfo,
    LocationInfo,
    ReactionRecoveryPlan,
)
from src.planner import PlanGenerator

logger = logging.getLogger(__name__)

US_ZIP_RE = re.compile(r"^\d{5}(-\d{4})?$")


class ReactionRecoveryAgent:
    """
    Agent that:
    1. Resolves location from ZIP (Zippopotam) → city, state, lat/lon
    2. Fetches demographics (Census ACS 5-Year), infrastructure (Overpass), weather/alerts (NOAA)
    3. Generates a reaction and recovery plan via LLM
    """

    def __init__(
        self,
        location_client: LocationClient | None = None,
        census_client: CensusClient | None = None,
        infrastructure_client: InfrastructureClient | None = None,
        disaster_client: DisasterClient | None = None,
        planner: PlanGenerator | None = None,
    ):
        self.location_client = location_client or LocationClient()
        self.census_client = census_client or CensusClient()
        self.infrastructure_client = infrastructure_client or InfrastructureClient()
        self.disaster_client = disaster_client or DisasterClient()
        self.planner = planner or PlanGenerator()

    def run(
        self,
        zip_code: str = "",
        *,
        location_query: str = "",
        latitude: float | None = None,
        longitude: float | None = None,
        radius_km: float = 10.0,
        disaster_override: str = "",
        noaa_event_filter: str | None = None,
        include_forecast: bool = True,
        extra_instructions: str = "",
        skip_location_api: bool = False,
        skip_census: bool = False,
        skip_infrastructure_api: bool = False,
        skip_disaster_api: bool = False,
    ) -> tuple[LocationInfo, DemographicsInfo, InfrastructureInfo, DisasterInfo, ReactionRecoveryPlan]:
        """
        Entry point: use ZIP code (or coords). Fetches location, Census, Overpass, NOAA, then generates plan.

        noaa_event_filter: e.g. "Red Flag Warning" for fire weather.
        Returns:
            (location_info, demographics_info, infrastructure_info, disaster_info, plan)
        """
        # Resolve location: ZIP is primary
        if zip_code or (location_query and US_ZIP_RE.match(location_query.strip().split("-")[0][:5] or "x" * 5)):
            z = (zip_code or location_query).strip()
            z = z.split("-")[0][:5] if z else ""
            if skip_location_api or not z:
                location = LocationInfo(query=z, zip_code=z, display_name=f"ZIP {z}")
            else:
                location = self.location_client.get_location_by_zip(z)
        elif latitude is not None and longitude is not None:
            if skip_location_api:
                location = LocationInfo(
                    latitude=latitude,
                    longitude=longitude,
                    display_name=f"{latitude}, {longitude}",
                )
            else:
                location = self.location_client.get_location_from_coords(latitude, longitude)
                if location_query:
                    location.query = location_query
        elif location_query:
            if skip_location_api:
                location = LocationInfo(query=location_query, display_name=location_query)
            else:
                # Only Zippopotam supports US ZIP; other queries are display-only (no coords)
                q = location_query.strip()
                if len(q) >= 5 and q[:5].isdigit():
                    location = self.location_client.get_location_by_zip(q)
                else:
                    location = LocationInfo(query=q, display_name=q, summary="Provide a US ZIP or lat/lon for full data.")
        else:
            location = LocationInfo(
                display_name="Unknown location",
                summary="No ZIP or coordinates provided.",
            )

        lat = location.latitude
        lon = location.longitude
        if lat is None:
            lat = latitude
        if lon is None:
            lon = longitude

        # Demographics (Census) by ZIP
        demographics = DemographicsInfo()
        if not skip_census and (location.zip_code or zip_code or location_query):
            z = location.zip_code or zip_code or (location_query.strip()[:5] if location_query else "")
            if z and z.isdigit():
                demographics = self.census_client.get_demographics(z)

        # Infrastructure (Overpass)
        if skip_infrastructure_api or (lat is None or lon is None):
            infrastructure = InfrastructureInfo(
                summary="Infrastructure data skipped or location unknown."
            )
        else:
            infrastructure = self.infrastructure_client.get_infrastructure(
                lat, lon, radius_km=radius_km
            )

        # Weather / disaster (NOAA)
        if skip_disaster_api:
            disaster = DisasterInfo(summary="Weather/disaster API skipped.")
        elif lat is not None and lon is not None:
            disaster = self.disaster_client.get_disasters(
                latitude=lat,
                longitude=lon,
                event_filter=noaa_event_filter,
                include_forecast=include_forecast,
            )
        else:
            disaster = DisasterInfo(summary="No coordinates; weather/alerts not fetched.")

        if disaster_override:
            disaster.summary = (
                f"User-provided context: {disaster_override}\n\n" + (disaster.summary or "")
            )

        plan = self.planner.generate(
            location=location,
            infrastructure=infrastructure,
            disaster=disaster,
            demographics=demographics,
            extra_instructions=extra_instructions,
        )

        return location, demographics, infrastructure, disaster, plan

    def run_with_manual_context(
        self,
        location_name: str,
        location_lat: float | None,
        location_lon: float | None,
        demographics_summary: str = "",
        infrastructure_summary: str = "",
        disaster_summary: str = "",
        disaster_events: list[dict[str, Any]] | None = None,
        extra_instructions: str = "",
    ) -> ReactionRecoveryPlan:
        """Generate a plan from manually provided context (no API calls)."""
        location = LocationInfo(
            query=location_name,
            display_name=location_name,
            latitude=location_lat,
            longitude=location_lon,
        )
        from src.models import DisasterEvent, InfrastructureItem

        demographics = DemographicsInfo(summary=demographics_summary) if demographics_summary else DemographicsInfo()
        items = []
        if infrastructure_summary:
            items.append(
                InfrastructureItem(type="custom", name="Custom data", metadata={"summary": infrastructure_summary})
            )
        infrastructure = InfrastructureInfo(
            summary=infrastructure_summary or "No infrastructure data.", items=items
        )
        events = []
        if disaster_events:
            for ev in disaster_events:
                events.append(
                    DisasterEvent(
                        event_type=ev.get("event_type", "disaster"),
                        title=ev.get("title", ""),
                        description=ev.get("description", ""),
                        severity=ev.get("severity", ""),
                        latitude=ev.get("latitude"),
                        longitude=ev.get("longitude"),
                        metadata=ev,
                    )
                )
        disaster = DisasterInfo(summary=disaster_summary, events=events)

        return self.planner.generate(
            location=location,
            infrastructure=infrastructure,
            disaster=disaster,
            demographics=demographics,
            extra_instructions=extra_instructions,
        )
