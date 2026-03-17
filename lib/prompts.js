export function buildColdStartPrompt(scenario) {
  return `You are a disaster recovery AI. A wildfire has hit ${scenario.county} County, California.

DAMAGE REPORT:
- Burned area: ${scenario.damage.burned_area_pct}% of county area
- Houses destroyed: ${scenario.damage.houses_destroyed}
- Houses threatened: ${scenario.damage.houses_threatened}
- Population affected: ${scenario.damage.population_affected}
- Fire stations threatened: ${JSON.stringify(scenario.damage.fire_stations_threatened)}
- Hospitals threatened: ${JSON.stringify(scenario.damage.hospitals_threatened)}
- Blocked roads: ${scenario.damage.blocked_roads}
- Fire perimeter coordinates: ${JSON.stringify(scenario.damage.fire_perimeter.slice(0, 10))}

AVAILABLE RESOURCES:
- Fire stations: ${JSON.stringify(scenario.infrastructure.fire_stations)}
- Hospitals: ${JSON.stringify(scenario.infrastructure.hospitals)}
- Police stations: ${JSON.stringify(scenario.infrastructure.police_stations)}
- County population: ${scenario.population}
- Housing units: ${scenario.housing_units}

WEATHER CONDITIONS:
- Temperature: ${scenario.weather.temperature}°F
- Humidity: ${scenario.weather.humidity}%
- Wind speed: ${scenario.weather.wind_speed} mph
- Wind direction: ${scenario.weather.wind_direction}

Generate exactly 3 DIVERSE disaster recovery plans as a JSON array. Each plan must have this exact structure:
{
  "plan_id": <number 1-3>,
  "strategy_name": "<short name>",
  "description": "<1-2 sentence description>",
  "priority_order": ["containment"|"evacuation"|"medical"],
  "firetruck_deployments": [{"from_station": [lat,lon], "station_name": "...", "to_position": [lat,lon], "task": "..."}],
  "police_deployments": [{"from_station": [lat,lon], "to_position": [lat,lon], "task": "..."}],
  "evacuation_zones": [{"center": [lat,lon], "radius_meters": <number>, "priority": "immediate"|"secondary", "direction": "..."}],
  "evacuation_routes": [{"from": [lat,lon], "to": [lat,lon], "type": "primary"|"secondary"}],
  "hospital_assignments": [{"hospital": [lat,lon], "name": "...", "role": "primary triage"|"overflow"|"specialized", "capacity_pct": <number>}],
  "shelter_locations": [{"position": [lat,lon], "capacity": <number>, "type": "evacuation shelter"}],
  "resource_allocation": {"firefighters": <num>, "police_officers": <num>, "ambulances": <num>, "helicopters": <num>, "water_tankers": <num>},
  "timeline": [{"time": "0-15min", "action": "..."}, ...]
}

Vary strategies: one prioritizing containment, one prioritizing evacuation, one balanced.

IMPORTANT: Use real coordinates near the county. All lat/lon must be within the county area. Output ONLY the JSON array, no other text.`;
}

export function buildIterativePrompt(scenario, bestPlan, bestScore, history) {
  const topPlans = [...history].sort((a, b) => b.score - a.score).slice(0, 5);
  const bottomPlans = [...history].sort((a, b) => a.score - b.score).slice(0, 3);

  return `You are a disaster recovery AI improving your response plans through iteration.

SCENARIO (${scenario.county} County, California):
- Burned area: ${scenario.damage.burned_area_pct}%
- Houses destroyed: ${scenario.damage.houses_destroyed}, threatened: ${scenario.damage.houses_threatened}
- Population affected: ${scenario.damage.population_affected}
- Fire stations: ${JSON.stringify(scenario.infrastructure.fire_stations)}
- Hospitals: ${JSON.stringify(scenario.infrastructure.hospitals)}
- Police stations: ${JSON.stringify(scenario.infrastructure.police_stations)}
- Fire perimeter: ${JSON.stringify(scenario.damage.fire_perimeter.slice(0, 15))}

YOUR BEST PLAN SO FAR (score: ${bestScore}):
${JSON.stringify(bestPlan, null, 2)}

TOP SCORING STRATEGIES:
${topPlans.map(p => `- "${p.strategy}" scored ${p.score}`).join('\n')}

LOW SCORING STRATEGIES (avoid these approaches):
${bottomPlans.map(p => `- "${p.strategy}" scored ${p.score}`).join('\n')}

Generate 3 NEW plans that IMPROVE on the best plan. Try:
- Variations on the winning strategy with adjusted deployments
- Moving trucks closer to the fire perimeter
- Better evacuation coverage for affected population
- More efficient resource allocation
- Novel combinations of what worked before

Each plan must follow the same JSON schema as before (plan_id 1-3). All coordinates must be within the county.
Push for higher scores. Output ONLY the JSON array, no other text.`;
}
