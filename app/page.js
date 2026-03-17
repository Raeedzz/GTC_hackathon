'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { CA_COUNTIES } from '@/lib/counties';
import CountySelector from './components/CountySelector';
import Sidebar from './components/Sidebar';
import useFireSimulation from './components/FireOverlay';
import useResponseAnimation from './components/ResponseAnimation';

const MapView = dynamic(() => import('./components/MapView'), { ssr: false });

function generateScatterPoints(bounds, count, seed = 1) {
  const points = [];
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  const latRange = bounds.north - bounds.south;
  const lonRange = bounds.east - bounds.west;
  for (let i = 0; i < count; i++) {
    const lat = bounds.south + latRange * (0.2 + 0.6 * rand());
    const lon = bounds.west + lonRange * (0.2 + 0.6 * rand());
    points.push({ lat, lon });
  }
  return points;
}

export default function Home() {
  const [selectedFips, setSelectedFips] = useState('');
  const [county, setCounty] = useState(null);
  const [census, setCensus] = useState(null);
  const [weather, setWeather] = useState(null);
  const [infrastructure, setInfrastructure] = useState(null);
  const [terrain, setTerrain] = useState(null);
  const [activeFires, setActiveFires] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [flat, setFlat] = useState(false);

  // Fire simulation
  const { fireGrid, damage, isSimulating, startFire, reset: resetFire } = useFireSimulation();

  // AI simulation
  const [simState, setSimState] = useState('idle');
  const [simLog, setSimLog] = useState([]);
  const [optimalPlan, setOptimalPlan] = useState(null);
  const [improvementCurve, setImprovementCurve] = useState(null);

  // Response animation
  const { animationPhase, startAnimation, resetAnimation } = useResponseAnimation(optimalPlan);

  // Scatter points
  const houses = useMemo(() => {
    if (!county) return [];
    return generateScatterPoints(county.bounds, 200, 42);
  }, [county]);

  const trees = useMemo(() => {
    if (!county) return [];
    return generateScatterPoints(county.bounds, 300, 7);
  }, [county]);

  // County selection handler
  const handleCountySelect = useCallback(async (fips) => {
    setSelectedFips(fips);
    if (!fips) {
      setCounty(null);
      setCensus(null);
      setWeather(null);
      setInfrastructure(null);
      setTerrain(null);
      setActiveFires([]);
      resetFire();
      resetAnimation();
      setSimState('idle');
      setSimLog([]);
      setOptimalPlan(null);
      setImprovementCurve(null);
      return;
    }

    const c = CA_COUNTIES.find(c => c.fips === fips);
    if (!c) return;

    setCounty(c);
    setCensus(null);
    setWeather(null);
    setInfrastructure(null);
    setTerrain(null);
    setActiveFires([]);
    resetFire();
    resetAnimation();
    setSimState('idle');
    setSimLog([]);
    setOptimalPlan(null);
    setImprovementCurve(null);
    setLoading(true);

    // Phase 1: Fetch census, weather, infrastructure in parallel
    setLoadingStatus('Fetching census, weather & infrastructure...');
    const [censusRes, weatherRes, infraRes] = await Promise.allSettled([
      fetch(`/api/census?fips=${c.fips}`).then(r => r.json()),
      fetch(`/api/weather?lat=${c.lat}&lon=${c.lon}`).then(r => r.json()),
      fetch(`/api/infrastructure?lat=${c.lat}&lon=${c.lon}`).then(r => r.json()),
    ]);

    if (censusRes.status === 'fulfilled') setCensus(censusRes.value);
    if (weatherRes.status === 'fulfilled') setWeather(weatherRes.value);
    if (infraRes.status === 'fulfilled') setInfrastructure(infraRes.value);

    // Phase 2: Fetch terrain (elevation + slope + fuel) and FIRMS data in parallel
    setLoadingStatus('Loading terrain elevation & active fire data...');
    const { north, south, east, west } = c.bounds;
    const [terrainRes, firmsRes] = await Promise.allSettled([
      fetch(`/api/terrain?north=${north}&south=${south}&east=${east}&west=${west}`).then(r => r.json()),
      fetch(`/api/firms?north=${north}&south=${south}&east=${east}&west=${west}&days=2`).then(r => r.json()),
    ]);

    if (terrainRes.status === 'fulfilled' && !terrainRes.value.error) {
      setTerrain(terrainRes.value);
    }
    if (firmsRes.status === 'fulfilled') {
      setActiveFires(firmsRes.value.active_fires || []);
    }

    setLoading(false);
    setLoadingStatus('');
  }, [resetFire, resetAnimation]);

  const getMarkers = useCallback(() => ({
    houses,
    fire_stations: infrastructure?.fire_stations || [],
    hospitals: infrastructure?.hospitals || [],
    police_stations: infrastructure?.police_stations || [],
    population: census?.population || 0,
  }), [houses, infrastructure, census]);

  // Map click -> fire ignition from single point
  const handleMapClick = useCallback((latlng) => {
    if (!county || !weather || isSimulating || simState !== 'idle') return;
    if (fireGrid) return;
    startFire([latlng], county.bounds, weather, getMarkers(), terrain);
  }, [county, weather, isSimulating, simState, fireGrid, terrain, startFire, getMarkers]);

  // Start fire from all FIRMS hotspots
  const handleStartFromHotspots = useCallback(() => {
    if (!county || !weather || isSimulating || simState !== 'idle') return;
    if (fireGrid) return;
    if (!activeFires || activeFires.length === 0) return;

    const ignitionPoints = activeFires.map(f => ({ lat: f.lat, lon: f.lon }));
    startFire(ignitionPoints, county.bounds, weather, getMarkers(), terrain);
  }, [county, weather, isSimulating, simState, fireGrid, activeFires, terrain, startFire, getMarkers]);

  // Start AI simulation
  const handleStartSim = useCallback(async () => {
    if (!county || !damage || !weather || !infrastructure) return;

    setSimState('running');
    setSimLog([]);
    setOptimalPlan(null);
    setImprovementCurve(null);
    resetAnimation();

    const scenario = {
      county: county.name,
      population: census?.population || 0,
      housing_units: census?.housing_units || 0,
      weather,
      infrastructure,
      damage,
    };

    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenario),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'plan_evaluated' || msg.type === 'round_complete') {
              setSimLog(prev => [...prev, msg]);
            }
            if (msg.type === 'error') {
              console.warn('AI round error:', msg.message);
              setSimLog(prev => [...prev, msg]);
            }
            if (msg.type === 'fatal_error') {
              console.error('AI fatal error:', msg.message);
              setSimState('idle');
            }
            if (msg.type === 'complete') {
              setOptimalPlan(msg.optimal_plan);
              setImprovementCurve(msg.improvement_curve);
              setSimState(msg.optimal_plan ? 'complete' : 'idle');
            }
          } catch (parseErr) {
            console.warn('Stream parse error:', parseErr);
          }
        }
      }
    } catch (err) {
      console.error('Simulation error:', err);
      setSimState('idle');
    }
  }, [county, damage, weather, infrastructure, census, resetAnimation]);

  // Auto-start animation when plan arrives
  useEffect(() => {
    if (optimalPlan && simState === 'complete') {
      startAnimation();
    }
  }, [optimalPlan, simState, startAnimation]);

  const mapCenter = county ? [county.lat, county.lon] : null;
  const mapZoom = county ? 11 : 7;

  return (
    <div className="app-container">
      <header className="header">
        <h1>WILDFIRE RECOVERY SIMULATOR</h1>
        <div className="header-controls">
          <CountySelector
            selected={selectedFips}
            onChange={handleCountySelect}
            disabled={loading || simState === 'running'}
          />
          <button
            className="btn btn-secondary"
            onClick={() => setFlat(!flat)}
          >
            {flat ? '3D View' : 'Flat View'}
          </button>
          {fireGrid && simState === 'idle' && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                resetFire();
                resetAnimation();
                setSimLog([]);
                setOptimalPlan(null);
                setImprovementCurve(null);
              }}
            >
              Reset Fire
            </button>
          )}
        </div>
      </header>

      <div className="main-content">
        <div className="map-section">
          <MapView
            center={mapCenter}
            zoom={mapZoom}
            bounds={county?.bounds}
            houses={houses}
            trees={trees}
            infrastructure={infrastructure}
            fireGrid={fireGrid}
            plan={optimalPlan}
            animationPhase={animationPhase}
            onMapClick={handleMapClick}
            flat={flat}
            activeFires={activeFires}
            terrain={terrain}
          />
          {loading && loadingStatus && (
            <div className="map-overlay-instructions animate-pulse">
              {loadingStatus}
            </div>
          )}
          {county && !loading && !fireGrid && !isSimulating && (
            <div className="map-overlay-instructions">
              {activeFires.length > 0
                ? `${activeFires.length} active FIRMS hotspots detected — use sidebar to simulate, or click map`
                : 'Click on the map to ignite a wildfire'}
            </div>
          )}
          {isSimulating && (
            <div className="map-overlay-instructions animate-pulse">
              Fire spreading with terrain model...
            </div>
          )}
        </div>

        <Sidebar
          county={county}
          census={census}
          weather={weather}
          infrastructure={infrastructure}
          terrain={terrain}
          activeFires={activeFires}
          damage={damage}
          simState={simState}
          simLog={simLog}
          optimalPlan={optimalPlan}
          improvementCurve={improvementCurve}
          onStartSim={handleStartSim}
          onStartFromHotspots={handleStartFromHotspots}
          animationPhase={animationPhase}
        />
      </div>
    </div>
  );
}
