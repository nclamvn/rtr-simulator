import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLES = {
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  bright: "https://tiles.openfreemap.org/styles/bright",
  positron: "https://tiles.openfreemap.org/styles/positron",
};

// Convert meter offset from origin → GPS coords
function metersToGPS(x, y, centerLng, centerLat) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);
  return [centerLng + x / mPerDegLng, centerLat + y / mPerDegLat];
}

function dronesToGeoJSON(drones, center) {
  return {
    type: "FeatureCollection",
    features: drones.map(d => {
      const [lng, lat] = metersToGPS(d.fd.x, d.fd.y, center[0], center[1]);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { id: d.id, color: d.spec.color, iff: d.spec.iff, hdg: d.fd.hdg, alt: Math.round(d.fd.alt), speed: d.fd.speed.toFixed(1), battery: Math.round(d.fd.battery) },
      };
    }),
  };
}

function threatsToGeoJSON(threats, center) {
  const features = [];
  for (const t of threats) {
    const [cx, cy] = metersToGPS(t.x, t.y, center[0], center[1]);
    // Approximate circle with 32 points
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const [px, py] = metersToGPS(t.x + Math.cos(a) * t.radius, t.y + Math.sin(a) * t.radius, center[0], center[1]);
      pts.push([px, py]);
    }
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [pts] },
      properties: { type: t.type, radius: t.radius },
    });
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cx, cy] },
      properties: { label: t.type },
    });
  }
  return { type: "FeatureCollection", features };
}

function waypointsToGeoJSON(waypoints, center) {
  return {
    type: "FeatureCollection",
    features: waypoints.map((w, i) => {
      const [lng, lat] = metersToGPS(w.x, w.y, center[0], center[1]);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { idx: i, alt: w.alt || 150, label: w.label || "" },
      };
    }),
  };
}

function trailsToGeoJSON(drones, center) {
  const features = [];
  for (const d of drones) {
    if (d.trail.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: d.trail.map(p => metersToGPS(p.x, p.y, center[0], center[1])),
      },
      properties: { color: d.spec.color },
    });
  }
  return { type: "FeatureCollection", features };
}

export default function MapView({ drones, threats, waypoints, selectedId, onSelect, mission, T, victims }) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const sourcesReady = useRef(false);
  const droneRef = useRef(drones);
  const threatRef = useRef(threats);
  const wpRef = useRef(waypoints);
  const selRef = useRef(selectedId);

  useEffect(() => { droneRef.current = drones; }, [drones]);
  useEffect(() => { threatRef.current = threats; }, [threats]);
  useEffect(() => { wpRef.current = waypoints; }, [waypoints]);
  useEffect(() => { selRef.current = selectedId; }, [selectedId]);

  const center = mission?.center || [106.6, 17.47];

  // Init map once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: STYLES.liberty,
      center: center,
      zoom: 12,
      pitch: 55,
      bearing: -15,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      // Terrain
      map.addSource("terrain", {
        type: "raster-dem",
        url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
        tileSize: 256,
      });
      map.setTerrain({ source: "terrain", exaggeration: 1.5 });

      // Drone trails source + layer
      map.addSource("trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "trail-lines", type: "line", source: "trails", paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.4 } });

      // Threat zones
      map.addSource("threats", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "threat-fill", type: "fill", source: "threats", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#ff2020", "fill-opacity": 0.12 } });
      map.addLayer({ id: "threat-border", type: "line", source: "threats", filter: ["==", "$type", "Polygon"], paint: { "line-color": "#ff4040", "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.6 } });
      map.addLayer({ id: "threat-labels", type: "symbol", source: "threats", filter: ["has", "label"], layout: { "text-field": ["get", "label"], "text-size": 12, "text-offset": [0, -1.5] }, paint: { "text-color": "#ff4040", "text-halo-color": "#000", "text-halo-width": 1 } });

      // Waypoints
      map.addSource("waypoints", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "wp-markers", type: "circle", source: "waypoints", paint: { "circle-radius": 6, "circle-color": "#00aaff", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff", "circle-opacity": 0.7 } });

      // Drone markers
      map.addSource("drones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "drone-glow", type: "circle", source: "drones", paint: { "circle-radius": 14, "circle-color": ["get", "color"], "circle-opacity": 0.15, "circle-blur": 1 } });
      map.addLayer({ id: "drone-markers", type: "circle", source: "drones", paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-width": 2, "circle-stroke-color": ["case", ["==", ["get", "iff"], "HOSTILE"], "#ff3b5c", "#ffffff"], "circle-opacity": 0.95 } });
      map.addLayer({ id: "drone-labels", type: "symbol", source: "drones", layout: { "text-field": ["concat", ["get", "id"], " ", ["get", "alt"], "m"], "text-size": 10, "text-offset": [0, 1.8], "text-font": ["Open Sans Regular"] }, paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1 } });

      // Victim markers (triage)
      map.addSource("victims", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "victim-glow", type: "circle", source: "victims", paint: { "circle-radius": ["case", ["==", ["get", "priority"], 1], 18, ["==", ["get", "priority"], 2], 14, 10], "circle-color": ["get", "color"], "circle-opacity": 0.2, "circle-blur": 0.8 } });
      map.addLayer({ id: "victim-markers", type: "circle", source: "victims", paint: { "circle-radius": ["case", ["==", ["get", "priority"], 1], 10, ["==", ["get", "priority"], 2], 7, 5], "circle-color": ["get", "color"], "circle-stroke-width": ["case", ["==", ["get", "priority"], 1], 3, 1.5], "circle-stroke-color": "#ffffff", "circle-opacity": 0.95 } });
      map.addLayer({ id: "victim-labels", type: "symbol", source: "victims", layout: { "text-field": ["concat", ["get", "name"], "\n", ["get", "people"], " người — ", ["get", "priorityLabel"]], "text-size": 11, "text-offset": [0, 2.5], "text-anchor": "top", "text-font": ["Open Sans Regular"] }, paint: { "text-color": ["get", "color"], "text-halo-color": "#000000", "text-halo-width": 1.5 } });

      // Waypoint labels
      map.addLayer({ id: "wp-labels", type: "symbol", source: "waypoints", layout: { "text-field": ["get", "label"], "text-size": 10, "text-offset": [0, 1.8], "text-anchor": "top", "text-font": ["Open Sans Regular"] }, paint: { "text-color": "#00e5ff", "text-halo-color": "#000000", "text-halo-width": 1 } });

      sourcesReady.current = true;
    });

    // Click drone
    map.on("click", "drone-markers", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id && onSelect) onSelect(id);
    });
    map.on("mouseenter", "drone-markers", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "drone-markers", () => { map.getCanvas().style.cursor = ""; });

    mapInst.current = map;
    return () => map.remove();
  }, []);

  // Fly to mission center
  useEffect(() => {
    if (mapInst.current && mission?.center) {
      mapInst.current.flyTo({ center: mission.center, zoom: mission.zoom || 12, pitch: 55, duration: 2000 });
    }
  }, [mission?.id]);

  // Update GeoJSON data every render tick
  useEffect(() => {
    const map = mapInst.current;
    if (!map || !sourcesReady.current) return;
    const iv = setInterval(() => {
      const dr = droneRef.current;
      const th = threatRef.current;
      const wp = wpRef.current;
      const c = center;
      try {
        map.getSource("drones")?.setData(dronesToGeoJSON(dr, c));
        map.getSource("trails")?.setData(trailsToGeoJSON(dr, c));
        map.getSource("threats")?.setData(threatsToGeoJSON(th, c));
        map.getSource("waypoints")?.setData(waypointsToGeoJSON(wp, c));
        // Victim markers (static — from mission data)
        const vic = mission?.victims;
        if (vic && map.getSource("victims")) {
          map.getSource("victims").setData({
            type: "FeatureCollection",
            features: vic.map(v => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: v.pos },
              properties: { name: v.name, people: v.people, priority: v.priority, priorityLabel: v.priorityLabel, color: v.color, detail: v.detail },
            })),
          });
        }
      } catch {}
    }, 100);
    return () => clearInterval(iv);
  }, [center]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden" }} />;
}
