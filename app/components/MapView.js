'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function MapController({ center, zoom, onMapClick }) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom || 11, { duration: 1.5 });
    }
  }, [center, zoom, map]);

  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick(e.latlng);
      }
    },
  });

  return null;
}

function InfrastructureMarkers({ infrastructure }) {
  const map = useMap();
  const markersRef = useRef([]);

  useEffect(() => {
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    if (!infrastructure) return;

    const addMarkers = (items, emoji, className) => {
      (items || []).forEach(item => {
        const icon = L.divIcon({
          className: '',
          html: `<div class="infrastructure-marker ${className}">${emoji} ${item.name}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        const marker = L.marker([item.lat, item.lon], { icon }).addTo(map);
        markersRef.current.push(marker);
      });
    };

    addMarkers(infrastructure.fire_stations, '\u{1F6A8}', 'fire-station');
    addMarkers(infrastructure.hospitals, '\u{1F3E5}', 'hospital');
    addMarkers(infrastructure.police_stations, '\u{1F46E}', 'police');

    return () => {
      markersRef.current.forEach(m => map.removeLayer(m));
      markersRef.current = [];
    };
  }, [infrastructure, map]);

  return null;
}

/** Render NASA FIRMS active fire detections as pulsing orange markers */
function ActiveFiresLayer({ activeFires }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!activeFires || activeFires.length === 0) return;

    const group = L.layerGroup();

    activeFires.forEach(fire => {
      // Size based on Fire Radiative Power
      const radius = Math.max(4, Math.min(12, (fire.frp || 5) / 10));
      const confidence = fire.confidence || 'nominal';
      const opacity = confidence === 'high' ? 0.9 : confidence === 'nominal' ? 0.7 : 0.4;

      const marker = L.circleMarker([fire.lat, fire.lon], {
        radius,
        color: '#ff6600',
        fillColor: '#ff4400',
        fillOpacity: opacity,
        weight: 2,
        className: 'firms-fire-marker',
      });

      marker.bindTooltip(
        `FIRMS Detection<br>FRP: ${fire.frp} MW<br>Confidence: ${confidence}<br>${fire.date} ${fire.time} UTC`,
        { direction: 'top' }
      );

      group.addLayer(marker);
    });

    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
    };
  }, [activeFires, map]);

  return null;
}

/** Render terrain fuel type as a subtle colored overlay */
function TerrainFuelLayer({ terrain, bounds }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!terrain?.fuel || !bounds) return;

    const GRID_SIZE = terrain.fuel.length;
    const latStep = (bounds.north - bounds.south) / GRID_SIZE;
    const lonStep = (bounds.east - bounds.west) / GRID_SIZE;
    const group = L.layerGroup();

    // Fuel type color mapping
    const fuelColors = {
      11: null,        // Water - skip
      12: null,        // Ice - skip
      21: '#888888',   // Developed Open - gray
      22: '#666666',   // Developed Low
      23: '#555555',   // Developed Med
      24: '#444444',   // Developed High
      31: '#c4a882',   // Barren - tan
      41: '#2d8a4e',   // Deciduous Forest - light green
      42: '#1a5c2e',   // Evergreen Forest - dark green
      43: '#247a3e',   // Mixed Forest - medium green
      51: '#8b7355',   // Dwarf Scrub - brown
      52: '#a0855c',   // Shrub/Scrub - light brown (chaparral)
      71: '#b8cc3c',   // Grassland - yellow-green
      72: '#8fa03c',   // Sedge
      81: '#c4cc6c',   // Pasture - pale yellow
      82: '#ddd06c',   // Cultivated - yellow
      90: '#3a7a5c',   // Woody Wetlands - teal
      95: '#4a8a6c',   // Herbaceous Wetlands
    };

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        const code = terrain.fuel[i][j];
        const color = fuelColors[code];
        if (!color) continue;

        const lat = bounds.north - (i + 0.5) * latStep;
        const lon = bounds.west + (j + 0.5) * lonStep;
        const rect = L.rectangle(
          [[lat - latStep / 2, lon - lonStep / 2], [lat + latStep / 2, lon + lonStep / 2]],
          {
            color: 'transparent',
            fillColor: color,
            fillOpacity: 0.15,
            weight: 0,
          }
        );
        group.addLayer(rect);
      }
    }

    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
    };
  }, [terrain, bounds, map]);

  return null;
}

function FireLayer({ fireGrid, bounds, terrain }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!fireGrid || !bounds) return;

    const GRID_SIZE = fireGrid.length;
    const latStep = (bounds.north - bounds.south) / GRID_SIZE;
    const lonStep = (bounds.east - bounds.west) / GRID_SIZE;
    const group = L.layerGroup();

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (fireGrid[i][j] === 2) {
          const lat = bounds.north - (i + 0.5) * latStep;
          const lon = bounds.west + (j + 0.5) * lonStep;

          // Color intensity based on fuel burn intensity
          const burnIntensity = terrain?.fuelProps?.[i]?.[j]?.burnIntensity || 0.5;
          const red = Math.round(200 + 55 * burnIntensity);
          const green = Math.round(60 * (1 - burnIntensity));
          const fillColor = `rgb(${red}, ${green}, 0)`;
          const fillOpacity = 0.3 + 0.4 * burnIntensity;

          const rect = L.rectangle(
            [[lat - latStep / 2, lon - lonStep / 2], [lat + latStep / 2, lon + lonStep / 2]],
            { color: 'transparent', fillColor, fillOpacity, weight: 0 }
          );
          group.addLayer(rect);
        }
      }
    }

    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
    };
  }, [fireGrid, bounds, terrain, map]);

  return null;
}

/** Interpolate between two [lat,lng] points */
function lerp(from, to, t) {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
  ];
}

function animateMarkerAlongPath(marker, from, to, durationMs, onDone) {
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / durationMs, 1);
    const pos = lerp(from, to, t);
    marker.setLatLng(pos);
    if (t < 1) {
      requestAnimationFrame(step);
    } else if (onDone) {
      onDone();
    }
  }
  requestAnimationFrame(step);
}

function ResponseLayer({ plan, animationPhase }) {
  const map = useMap();
  const layerRef = useRef(null);
  const animFrameRef = useRef([]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!plan || animationPhase < 1) return;

    const group = L.layerGroup();

    // Phase 1: Firetrucks animate from stations to fire
    if (animationPhase >= 1) {
      (plan.firetruck_deployments || []).forEach((dep, idx) => {
        if (!dep.from_station || !dep.to_position) return;

        // Trail line (appears immediately, faint)
        group.addLayer(L.polyline(
          [dep.from_station, dep.to_position],
          { color: '#ef4444', weight: 2, opacity: 0.3, dashArray: '6 4' }
        ));

        // Animated firetruck icon
        const icon = L.divIcon({
          className: 'animated-vehicle',
          html: '<div class="vehicle-icon firetruck-icon">🚒</div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker(dep.from_station, { icon, zIndexOffset: 1000 });
        group.addLayer(marker);

        // Animate with staggered start
        setTimeout(() => {
          animateMarkerAlongPath(marker, dep.from_station, dep.to_position, 1200, () => {
            // Arrived — show pulsing circle at destination
            const pulse = L.circleMarker(dep.to_position, {
              radius: 8, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.6,
              weight: 2, className: 'pulse-marker',
            });
            pulse.bindTooltip(dep.task || 'Firetruck deployed', { permanent: false });
            group.addLayer(pulse);
          });
        }, idx * 200);
      });
    }

    // Phase 2: Evacuation zones expand + people moving along routes
    if (animationPhase >= 2) {
      (plan.evacuation_zones || []).forEach(zone => {
        if (!zone.center) return;
        group.addLayer(L.circle(zone.center, {
          radius: zone.radius_meters || 2000,
          color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.1,
          weight: 2, dashArray: '4 4', className: 'evac-zone-expand',
        }));
      });

      (plan.evacuation_routes || []).forEach((route, idx) => {
        if (!route.from || !route.to) return;

        // Route line
        group.addLayer(L.polyline([route.from, route.to], {
          color: '#22c55e', weight: 3, opacity: 0.6,
        }));

        // Animated people dots moving along route
        for (let p = 0; p < 3; p++) {
          const dot = L.circleMarker(route.from, {
            radius: 3, color: '#4ade80', fillColor: '#4ade80', fillOpacity: 0.9, weight: 0,
          });
          group.addLayer(dot);

          setTimeout(() => {
            animateMarkerAlongPath(dot, route.from, route.to, 1500);
          }, idx * 150 + p * 250);
        }

        // Arrow at destination
        group.addLayer(L.circleMarker(route.to, {
          radius: 5, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 0,
        }));
      });
    }

    // Phase 3: Police cars animate + ambulances to hospitals
    if (animationPhase >= 3) {
      (plan.police_deployments || []).forEach((dep, idx) => {
        if (!dep.to_position) return;

        if (dep.from_station) {
          group.addLayer(L.polyline([dep.from_station, dep.to_position], {
            color: '#3b82f6', weight: 1.5, opacity: 0.3, dashArray: '4 4',
          }));

          const icon = L.divIcon({
            className: 'animated-vehicle',
            html: '<div class="vehicle-icon police-icon">🚔</div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });
          const marker = L.marker(dep.from_station, { icon, zIndexOffset: 1000 });
          group.addLayer(marker);

          setTimeout(() => {
            animateMarkerAlongPath(marker, dep.from_station, dep.to_position, 1000, () => {
              const pulse = L.circleMarker(dep.to_position, {
                radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.6,
                weight: 2, className: 'pulse-marker',
              });
              pulse.bindTooltip(dep.task || 'Police deployed', { permanent: false });
              group.addLayer(pulse);
            });
          }, idx * 150);
        } else {
          const pulse = L.circleMarker(dep.to_position, {
            radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.8, weight: 2,
          });
          pulse.bindTooltip(dep.task || 'Police', { permanent: false });
          group.addLayer(pulse);
        }
      });

      (plan.hospital_assignments || []).forEach((hosp, idx) => {
        if (!hosp.hospital) return;

        // Ambulance icon at hospital
        const icon = L.divIcon({
          className: 'animated-vehicle',
          html: '<div class="vehicle-icon ambulance-icon">🚑</div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker(hosp.hospital, { icon, zIndexOffset: 900 });
        group.addLayer(marker);

        const circle = L.circleMarker(hosp.hospital, {
          radius: 12, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.15,
          weight: 2, className: 'pulse-marker',
        });
        circle.bindTooltip(
          `${hosp.name || 'Hospital'}: ${hosp.role || 'Triage'} (${hosp.capacity_pct || '?'}%)`,
          { permanent: false }
        );
        group.addLayer(circle);
      });
    }

    // Phase 4: Shelters appear with people arriving
    if (animationPhase >= 4) {
      (plan.shelter_locations || []).forEach((shelter, idx) => {
        if (!shelter.position) return;

        const icon = L.divIcon({
          className: 'animated-vehicle',
          html: `<div class="vehicle-icon shelter-icon">⛺ <span style="font-size:11px;color:#fbbf24;font-weight:bold;">${shelter.capacity || '?'}</span></div>`,
          iconSize: [40, 24],
          iconAnchor: [20, 12],
        });
        group.addLayer(L.marker(shelter.position, { icon, zIndexOffset: 800 }));

        // Pulsing ring around shelter
        group.addLayer(L.circle(shelter.position, {
          radius: 500,
          color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.05,
          weight: 1, className: 'pulse-marker',
        }));
      });
    }

    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
    };
  }, [plan, animationPhase, map]);

  return null;
}

export default function MapView({
  center,
  zoom,
  bounds,
  houses,
  trees,
  infrastructure,
  fireGrid,
  plan,
  animationPhase,
  onMapClick,
  flat,
  activeFires,
  terrain,
}) {
  return (
    <div className={`map-wrapper ${flat ? 'flat' : ''}`}>
      <div className="map-inner">
        <MapContainer
          center={center || [36.7783, -119.4179]}
          zoom={zoom || 7}
          className="map-container"
          preferCanvas={true}
          zoomControl={true}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
            maxZoom={18}
          />
          <MapController center={center} zoom={zoom} onMapClick={onMapClick} />

          {/* Terrain fuel overlay (subtle) */}
          <TerrainFuelLayer terrain={terrain} bounds={bounds} />

          {/* Houses */}
          {(houses || []).map((h, i) => (
            <CircleMarker
              key={`h-${i}`}
              center={[h.lat, h.lon]}
              radius={3}
              pathOptions={{ color: '#d4a574', fillColor: '#d4a574', fillOpacity: 0.7, weight: 0 }}
            />
          ))}

          {/* Trees */}
          {(trees || []).map((t, i) => (
            <CircleMarker
              key={`t-${i}`}
              center={[t.lat, t.lon]}
              radius={2}
              pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.4, weight: 0 }}
            />
          ))}

          <InfrastructureMarkers infrastructure={infrastructure} />
          <ActiveFiresLayer activeFires={activeFires} />
          <FireLayer fireGrid={fireGrid} bounds={bounds} terrain={terrain} />
          <ResponseLayer plan={plan} animationPhase={animationPhase} />
        </MapContainer>
      </div>
    </div>
  );
}
