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

function ResponseLayer({ plan, animationPhase }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!plan || animationPhase < 1) return;

    const group = L.layerGroup();

    if (animationPhase >= 1) {
      (plan.firetruck_deployments || []).forEach(dep => {
        if (dep.from_station && dep.to_position) {
          group.addLayer(L.polyline(
            [dep.from_station, dep.to_position],
            { color: '#ef4444', weight: 2, opacity: 0.7, dashArray: '6 4' }
          ));
          const marker = L.circleMarker(dep.to_position, {
            radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9, weight: 2,
          });
          marker.bindTooltip(dep.task || 'Firetruck', { permanent: false });
          group.addLayer(marker);
        }
      });
    }

    if (animationPhase >= 2) {
      (plan.evacuation_zones || []).forEach(zone => {
        if (zone.center) {
          group.addLayer(L.circle(zone.center, {
            radius: zone.radius_meters || 2000,
            color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.1, weight: 2, dashArray: '4 4',
          }));
        }
      });

      (plan.evacuation_routes || []).forEach(route => {
        if (route.from && route.to) {
          group.addLayer(L.polyline([route.from, route.to], {
            color: '#22c55e', weight: 3, opacity: 0.8,
          }));
          group.addLayer(L.circleMarker(route.to, {
            radius: 4, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 0,
          }));
        }
      });
    }

    if (animationPhase >= 3) {
      (plan.police_deployments || []).forEach(dep => {
        if (dep.to_position) {
          const marker = L.circleMarker(dep.to_position, {
            radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 2,
          });
          marker.bindTooltip(dep.task || 'Police', { permanent: false });
          group.addLayer(marker);
          if (dep.from_station) {
            group.addLayer(L.polyline([dep.from_station, dep.to_position], {
              color: '#3b82f6', weight: 1.5, opacity: 0.5, dashArray: '4 4',
            }));
          }
        }
      });

      (plan.hospital_assignments || []).forEach(hosp => {
        if (hosp.hospital) {
          const circle = L.circleMarker(hosp.hospital, {
            radius: 10, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.2, weight: 2,
          });
          circle.bindTooltip(`${hosp.name || 'Hospital'}: ${hosp.role || 'Triage'}`, { permanent: false });
          group.addLayer(circle);
        }
      });
    }

    if (animationPhase >= 4) {
      (plan.shelter_locations || []).forEach(shelter => {
        if (shelter.position) {
          const icon = L.divIcon({
            className: '',
            html: `<div style="background:rgba(245,158,11,0.9);color:#000;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;white-space:nowrap;">Shelter (${shelter.capacity || '?'})</div>`,
            iconSize: [0, 0],
          });
          group.addLayer(L.marker(shelter.position, { icon }));
        }
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
