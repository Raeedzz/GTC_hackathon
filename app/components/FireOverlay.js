'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createFireGrid,
  latLonToGrid,
  simulateFire,
  calculateDamageReport,
} from '@/lib/damageModel';

export default function useFireSimulation() {
  const [fireGrid, setFireGrid] = useState(null);
  const [damage, setDamage] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const startFire = useCallback((latlng, bounds, weather, markers) => {
    setIsSimulating(true);

    const grid = createFireGrid(bounds);
    const { row, col } = latLonToGrid(latlng.lat, latlng.lng, bounds);

    // Animate fire spread
    let tick = 0;
    const maxTicks = 30;
    let currentGrid = grid.map(r => [...r]);
    currentGrid[row][col] = 1;

    const windRad = ((weather.wind_direction_degrees || 180) * Math.PI) / 180;
    const windFactor = Math.min((weather.wind_speed || 10) / 30, 1);
    const humidityFactor = 1 - Math.min((weather.humidity || 30) / 100, 0.8);
    const baseSpread = 0.3 * humidityFactor;

    const interval = setInterval(() => {
      if (tick >= maxTicks) {
        clearInterval(interval);
        // Final: all burning -> burned
        for (let i = 0; i < currentGrid.length; i++) {
          for (let j = 0; j < currentGrid[i].length; j++) {
            if (currentGrid[i][j] === 1) currentGrid[i][j] = 2;
          }
        }
        setFireGrid([...currentGrid.map(r => [...r])]);

        const report = calculateDamageReport(currentGrid, bounds, markers, weather);
        setDamage(report);
        setIsSimulating(false);
        return;
      }

      const newFires = [];
      const GRID_SIZE = currentGrid.length;

      for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
          if (currentGrid[i][j] !== 1) continue;
          for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
              if (di === 0 && dj === 0) continue;
              const ni = i + di, nj = j + dj;
              if (ni < 0 || ni >= GRID_SIZE || nj < 0 || nj >= GRID_SIZE) continue;
              if (currentGrid[ni][nj] !== 0) continue;

              const angle = Math.atan2(dj, -di);
              const windAlignment = Math.cos(angle - windRad);
              const prob = baseSpread + windFactor * 0.3 * Math.max(0, windAlignment);

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
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const reset = useCallback(() => {
    setFireGrid(null);
    setDamage(null);
    setIsSimulating(false);
  }, []);

  return { fireGrid, damage, isSimulating, startFire, reset };
}
