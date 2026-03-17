import { NextResponse } from 'next/server';

const GRID_SIZE = 50;

// NLCD land cover codes mapped to fuel properties
// spreadRate: relative multiplier (1.0 = baseline grass), burnIntensity: how much damage
const FUEL_MODELS = {
  11: { name: 'Water', spreadRate: 0, burnIntensity: 0 },
  12: { name: 'Ice/Snow', spreadRate: 0, burnIntensity: 0 },
  21: { name: 'Developed Open', spreadRate: 0.3, burnIntensity: 0.2 },
  22: { name: 'Developed Low', spreadRate: 0.2, burnIntensity: 0.4 },
  23: { name: 'Developed Med', spreadRate: 0.15, burnIntensity: 0.6 },
  24: { name: 'Developed High', spreadRate: 0.1, burnIntensity: 0.8 },
  31: { name: 'Barren', spreadRate: 0.05, burnIntensity: 0.05 },
  41: { name: 'Deciduous Forest', spreadRate: 0.7, burnIntensity: 0.9 },
  42: { name: 'Evergreen Forest', spreadRate: 0.85, burnIntensity: 1.0 },
  43: { name: 'Mixed Forest', spreadRate: 0.75, burnIntensity: 0.95 },
  51: { name: 'Dwarf Scrub', spreadRate: 0.6, burnIntensity: 0.5 },
  52: { name: 'Shrub/Scrub', spreadRate: 1.0, burnIntensity: 0.8 },
  71: { name: 'Grassland', spreadRate: 1.2, burnIntensity: 0.4 },
  72: { name: 'Sedge', spreadRate: 0.8, burnIntensity: 0.3 },
  81: { name: 'Pasture', spreadRate: 0.9, burnIntensity: 0.35 },
  82: { name: 'Cultivated', spreadRate: 0.5, burnIntensity: 0.3 },
  90: { name: 'Woody Wetlands', spreadRate: 0.3, burnIntensity: 0.4 },
  95: { name: 'Herbaceous Wetlands', spreadRate: 0.25, burnIntensity: 0.2 },
};

const DEFAULT_FUEL = { name: 'Unknown', spreadRate: 0.5, burnIntensity: 0.5 };

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const north = parseFloat(searchParams.get('north'));
  const south = parseFloat(searchParams.get('south'));
  const east = parseFloat(searchParams.get('east'));
  const west = parseFloat(searchParams.get('west'));

  if ([north, south, east, west].some(isNaN)) {
    return NextResponse.json({ error: 'Missing bounds (north, south, east, west)' }, { status: 400 });
  }

  try {
    // Build grid points for elevation query
    // Open Topo Data allows 100 points per request, so we need ceil(2500/100) = 25 requests
    // Optimization: sample a coarser grid (25x25) and interpolate to 50x50
    const SAMPLE_SIZE = 25;
    const points = [];
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      for (let j = 0; j < SAMPLE_SIZE; j++) {
        const lat = north - (i / (SAMPLE_SIZE - 1)) * (north - south);
        const lon = west + (j / (SAMPLE_SIZE - 1)) * (east - west);
        points.push({ lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)), i, j });
      }
    }

    // Batch into groups of 100 for Open Topo Data
    const batches = [];
    for (let k = 0; k < points.length; k += 100) {
      batches.push(points.slice(k, k + 100));
    }

    // Fetch elevation data from Open Topo Data
    const elevationSample = Array.from({ length: SAMPLE_SIZE }, () => new Array(SAMPLE_SIZE).fill(0));

    const results = await Promise.all(
      batches.map(async (batch, batchIdx) => {
        const locations = batch.map(p => `${p.lat},${p.lon}`).join('|');
        try {
          const res = await fetch(
            `https://api.opentopodata.org/v1/ned10m?locations=${locations}`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (!res.ok) return { batchIdx, data: null };
          const data = await res.json();
          return { batchIdx, data };
        } catch {
          return { batchIdx, data: null };
        }
      })
    );

    // Fill elevation sample grid
    for (const { batchIdx, data } of results) {
      if (!data || !data.results) continue;
      const batchStart = batchIdx * 100;
      for (let k = 0; k < data.results.length; k++) {
        const point = points[batchStart + k];
        const elev = data.results[k]?.elevation;
        if (point && elev != null) {
          elevationSample[point.i][point.j] = elev;
        }
      }
    }

    // Bilinear interpolation to full 50x50 grid
    const elevation = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(0));
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        const si = (i / (GRID_SIZE - 1)) * (SAMPLE_SIZE - 1);
        const sj = (j / (GRID_SIZE - 1)) * (SAMPLE_SIZE - 1);
        const i0 = Math.floor(si), i1 = Math.min(i0 + 1, SAMPLE_SIZE - 1);
        const j0 = Math.floor(sj), j1 = Math.min(j0 + 1, SAMPLE_SIZE - 1);
        const fi = si - i0, fj = sj - j0;
        elevation[i][j] = Math.round(
          elevationSample[i0][j0] * (1 - fi) * (1 - fj) +
          elevationSample[i1][j0] * fi * (1 - fj) +
          elevationSample[i0][j1] * (1 - fi) * fj +
          elevationSample[i1][j1] * fi * fj
        );
      }
    }

    // Calculate slope grid (degrees) from elevation
    const slope = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(0));
    const cellSizeMeters = ((north - south) / GRID_SIZE) * 111320; // approximate meters per cell

    for (let i = 1; i < GRID_SIZE - 1; i++) {
      for (let j = 1; j < GRID_SIZE - 1; j++) {
        const dzdx = (elevation[i][j + 1] - elevation[i][j - 1]) / (2 * cellSizeMeters);
        const dzdy = (elevation[i - 1][j] - elevation[i + 1][j]) / (2 * cellSizeMeters);
        slope[i][j] = Math.round(Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI));
      }
    }

    // Calculate aspect grid (direction slope faces, in degrees from north)
    const aspect = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(0));
    for (let i = 1; i < GRID_SIZE - 1; i++) {
      for (let j = 1; j < GRID_SIZE - 1; j++) {
        const dzdx = (elevation[i][j + 1] - elevation[i][j - 1]) / (2 * cellSizeMeters);
        const dzdy = (elevation[i - 1][j] - elevation[i + 1][j]) / (2 * cellSizeMeters);
        let a = Math.atan2(-dzdy, dzdx) * (180 / Math.PI);
        a = (90 - a + 360) % 360; // convert to compass bearing
        aspect[i][j] = Math.round(a);
      }
    }

    // Generate fuel grid based on elevation heuristics (since NLCD WCS returns GeoTIFF which is hard to parse)
    // Use elevation + randomness to assign NLCD-like fuel types
    const fuel = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(52));
    const minElev = Math.min(...elevation.flat());
    const maxElev = Math.max(...elevation.flat());
    const elevRange = maxElev - minElev || 1;

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        const e = elevation[i][j];
        const normalized = (e - minElev) / elevRange;

        if (e <= minElev + 5 && minElev < 50) {
          fuel[i][j] = 11; // Water at very low elevations near sea level
        } else if (normalized < 0.15) {
          fuel[i][j] = 71; // Grassland at low elevations
        } else if (normalized < 0.3) {
          // Mix of developed and grassland in valleys
          fuel[i][j] = (i * 7 + j * 13) % 5 < 2 ? 21 : 71;
        } else if (normalized < 0.55) {
          fuel[i][j] = 52; // Shrub/Scrub at mid elevations (chaparral - very CA)
        } else if (normalized < 0.75) {
          fuel[i][j] = 42; // Evergreen forest at higher elevations
        } else if (normalized < 0.9) {
          fuel[i][j] = 43; // Mixed forest
        } else {
          fuel[i][j] = 31; // Barren at highest elevations
        }
      }
    }

    // Build fuel properties grid
    const fuelProps = fuel.map(row =>
      row.map(code => FUEL_MODELS[code] || DEFAULT_FUEL)
    );

    return NextResponse.json({
      elevation,
      slope,
      aspect,
      fuel,
      fuelProps,
      meta: {
        grid_size: GRID_SIZE,
        min_elevation: minElev,
        max_elevation: maxElev,
        cell_size_meters: Math.round(cellSizeMeters),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Terrain fetch failed: ' + err.message }, { status: 500 });
  }
}
