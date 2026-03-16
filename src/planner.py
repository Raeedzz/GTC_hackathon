"""LLM-based planner: generates reaction and recovery plans from context."""

from __future__ import annotations

import json
import logging
from typing import Any

from openai import OpenAI

from src.config import Config
from src.models import (
    DemographicsInfo,
    DisasterInfo,
    InfrastructureInfo,
    LocationInfo,
    ReactionRecoveryPlan,
    RecoveryStep,
    ReactionStep,
)

logger = logging.getLogger(__name__)

PLAN_SYSTEM_PROMPT = """You are an expert emergency and disaster response planner. Your task is to produce a structured reaction and recovery plan based on:
1) Location (ZIP, city, state, coordinates)
2) Demographics (population, housing units) when provided
3) Available infrastructure (fire stations, hospitals, water sources, water tanks)
4) Weather/disaster alerts (NOAA) and forecast (wind, humidity, temperature)

Output a JSON object with this exact structure (no other text):
{
  "summary": "2-4 sentence executive summary of the situation and plan",
  "reaction_steps": [
    {"order": 1, "action": "concrete action", "rationale": "why", "priority": "high|medium|low"}
  ],
  "recovery_steps": [
    {"order": 1, "action": "concrete action", "rationale": "why", "timeline": "e.g. 0-24 hours"}
  ],
  "key_contacts_or_resources": ["resource or contact 1", "..."],
  "assumptions": ["assumption 1", "..."]
}

Guidelines:
- Reaction: immediate life-safety, evacuation, first response, resource deployment.
- Recovery: short-to-medium term (hours to days): restoration, shelter, health, logistics.
- Base steps on the actual infrastructure and disaster data provided; if data is missing, state assumptions.
- Prioritize by risk to life and critical systems.
- Be specific to the location and disaster type.
"""


class PlanGenerator:
    """Uses an LLM to generate a reaction and recovery plan from aggregated context."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
    ):
        self.api_key = api_key or Config.OPENAI_API_KEY
        self.model = model or Config.OPENAI_MODEL
        self._client: OpenAI | None = None

    def _get_client(self) -> OpenAI:
        if self._client is None:
            if not self.api_key:
                raise ValueError("OPENAI_API_KEY is not set. Set it in the environment or pass api_key.")
            self._client = OpenAI(api_key=self.api_key)
        return self._client

    def build_context(
        self,
        location: LocationInfo,
        infrastructure: InfrastructureInfo,
        disaster: DisasterInfo,
        demographics: DemographicsInfo | None = None,
        extra_instructions: str = "",
    ) -> str:
        """Build a single text context for the LLM."""
        sections = []

        sections.append("## Location")
        sections.append(f"Place: {location.display_name or location.query}")
        if location.zip_code:
            sections.append(f"ZIP: {location.zip_code}")
        if location.city:
            sections.append(f"City: {location.city}")
        if location.state or location.region:
            sections.append(f"State: {location.state or location.region}")
        if location.country:
            sections.append(f"Country: {location.country}")
        if location.latitude is not None and location.longitude is not None:
            sections.append(f"Coordinates: {location.latitude}, {location.longitude}")

        if demographics and (demographics.population is not None or demographics.housing_units is not None):
            sections.append("\n## Demographics (Census ACS 5-Year)")
            sections.append(demographics.summary or "No Census data.")

        sections.append("\n## Infrastructure (nearby)")
        sections.append(infrastructure.summary or "No infrastructure data.")
        for item in infrastructure.items[:30]:
            sections.append(f"- {item.type}: {item.name or 'Unnamed'} (lat={item.latitude}, lon={item.longitude})")

        sections.append("\n## Weather / disaster alerts and forecast")
        sections.append(disaster.summary or "No weather or disaster data provided.")
        if disaster.weather_forecast_summary:
            sections.append(f"Weather: {disaster.weather_forecast_summary}")
        for ev in disaster.events[:15]:
            parts = [f"- {ev.event_type}: {ev.title}"]
            if ev.severity:
                parts.append(f"  Severity: {ev.severity}")
            if ev.description:
                parts.append(f"  {ev.description[:200]}")
            sections.append("\n".join(parts))
        for p in disaster.weather_periods[:6]:
            parts = [f"  {p.start_time}: {p.short_forecast or 'N/A'}"]
            if p.temperature_f is not None:
                parts.append(f" {p.temperature_f}°F")
            if p.wind_speed_mph is not None:
                parts.append(f" wind {p.wind_speed_mph} mph")
            sections.append("".join(parts))

        if extra_instructions:
            sections.append("\n## Additional instructions")
            sections.append(extra_instructions)

        return "\n".join(sections)

    def generate(
        self,
        location: LocationInfo,
        infrastructure: InfrastructureInfo,
        disaster: DisasterInfo,
        demographics: DemographicsInfo | None = None,
        extra_instructions: str = "",
    ) -> ReactionRecoveryPlan:
        """Generate a structured reaction and recovery plan."""
        context = self.build_context(
            location, infrastructure, disaster, demographics=demographics, extra_instructions=extra_instructions
        )
        user_content = f"Generate a reaction and recovery plan based on the following information.\n\n{context}"

        client = self._get_client()
        response = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": PLAN_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.3,
        )
        raw_response = (response.choices[0].message.content or "").strip()

        # Parse JSON from response (handle markdown code blocks)
        if "```json" in raw_response:
            raw_response = raw_response.split("```json")[1].split("```")[0].strip()
        elif "```" in raw_response:
            raw_response = raw_response.split("```")[1].split("```")[0].strip()
        try:
            data = json.loads(raw_response)
        except json.JSONDecodeError as e:
            logger.warning("LLM response was not valid JSON: %s. Using raw as summary.", e)
            return ReactionRecoveryPlan(
                summary=raw_response[:500],
                raw_response=raw_response,
            )

        reaction_steps = [
            ReactionStep(
                order=s.get("order", i + 1),
                action=s.get("action", ""),
                rationale=s.get("rationale", ""),
                priority=s.get("priority", "high"),
            )
            for i, s in enumerate(data.get("reaction_steps", []))
        ]
        recovery_steps = [
            RecoveryStep(
                order=s.get("order", i + 1),
                action=s.get("action", ""),
                rationale=s.get("rationale", ""),
                timeline=s.get("timeline", ""),
            )
            for i, s in enumerate(data.get("recovery_steps", []))
        ]
        return ReactionRecoveryPlan(
            summary=data.get("summary", ""),
            reaction_steps=reaction_steps,
            recovery_steps=recovery_steps,
            key_contacts_or_resources=data.get("key_contacts_or_resources", []),
            assumptions=data.get("assumptions", []),
            raw_response=raw_response,
        )
