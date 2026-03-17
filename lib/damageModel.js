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

export function simulateFire(grid, ignitionRow, ignitionCol, weather, ticks = 30) {
  const g = grid.map(r => [...r]);
  g[ignitionRow][ignitionCol] = 1;

  const windRad = ((weather.wind_direction_degrees || 180) * Math.PI) / 180;
  const windFactor = Math.min((weather.wind_speed || 10) / 30, 1);
  const humidityFactor = 1 - Math.min((weather.humidity || 30) / 100, 0.8);
  const baseSpread = 0.3 * humidityFactor;

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

            const angle = Math.atan2(dj, -di);
            const windAlignment = Math.cos(angle - windRad);
            const prob = baseSpread + windFactor * 0.3 * Math.max(0, windAlignment);

            if (Math.random() < prob) {
              newFires.push([ni, nj]);
            }
          }
        }
        // burning cell becomes burned after spreading
        g[i][j] = 2;
      }
    }
    for (const [ni, nj] of newFires) {
      g[ni][nj] = 1;
    }
    // If no new fires, stop
    if (newFires.length === 0) break;
  }

  // Final: convert remaining burning to burned
  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      if (g[i][j] === 1) g[i][j] = 2;
    }
  }

  return g;
}

export function calculateDamageReport(fireGrid, bounds, markers, weather) {
  let burnedCells = 0;
  const totalCells = GRID_SIZE * GRID_SIZE;
  const firePerimeter = [];

  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      if (fireGrid[i][j] === 2) {
        burnedCells++;
        // Check if on perimeter
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

  return {
    burned_area_pct: burnedAreaPct,
    houses_destroyed: housesDestroyed,
    houses_threatened: housesThreatened,
    population_affected: populationAffected,
    fire_stations_threatened: fireStationsThreatened,
    hospitals_threatened: hospitalsThreatened,
    blocked_roads: blockedRoads,
    fire_perimeter: firePerimeter.slice(0, 50), // limit for prompt size
  };
}

export function scorePlan(plan, scenario) {
  let score = 0;
  const { damage } = scenario;

  // 1. Fire containment: trucks near fire perimeter
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

  // 2. Evacuation coverage
  const evacuationZones = plan.evacuation_zones || [];
  const zoneCoverage = Math.min(evacuationZones.length * 20, 100);
  score += zoneCoverage * 0.5;

  // 3. Medical capacity
  const hospitalAssignments = plan.hospital_assignments || [];
  if (hospitalAssignments.length > 0) {
    const avgCapacity = hospitalAssignments.reduce((s, h) => s + (h.capacity_pct || 50), 0) / hospitalAssignments.length;
    if (avgCapacity >= 60) score += 50;
    else score += avgCapacity * 0.5;
  }

  // 4. Response time penalty (distance)
  for (const dep of deployments) {
    if (dep.from_station && dep.to_position) {
      const dist = Math.sqrt(
        (dep.from_station[0] - dep.to_position[0]) ** 2 +
        (dep.from_station[1] - dep.to_position[1]) ** 2
      );
      score -= dist * 20;
    }
  }

  // 5. Police coverage at blocked roads
  const policeDeployments = plan.police_deployments || [];
  score += Math.min(policeDeployments.length * 10, damage.blocked_roads * 10);

  // 6. Shelter capacity
  const shelters = plan.shelter_locations || [];
  const totalCapacity = shelters.reduce((s, sh) => s + (sh.capacity || 0), 0);
  if (totalCapacity >= damage.population_affected) score += 30;
  else score += (totalCapacity / Math.max(damage.population_affected, 1)) * 30;

  // 7. Evacuation routes
  const routes = plan.evacuation_routes || [];
  score += Math.min(routes.length * 5, 25);

  // 8. Timeline realism bonus
  const timeline = plan.timeline || [];
  if (timeline.length >= 3) score += 15;
  else score += timeline.length * 5;

  // 9. Resource allocation bonus
  const resources = plan.resource_allocation || {};
  if (resources.firefighters > 0) score += 10;
  if (resources.ambulances > 0) score += 10;

  return Math.round(score);
}
