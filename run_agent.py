#!/usr/bin/env python3
"""
CLI for the Reaction & Recovery AI Agent.

APIs: Zippopotam (ZIP→city/state/lat/lon), Census ACS (population+housing), Overpass (infra), NOAA (alerts+forecast).

Usage:
  # Using US ZIP code (entry point — fetches location, Census, Overpass, NOAA)
  python run_agent.py 90210
  python run_agent.py --zip 94102

  # Using coordinates
  python run_agent.py --lat 37.77 --lon -122.42

  # Red Flag Warning / fire weather (NOAA event filter)
  python run_agent.py 90210 --noaa-event "Red Flag Warning"

  # With extra disaster context
  python run_agent.py 90210 --disaster "Evacuation order for zone 3"

  # Manual mode (no API calls)
  python run_agent.py --manual "City X" --disaster "Flood" --infra "2 hospitals"

Environment:
  OPENAI_API_KEY   Required for plan generation.
  CENSUS_API_KEY   Optional; get at api.census.gov (~5 min).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Ensure project root is on path when run as script
_root = Path(__file__).resolve().parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

from src.agent import ReactionRecoveryAgent
from src.config import Config

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def _print_plan(plan) -> None:
    print("\n" + "=" * 60)
    print("REACTION & RECOVERY PLAN")
    print("=" * 60)
    print("\nSummary:", plan.summary or "(none)")
    print("\n--- Reaction (immediate) ---")
    for s in plan.reaction_steps:
        print(f"  {s.order}. [{s.priority}] {s.action}")
        if s.rationale:
            print(f"     Rationale: {s.rationale}")
    print("\n--- Recovery ---")
    for s in plan.recovery_steps:
        print(f"  {s.order}. {s.action} ({s.timeline})")
        if s.rationale:
            print(f"     Rationale: {s.rationale}")
    if plan.key_contacts_or_resources:
        print("\nKey contacts/resources:", ", ".join(plan.key_contacts_or_resources))
    if plan.assumptions:
        print("Assumptions:", ", ".join(plan.assumptions))
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Reaction & Recovery AI Agent (ZIP → plan)")
    parser.add_argument("zip_or_place", nargs="?", default="", help="US ZIP code or place (ZIP preferred)")
    parser.add_argument("--zip", type=str, default="", help="US ZIP code (alternative to positional)")
    parser.add_argument("--lat", type=float, default=None, help="Latitude (optional)")
    parser.add_argument("--lon", type=float, default=None, help="Longitude (optional)")
    parser.add_argument("--radius-km", type=float, default=10.0, help="Radius for infrastructure (km)")
    parser.add_argument("--disaster", type=str, default="", help="Override: disaster/context description")
    parser.add_argument("--noaa-event", type=str, default=None, help="NOAA alert filter (e.g. 'Red Flag Warning')")
    parser.add_argument("--no-forecast", action="store_true", help="Skip NOAA hourly forecast")
    parser.add_argument("--extra", type=str, default="", help="Extra instructions for the planner")
    parser.add_argument("--skip-location", action="store_true", help="Skip location API")
    parser.add_argument("--skip-census", action="store_true", help="Skip Census API")
    parser.add_argument("--skip-infrastructure", action="store_true", help="Skip Overpass API")
    parser.add_argument("--skip-disaster", action="store_true", help="Skip NOAA API")
    parser.add_argument("--manual", action="store_true", help="Manual mode: no API calls")
    parser.add_argument("--infra", type=str, default="", help="Manual mode: infrastructure summary")
    parser.add_argument("--demographics", type=str, default="", help="Manual mode: demographics summary")
    parser.add_argument("--json", action="store_true", help="Output as JSON only")
    args = parser.parse_args()

    if not Config.validate_llm():
        logger.error("OPENAI_API_KEY is not set. Set it in the environment to generate plans.")
        return 1

    agent = ReactionRecoveryAgent()

    if args.manual:
        location_name = args.zip_or_place or args.zip or "Unknown"
        plan = agent.run_with_manual_context(
            location_name=location_name,
            location_lat=args.lat,
            location_lon=args.lon,
            demographics_summary=args.demographics or "",
            infrastructure_summary=args.infra or "",
            disaster_summary=args.disaster or "",
            extra_instructions=args.extra,
        )
        if args.json:
            print(plan.model_dump_json(indent=2))
        else:
            _print_plan(plan)
        return 0

    zip_code = args.zip or args.zip_or_place
    if not zip_code and (args.lat is None or args.lon is None):
        logger.error("Provide a US ZIP code (e.g. 90210) or --lat and --lon.")
        return 1

    location, demographics, infrastructure, disaster, plan = agent.run(
        zip_code=zip_code if zip_code and zip_code.strip().isdigit() else "",
        location_query=zip_code or "",
        latitude=args.lat,
        longitude=args.lon,
        radius_km=args.radius_km,
        disaster_override=args.disaster,
        noaa_event_filter=args.noaa_event,
        include_forecast=not args.no_forecast,
        extra_instructions=args.extra,
        skip_location_api=args.skip_location,
        skip_census=args.skip_census,
        skip_infrastructure_api=args.skip_infrastructure,
        skip_disaster_api=args.skip_disaster,
    )

    if args.json:
        out = {
            "location": location.model_dump(),
            "demographics": demographics.model_dump(),
            "infrastructure_summary": infrastructure.summary,
            "disaster_summary": disaster.summary,
            "plan": plan.model_dump(),
        }
        print(json.dumps(out, indent=2))
    else:
        print("\nLocation:", location.display_name or location.query, end="")
        if location.zip_code:
            print(f" (ZIP {location.zip_code})")
        else:
            print()
        print("Demographics:", demographics.summary or "—")
        print("Infrastructure:", infrastructure.summary)
        print("Weather/Alerts:", disaster.summary or "—")
        _print_plan(plan)

    return 0


if __name__ == "__main__":
    sys.exit(main())
