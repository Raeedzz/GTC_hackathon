# GTC Hackathon — Reaction & Recovery AI Agent

An AI agent that uses **ZIP code as the entry point** to pull location, demographics, infrastructure, and weather data from public APIs, then produces a **reaction and recovery plan** for disaster response.

## APIs integrated

| API | Purpose |
|-----|--------|
| **Zippopotam.us** | ZIP → city, state, lat/lon. Entry for everything else. `api.zippopotam.us/us/{zip}` |
| **US Census ACS 5-Year** | Population + housing units by ZIP. Key at [api.census.gov](https://api.census.gov) (~5 min). |
| **OpenStreetMap Overpass** | Fire stations, hospitals, water sources, water tanks near coordinates. `overpass-api.de/api/interpreter` with `amenity=fire_station`, `amenity=hospital`, `natural=water`, `emergency=water_tank`. |
| **NOAA Weather** | Active alerts for point (e.g. Red Flag Warning): `api.weather.gov/alerts/active?point={lat},{lon}`. Hourly forecast (wind, temp): `api.weather.gov/points/{lat},{lon}` → `forecastHourly`. |
| **Leaflet.js** | For a 2-hour build: render ZIP location, fire stations, hospitals, evacuation zones as map pins. Use free OSM tiles: `cdn.jsdelivr.net/npm/leaflet`. (Not used by the agent; add in your own frontend.) |

## Setup

```bash
cd GTC_hackathon
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env
# Set OPENAI_API_KEY in .env. Optionally set CENSUS_API_KEY.
```

## Usage

**ZIP code (primary):**

```bash
python run_agent.py 90210
python run_agent.py --zip 94102
```

**Coordinates:**

```bash
python run_agent.py --lat 37.77 --lon -122.42
```

**Red Flag Warning / fire weather (NOAA):**

```bash
python run_agent.py 90210 --noaa-event "Red Flag Warning"
```

**Extra disaster context:**

```bash
python run_agent.py 90210 --disaster "Evacuation order for zone 3"
```

**Manual mode (no API calls):**

```bash
python run_agent.py --manual "City X" --disaster "Flood" --infra "2 hospitals" --demographics "Pop 50k"
```

**JSON output:**

```bash
python run_agent.py 90210 --json
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes (for plans) | OpenAI API key |
| `CENSUS_API_KEY` | No | Census key at api.census.gov (~5 min) |
| `ZIPPO_API_BASE`, `CENSUS_API_BASE`, `OVERPASS_API_BASE`, `NOAA_API_BASE` | No | Override API bases |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini` |

## Programmatic use

```python
from src import ReactionRecoveryAgent

agent = ReactionRecoveryAgent()
location, demographics, infrastructure, disaster, plan = agent.run(
    zip_code="90210",
    noaa_event_filter="Red Flag Warning",
)
print(plan.summary)
for s in plan.reaction_steps:
    print(s.order, s.action, s.priority)
```

## Map (Leaflet)

To show the ZIP location, fire stations, hospitals, and evacuation zones on a map, add a small frontend that:

1. Loads Leaflet: `https://cdn.jsdelivr.net/npm/leaflet`
2. Uses the agent output: `location.latitude`, `location.longitude`, and `infrastructure.items` (each with `latitude`, `longitude`, `type`, `name`).
3. Uses free OpenStreetMap tiles and plots one marker for the ZIP and one per infrastructure item.

## Project layout

```
GTC_hackathon/
├── run_agent.py          # CLI
├── requirements.txt
├── .env.example
├── README.md
└── src/
    ├── config.py         # Env config (Zippopotam, Census, Overpass, NOAA)
    ├── models.py         # LocationInfo, DemographicsInfo, InfrastructureInfo, DisasterInfo, Plan
    ├── agent.py          # ReactionRecoveryAgent
    ├── planner.py        # LLM plan generator
    └── api/
        ├── location.py   # Zippopotam
        ├── census.py     # Census ACS 5-Year
        ├── infrastructure.py  # Overpass
        └── disaster.py   # NOAA alerts + forecast
```
