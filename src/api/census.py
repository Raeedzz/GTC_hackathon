"""US Census ACS 5-Year API: population and housing units by ZIP."""

from __future__ import annotations

import logging
from urllib.parse import urljoin

import httpx

from src.config import Config
from src.models import DemographicsInfo

logger = logging.getLogger(__name__)

# B01003_001E = Total population, B25001_001E = Total housing units
CENSUS_VARS = "B01003_001E,B25001_001E"


class CensusClient:
    """Real population + housing unit counts by ZIP. Key takes ~5 min at api.census.gov."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = (base_url or Config.CENSUS_API_BASE).rstrip("/")
        self.api_key = api_key or Config.CENSUS_API_KEY

    def get_demographics(self, zip_code: str) -> DemographicsInfo:
        """Get population and housing units for a ZIP (ZCTA)."""
        zip_code = str(zip_code).strip()[:5]
        if not zip_code.isdigit():
            return DemographicsInfo(zip_code=zip_code, summary="Invalid ZIP for Census.")
        try:
            return self._fetch_acs5(zip_code)
        except Exception as e:
            logger.warning("Census API failed: %s. Using fallback.", e)
            return self._fallback(zip_code)

    def _fetch_acs5(self, zip_code: str) -> DemographicsInfo:
        """api.census.gov/data/2023/acs/acs5?get=B01003_001E,B25001_001E&for=zip+code+tabulation+area:{zip}&key={key}"""
        path = "data/2023/acs/acs5"
        url = urljoin(self.base_url + "/", path)
        params = {
            "get": CENSUS_VARS,
            "for": f"zip code tabulation area:{zip_code}",
        }
        if self.api_key:
            params["key"] = self.api_key
        with httpx.Client(timeout=20.0) as client:
            r = client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        # Response: [ ["B01003_001E","B25001_001E","zip code tabulation area"], ["12345","67890","90210"] ]
        if not data or len(data) < 2:
            return self._fallback(zip_code)
        header = data[0]
        row = data[1]
        pop_idx = header.index("B01003_001E") if "B01003_001E" in header else 0
        hous_idx = header.index("B25001_001E") if "B25001_001E" in header else 1
        try:
            population = int(row[pop_idx]) if row[pop_idx] is not None else None
        except (TypeError, ValueError):
            population = None
        try:
            housing_units = int(row[hous_idx]) if row[hous_idx] is not None else None
        except (TypeError, ValueError):
            housing_units = None
        people_per = None
        if population is not None and housing_units is not None and housing_units > 0:
            people_per = round(population / housing_units, 1)
        summary_parts = []
        if population is not None:
            summary_parts.append(f"Population: {population:,}")
        if housing_units is not None:
            summary_parts.append(f"Housing units: {housing_units:,}")
        if people_per is not None:
            summary_parts.append(f"People per household (approx): {people_per}")
        return DemographicsInfo(
            zip_code=zip_code,
            population=population,
            housing_units=housing_units,
            people_per_household=people_per,
            summary="; ".join(summary_parts) if summary_parts else "No Census data.",
            raw={"header": header, "row": row},
        )

    def _fallback(self, zip_code: str) -> DemographicsInfo:
        return DemographicsInfo(
            zip_code=zip_code,
            summary="Census API unavailable or no data. Get a key at api.census.gov (~5 min).",
            raw={},
        )
