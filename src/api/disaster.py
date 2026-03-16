"""Weather/disaster API: NOAA — active alerts and grid hourly forecast."""

from __future__ import annotations

import logging
from urllib.parse import urljoin

import httpx

from src.config import Config
from src.models import DisasterEvent, DisasterInfo, WeatherForecastPeriod

logger = logging.getLogger(__name__)

# Required by NOAA API
NOAA_HEADERS = {"User-Agent": "(GTC-Disaster-Agent, contact@example.com)", "Accept": "application/json"}


class DisasterClient:
    """NOAA: active alerts (e.g. Red Flag Warning) + wind/humidity/temp from grid hourly forecast."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or Config.NOAA_API_BASE or Config.DISASTER_API_BASE).rstrip("/")

    def get_disasters(
        self,
        latitude: float,
        longitude: float,
        event_filter: str | None = None,
        include_forecast: bool = True,
    ) -> DisasterInfo:
        """Get active alerts for point (optionally event=Red+Flag+Warning) and optional hourly forecast."""
        try:
            alerts = self._fetch_alerts(latitude, longitude, event_filter)
            weather_summary = ""
            periods: list[WeatherForecastPeriod] = []
            if include_forecast:
                weather_summary, periods = self._fetch_forecast(latitude, longitude)
            events = alerts["events"]
            summary = alerts["summary"]
            if weather_summary:
                summary = (summary + "\n" + weather_summary).strip()
            return DisasterInfo(
                events=events,
                summary=summary,
                weather_forecast_summary=weather_summary,
                weather_periods=periods,
                raw=alerts.get("raw", {}),
            )
        except Exception as e:
            logger.warning("NOAA API failed: %s. Using fallback.", e)
            return self._fallback(latitude, longitude)

    def _fetch_alerts(
        self,
        lat: float,
        lon: float,
        event_filter: str | None,
    ) -> dict:
        """api.weather.gov/alerts/active?point={lat},{lon} or &event=Red+Flag+Warning"""
        path = "alerts/active"
        url = urljoin(self.base_url + "/", path)
        params = {"point": f"{lat},{lon}"}
        if event_filter:
            params["event"] = event_filter
        with httpx.Client(timeout=15.0, headers=NOAA_HEADERS) as client:
            r = client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        events: list[DisasterEvent] = []
        for f in data.get("features", []):
            props = f.get("properties", {})
            events.append(
                DisasterEvent(
                    event_type=props.get("event", "alert"),
                    title=props.get("headline", props.get("event", "")),
                    description=props.get("description", "") or props.get("instruction", ""),
                    severity=props.get("severity", ""),
                    start_time=props.get("onset", ""),
                    end_time=props.get("expires", ""),
                    metadata=props,
                )
            )
        summary = f"Found {len(events)} active alert(s) for this point."
        return {"events": events, "summary": summary, "raw": data}

    def _fetch_forecast(self, lat: float, lon: float) -> tuple[str, list[WeatherForecastPeriod]]:
        """api.weather.gov/points/{lat},{lon} → forecastHourly, then parse first periods for wind, humidity, temp."""
        points_url = urljoin(self.base_url + "/", f"points/{lat},{lon}")
        with httpx.Client(timeout=15.0, headers=NOAA_HEADERS) as client:
            r = client.get(points_url)
            r.raise_for_status()
            points = r.json()
        props = points.get("properties", {})
        hourly_url = props.get("forecastHourly")
        if not hourly_url:
            return "Hourly forecast URL not available.", []
        r2 = httpx.get(hourly_url, headers=NOAA_HEADERS, timeout=15.0)
        r2.raise_for_status()
        hourly = r2.json()
        periods: list[WeatherForecastPeriod] = []
        for p in hourly.get("properties", {}).get("periods", [])[:12]:
            temp = p.get("temperature")
            try:
                temp_f = float(temp) if temp is not None else None
            except (TypeError, ValueError):
                temp_f = None
            wind = p.get("windSpeed", "")
            try:
                wind_mph = float(str(wind).replace(" mph", "").strip()) if wind else None
            except (TypeError, ValueError):
                wind_mph = None
            periods.append(
                WeatherForecastPeriod(
                    start_time=p.get("startTime", ""),
                    end_time=p.get("endTime", ""),
                    temperature_f=temp_f,
                    wind_speed_mph=wind_mph,
                    relative_humidity=None,  # not in period; could come from forecastGridData
                    short_forecast=p.get("shortForecast", ""),
                )
            )
        if not periods:
            return "No hourly periods returned.", []
        first = periods[0]
        parts = [f"Next: {first.short_forecast or 'N/A'}"]
        if first.temperature_f is not None:
            parts.append(f"Temp {first.temperature_f}°F")
        if first.wind_speed_mph is not None:
            parts.append(f"Wind {first.wind_speed_mph} mph")
        summary = " | ".join(parts)
        return summary, periods

    def _fallback(self, lat: float, lon: float) -> DisasterInfo:
        return DisasterInfo(
            events=[],
            summary="NOAA weather/alerts API unavailable. Provide disaster/weather context manually.",
            raw={},
        )
