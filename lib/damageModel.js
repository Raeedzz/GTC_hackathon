const GRID_SIZE = 50;

export function createFireGrid(bounds) {
  const grid = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    grid[i] = [];
    for (let j = 0; j < GRID_SIZE; j++) {
      grid[i][j] = 0; // 0=unburned, 1=burning, 2=burned
    }
  }
  return grid;
}

export function latLonToGrid(lat, lon, bounds) {
  const row = Math.floor(((bounds.north - lat) / (bounds.north - bounds.south)) * GRID_SIZE);
  const col = Math.floor(((lon - bounds.west) / (bounds.east - bounds.west)) * GRID_SIZE);
  return {
    row: Math.max(0, Math.min(GRID_SIZE - 1, row)),
    col: Math.max(0, Math.min(GRID_SIZE - 1, col)),
  };
}

export function gridToLatLon(row, col, bounds) {
  const lat = bounds.north - (row / GRID_SIZE) * (bounds.north - bounds.south);
  const lon = bounds.west + (col / GRID_SIZE) * (bounds.east - bounds.west);
  return { lat, lon };
}

/**
 * Rothermel-inspired fire spread probability.
 * Uses real elevation (slope effect), fuel type (spread rate), wind, and humidity.
 *
 * terrain = { elevation[][], slope[][], aspect[][], fuelProps[][] }
 * Each fuelProps cell = { spreadRate: 0-1.2, burnIntensity: 0-1 }
 */
export function getSpreadProbability(fromRow, fromCol, toRow, toCol, weather, terrain) {
  const fuel = terrain?.fuelProps?.[toRow]?.[toCol];
  if (!fuel || fuel.spreadRate === 0) return 0; // Non-burnable (water, ice, barren)

  // Base spread from fuel type
  const fuelSpread = fuel.spreadRate;

  // Humidity factor: lower humidity = faster spread
  const humidity = weather.humidity || 30;
  const humidityFactor = 1 - Math.min(humidity / 100, 0.8);

  // Wind factor: fire spreads faster downwind
  const windRad = ((weather.wind_direction_degrees || 180) * Math.PI) / 180;
  const windSpeed = weather.wind_speed || 10;
  const windStrength = Math.min(windSpeed / 30, 1);
  const dRow = toRow - fromRow;
  const dCol = toCol - fromCol;
  const spreadAngle = Math.atan2(dCol, -dRow);
  const windAlignment = Math.cos(spreadAngle - windRad);
  const windBoost = windStrength * 0.35 * Math.max(0, windAlignment);

  // Slope factor (Rothermel): fire spreads much faster uphill
  // phi_s = 5.275 * beta^(-0.3) * tan(slope)^2 — simplified
  let slopeFactor = 0;
  if (terrain?.elevation) {
    const fromElev = terrain.elevation[fromRow]?.[fromCol] || 0;
    const toElev = terrain.elevation[toRow]?.[toCol] || 0;
    const elevDiff = toElev - fromElev; // positive = uphill
    const cellSizeMeters = terrain.meta?.cell_size_meters || 500;
    const slopeAngle = Math.atan(elevDiff / cellSizeMeters);

    if (elevDiff > 0) {
      // Uphill: significantly increases spread (Rothermel slope factor)
      slopeFactor = Math.min(0.4, 2.0 * Math.pow(Math.tan(slopeAngle), 2));
    } else {
      // Downhill: reduces spread
      slopeFactor = Math.max(-0.15, -0.5 * Math.pow(Math.tan(Math.abs(slopeAngle)), 2));
    }
  }

  // Temperature factor: hotter = drier fuels = easier spread
  const temp = weather.temperature || 75;
  const tempFactor = temp > 90 ? 0.1 : temp > 80 ? 0.05 : 0;

  // Combine: base * fuel * (humidity + wind + slope + temp)
  const probability = 0.2 * fuelSpread * (humidityFactor + windBoost + slopeFactor + tempFactor);

  return Math.max(0, Math.min(0.95, probability));
}

/**
 * Simulate fire spread using terrain-aware Rothermel-inspired model.
 * If no terrain data, falls back to basic wind/humidity model.
 */
export function simulateFireWithTerrain(grid, ignitionRow, ignitionCol, weather, terrain, ticks = 30) {
  const g = grid.map(r => [...r]);
  g[ignitionRow][ignitionCol] = 1;

  for (let t = 0; t < ticks; t++) {
    const newFires = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (g[i][j] !== 1) continue;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            if (di === 0 && dj === 0) continue;
            const ni = i + di, nj = j + dj;
            if (ni < 0 || ni >= GRID_SIZE || nj < 0 || nj >= GRID_SIZE) continue;
            if (g[ni][nj] !== 0) continue;

            const prob = terrain
              ? getSpreadProbability(i, j, ni, nj, weather, terrain)
              : getFallbackProbability(i, j, ni, nj, weather);

            if (Math.random() < prob) {
              newFires.push([ni, nj]);
            }
          }
        }
        g[i][j] = 2; // burned
      }
    }
    for (const [ni, nj] of newFires) {
      g[ni][nj] = 1;
    }
    if (newFires.length === 0) break;
  }

  // Finalize
  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      if (g[i][j] === 1) g[i][j] = 2;
    }
  }
  return g;
}

/** Fallback when terrain data isn't available */
function getFallbackProbability(fromRow, fromCol, toRow, toCol, weather) {
  const windRad = ((weather.wind_direction_degrees || 180) * Math.PI) / 180;
  const windFactor = Math.min((weather.wind_speed || 10) / 30, 1);
  const humidityFactor = 1 - Math.min((weather.humidity || 30) / 100, 0.8);
  const baseSpread = 0.3 * humidityFactor;

  const dCol = toCol - fromCol;
  const dRow = toRow - fromRow;
  const angle = Math.atan2(dCol, -dRow);
  const windAlignment = Math.cos(angle - windRad);
  return baseSpread + windFactor * 0.3 * Math.max(0, windAlignment);
}

export function calculateDamageReport(fireGrid, bounds, markers, weather, terrain) {
  let burnedCells = 0;
  const totalCells = GRID_SIZE * GRID_SIZE;
  const firePerimeter = [];

  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      if (fireGrid[i][j] === 2) {
        burnedCells++;
        let isPerimeter = false;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || ni >= GRID_SIZE || nj < 0 || nj >= GRID_SIZE || fireGrid[ni][nj] !== 2) {
              isPerimeter = true;
            }
          }
        }
        if (isPerimeter) {
          const { lat, lon } = gridToLatLon(i, j, bounds);
          firePerimeter.push([lat, lon]);
        }
      }
    }
  }

  const burnedAreaPct = Math.round((burnedCells / totalCells) * 100);

  function isInFireZone(lat, lon) {
    const { row, col } = latLonToGrid(lat, lon, bounds);
    return fireGrid[row]?.[col] === 2;
  }

  const housesDestroyed = (markers.houses || []).filter(h => isInFireZone(h.lat, h.lon)).length;
  const housesTotal = (markers.houses || []).length;
  const housesThreatened = Math.round(housesTotal * burnedAreaPct / 100);
  const populationAffected = Math.round((markers.population || 0) * burnedAreaPct / 100);

  const fireStationsThreatened = (markers.fire_stations || [])
    .filter(s => isInFireZone(s.lat, s.lon))
    .map(s => ({ name: s.name, lat: s.lat, lon: s.lon }));

  const hospitalsThreatened = (markers.hospitals || [])
    .filter(h => isInFireZone(h.lat, h.lon))
    .map(h => ({ name: h.name, lat: h.lat, lon: h.lon }));

  const blockedRoads = Math.round(burnedAreaPct * 0.5);

  // Terrain-aware damage intensity
  let avgBurnIntensity = 0.5;
  if (terrain?.fuelProps) {
    let totalIntensity = 0;
    let burnCount = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (fireGrid[i][j] === 2 && terrain.fuelProps[i]?.[j]) {
          totalIntensity += terrain.fuelProps[i][j].burnIntensity;
          burnCount++;
        }
      }
    }
    if (burnCount > 0) avgBurnIntensity = totalIntensity / burnCount;
  }

  return {
    burned_area_pct: burnedAreaPct,
    houses_destroyed: housesDestroyed,
    houses_threatened: housesThreatened,
    population_affected: populationAffected,
    fire_stations_threatened: fireStationsThreatened,
    hospitals_threatened: hospitalsThreatened,
    blocked_roads: blockedRoads,
    fire_perimeter: firePerimeter.slice(0, 50),
    burn_intensity: Math.round(avgBurnIntensity * 100) / 100,
    terrain_summary: terrain?.meta ? {
      min_elevation: terrain.meta.min_elevation,
      max_elevation: terrain.meta.max_elevation,
      cell_size_meters: terrain.meta.cell_size_meters,
    } : null,
  };
}

export function scorePlan(plan, scenario) {
  let score = 0;
  const { damage } = scenario;

  const deployments = plan.firetruck_deployments || [];
  for (const dep of deployments) {
    const pos = dep.to_position;
    if (!pos) continue;
    const minDist = Math.min(...(damage.fire_perimeter || []).map(p =>
      Math.sqrt((p[0] - pos[0]) ** 2 + (p[1] - pos[1]) ** 2)
    ));
    if (minDist < 0.05) score += 15;
    else if (minDist < 0.1) score += 8;
    else score += 2;
  }

  const evacuationZones = plan.evacuation_zones || [];
  score += Math.min(evacuationZones.length * 20, 100) * 0.5;

  const hospitalAssignments = plan.hospital_assignments || [];
  if (hospitalAssignments.length > 0) {
    const avgCapacity = hospitalAssignments.reduce((s, h) => s + (h.capacity_pct || 50), 0) / hospitalAssignments.length;
    if (avgCapacity >= 60) score += 50;
    else score += avgCapacity * 0.5;
  }

  for (const dep of deployments) {
    if (dep.from_station && dep.to_position) {
      const dist = Math.sqrt(
        (dep.from_station[0] - dep.to_position[0]) ** 2 +
        (dep.from_station[1] - dep.to_position[1]) ** 2
      );
      score -= dist * 20;
    }
  }

  const policeDeployments = plan.police_deployments || [];
  score += Math.min(policeDeployments.length * 10, damage.blocked_roads * 10);

  const shelters = plan.shelter_locations || [];
  const totalCapacity = shelters.reduce((s, sh) => s + (sh.capacity || 0), 0);
  if (totalCapacity >= damage.population_affected) score += 30;
  else score += (totalCapacity / Math.max(damage.population_affected, 1)) * 30;

  score += Math.min((plan.evacuation_routes || []).length * 5, 25);

  const timeline = plan.timeline || [];
  if (timeline.length >= 3) score += 15;
  else score += timeline.length * 5;

  const resources = plan.resource_allocation || {};
  if (resources.firefighters > 0) score += 10;
  if (resources.ambulances > 0) score += 10;

  return Math.round(score);
}
