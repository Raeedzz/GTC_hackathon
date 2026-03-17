'use client';

import { useState, useCallback, useRef } from 'react';
import {
  createFireGrid,
  latLonToGrid,
  getSpreadProbability,
  calculateDamageReport,
} from '@/lib/damageModel';

export default function useFireSimulation() {
  const [fireGrid, setFireGrid] = useState(null);
  const [damage, setDamage] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const intervalRef = useRef(null);

  /**
   * Start fire from one or more ignition points.
   * @param {Array} ignitionPoints - Array of {lat, lng} or {lat, lon}
   * @param {Object} bounds - { north, south, east, west }
   * @param {Object} weather
   * @param {Object} markers
   * @param {Object|null} terrain
   */
  const startFire = useCallback((ignitionPoints, bounds, weather, markers, terrain) => {
    setIsSimulating(true);

    // Normalize to array
    const points = Array.isArray(ignitionPoints) ? ignitionPoints : [ignitionPoints];

    const GRID_SIZE = 50;
    let currentGrid = createFireGrid(bounds);

    // Ignite all points
    for (const pt of points) {
      const lat = pt.lat;
      const lon = pt.lng ?? pt.lon;
      const { row, col } = latLonToGrid(lat, lon, bounds);
      currentGrid[row][col] = 1;
    }

    let tick = 0;
    const maxTicks = 30;

    // Fallback values if no terrain
    const windRad = ((weather.wind_direction_degrees || 180) * Math.PI) / 180;
    const windFactor = Math.min((weather.wind_speed || 10) / 30, 1);
    const humidityFactor = 1 - Math.min((weather.humidity || 30) / 100, 0.8);
    const baseSpread = 0.3 * humidityFactor;

    intervalRef.current = setInterval(() => {
      if (tick >= maxTicks) {
        clearInterval(intervalRef.current);
        for (let i = 0; i < GRID_SIZE; i++) {
          for (let j = 0; j < currentGrid[i].length; j++) {
            if (currentGrid[i][j] === 1) currentGrid[i][j] = 2;
          }
        }
        setFireGrid([...currentGrid.map(r => [...r])]);
        const report = calculateDamageReport(currentGrid, bounds, markers, weather, terrain);
        setDamage(report);
        setIsSimulating(false);
        return;
      }

      const newFires = [];

      for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
          if (currentGrid[i][j] !== 1) continue;
          for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
              if (di === 0 && dj === 0) continue;
              const ni = i + di, nj = j + dj;
              if (ni < 0 || ni >= GRID_SIZE || nj < 0 || nj >= GRID_SIZE) continue;
              if (currentGrid[ni][nj] !== 0) continue;

              let prob;
              if (terrain) {
                prob = getSpreadProbability(i, j, ni, nj, weather, terrain);
              } else {
                const angle = Math.atan2(dj, -di);
                const windAlignment = Math.cos(angle - windRad);
                prob = baseSpread + windFactor * 0.3 * Math.max(0, windAlignment);
              }

              if (Math.random() < prob) {
                newFires.push([ni, nj]);
              }
            }
          }
          currentGrid[i][j] = 2;
        }
      }

      for (const [ni, nj] of newFires) {
        currentGrid[ni][nj] = 1;
      }

      tick++;
      setFireGrid([...currentGrid.map(r => [...r])]);
    }, 50);
  }, []);

  const reset = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setFireGrid(null);
    setDamage(null);
    setIsSimulating(false);
  }, []);

  return { fireGrid, damage, isSimulating, startFire, reset };
}
