'use client';

import { useEffect, useRef, useCallback } from 'react';
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
    // Clear previous markers
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    if (!infrastructure) return;

    const addMarkers = (items, type, emoji, className) => {
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

    addMarkers(infrastructure.fire_stations, 'fire', '\u{1F6A8}', 'fire-station');
    addMarkers(infrastructure.hospitals, 'hospital', '\u{1F3E5}', 'hospital');
    addMarkers(infrastructure.police_stations, 'police', '\u{1F46E}', 'police');

    return () => {
      markersRef.current.forEach(m => map.removeLayer(m));
      markersRef.current = [];
    };
  }, [infrastructure, map]);

  return null;
}

function FireLayer({ fireGrid, bounds }) {
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
          const rect = L.rectangle(
            [[lat - latStep / 2, lon - lonStep / 2], [lat + latStep / 2, lon + lonStep / 2]],
            {
              color: 'transparent',
              fillColor: '#ef4444',
              fillOpacity: 0.4,
              weight: 0,
            }
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
  }, [fireGrid, bounds, map]);

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

    // Phase 1: Firetruck deployments
    if (animationPhase >= 1) {
      (plan.firetruck_deployments || []).forEach(dep => {
        if (dep.from_station && dep.to_position) {
          const line = L.polyline(
            [dep.from_station, dep.to_position],
            { color: '#ef4444', weight: 2, opacity: 0.7, dashArray: '6 4' }
          );
          group.addLayer(line);
          const marker = L.circleMarker(dep.to_position, {
            radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9, weight: 2,
          });
          marker.bindTooltip(dep.task || 'Firetruck', { permanent: false });
          group.addLayer(marker);
        }
      });
    }

    // Phase 2: Evacuation zones and routes
    if (animationPhase >= 2) {
      (plan.evacuation_zones || []).forEach(zone => {
        if (zone.center) {
          const circle = L.circle(zone.center, {
            radius: zone.radius_meters || 2000,
            color: '#22c55e',
            fillColor: '#22c55e',
            fillOpacity: 0.1,
            weight: 2,
            dashArray: '4 4',
          });
          group.addLayer(circle);
        }
      });

      (plan.evacuation_routes || []).forEach(route => {
        if (route.from && route.to) {
          const line = L.polyline([route.from, route.to], {
            color: '#22c55e',
            weight: 3,
            opacity: 0.8,
          });
          group.addLayer(line);
          // Arrow at end
          const arrow = L.circleMarker(route.to, {
            radius: 4, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 0,
          });
          group.addLayer(arrow);
        }
      });
    }

    // Phase 3: Police + ambulances
    if (animationPhase >= 3) {
      (plan.police_deployments || []).forEach(dep => {
        if (dep.to_position) {
          const marker = L.circleMarker(dep.to_position, {
            radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 2,
          });
          marker.bindTooltip(dep.task || 'Police', { permanent: false });
          group.addLayer(marker);

          if (dep.from_station) {
            const line = L.polyline([dep.from_station, dep.to_position], {
              color: '#3b82f6', weight: 1.5, opacity: 0.5, dashArray: '4 4',
            });
            group.addLayer(line);
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

    // Phase 4: Shelters
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
          <FireLayer fireGrid={fireGrid} bounds={bounds} />
          <ResponseLayer plan={plan} animationPhase={animationPhase} />
        </MapContainer>
      </div>
    </div>
  );
}
