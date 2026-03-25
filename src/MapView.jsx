import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const SATELLITE_STYLE = {
  version: 8,
  sources: {
    esri: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 18, attribution: "Esri, Maxar" },
    terrain: { type: "raster-dem", url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json", tileSize: 256 },
  },
  layers: [{ id: "satellite", type: "raster", source: "esri" }],
  terrain: { source: "terrain", exaggeration: 1.5 },
};

function m2gps(x, y, cLng, cLat) {
  const mLat = 111320, mLng = 111320 * Math.cos(cLat * Math.PI / 180);
  return [cLng + x / mLng, cLat + y / mLat];
}

function dronesToGJ(drones, c) {
  return { type: "FeatureCollection", features: drones.map(d => {
    const [lng, lat] = m2gps(d.fd.x, d.fd.y, c[0], c[1]);
    return { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { id: d.id, color: d.spec.color, iff: d.spec.iff, hdg: d.fd.hdg, alt: Math.round(d.fd.alt), label: `${d.id}\n${Math.round(d.fd.alt)}m` } };
  }) };
}

function threatsToGJ(threats, c) {
  const f = [];
  for (const t of threats) {
    const [cx, cy] = m2gps(t.x, t.y, c[0], c[1]);
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      pts.push([cx + (t.radius * Math.cos(a)) / (111320 * Math.cos(cy * Math.PI / 180)), cy + (t.radius * Math.sin(a)) / 111320]);
    }
    f.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: { type: t.type } });
    f.push({ type: "Feature", geometry: { type: "Point", coordinates: [cx, cy] }, properties: { label: t.type } });
  }
  return { type: "FeatureCollection", features: f };
}

function trailsToGJ(drones, c) {
  return { type: "FeatureCollection", features: drones.filter(d => d.trail.length >= 2).map(d => ({
    type: "Feature", geometry: { type: "LineString", coordinates: d.trail.map(p => m2gps(p.x, p.y, c[0], c[1])) }, properties: { color: d.spec.color },
  })) };
}

function fpToGJ(wp, c) {
  if (wp.length < 2) return { type: "FeatureCollection", features: [] };
  return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: wp.map(w => m2gps(w.x, w.y, c[0], c[1])) }, properties: {} }] };
}

function victimsToGJ(victims) {
  if (!victims) return { type: "FeatureCollection", features: [] };
  return { type: "FeatureCollection", features: victims.map(v => ({
    type: "Feature", geometry: { type: "Point", coordinates: v.pos },
    properties: { name: v.name, people: v.people, priority: v.priority, priorityLabel: v.priorityLabel, color: v.color, label: `${v.priority === 1 ? "🔴" : v.priority === 2 ? "🟠" : "🟢"} ${v.people} người\n${v.name}` },
  })) };
}

export default function MapView({ drones, threats, waypoints, selectedId, onSelect, mission, victims }) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const ready = useRef(false);
  const dRef = useRef(drones), tRef = useRef(threats), wRef = useRef(waypoints);
  useEffect(() => { dRef.current = drones; }, [drones]);
  useEffect(() => { tRef.current = threats; }, [threats]);
  useEffect(() => { wRef.current = waypoints; }, [waypoints]);

  const center = mission?.center || [109.253, 12.752];

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapRef.current, style: SATELLITE_STYLE,
      center, zoom: mission?.zoom || 13, pitch: 50, bearing: -15, attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      try { map.addSource("terrain-dem", { type: "raster-dem", url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json", tileSize: 256 }); map.setTerrain({ source: "terrain-dem", exaggeration: 1.5 }); } catch {}

      // Trails
      map.addSource("trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "trail-lines", type: "line", source: "trails", paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.5 } });

      // Flight path
      map.addSource("fp", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "fp-line", type: "line", source: "fp", paint: { "line-color": "#00e5ff", "line-width": 2, "line-dasharray": [4, 4], "line-opacity": 0.6 } });

      // Threats
      map.addSource("threats", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "threat-fill", type: "fill", source: "threats", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#ff2040", "fill-opacity": 0.18 } });
      map.addLayer({ id: "threat-border", type: "line", source: "threats", filter: ["==", "$type", "Polygon"], paint: { "line-color": "#ff2040", "line-width": 2.5, "line-dasharray": [4, 3], "line-opacity": 0.7 } });
      map.addLayer({ id: "threat-labels", type: "symbol", source: "threats", filter: ["has", "label"], layout: { "text-field": ["get", "label"], "text-size": 13, "text-font": ["Open Sans Bold"] }, paint: { "text-color": "#fff", "text-halo-color": "#ff2040", "text-halo-width": 2 } });

      // Victims
      map.addSource("victims", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "victim-glow", type: "circle", source: "victims", paint: { "circle-radius": ["case", ["==", ["get", "priority"], 1], 20, ["==", ["get", "priority"], 2], 15, 10], "circle-color": ["get", "color"], "circle-opacity": 0.25, "circle-blur": 0.6 } });
      map.addLayer({ id: "victim-dot", type: "circle", source: "victims", paint: { "circle-radius": ["case", ["==", ["get", "priority"], 1], 10, ["==", ["get", "priority"], 2], 7, 5], "circle-color": ["get", "color"], "circle-stroke-width": 2.5, "circle-stroke-color": "#fff" } });
      map.addLayer({ id: "victim-labels", type: "symbol", source: "victims", layout: { "text-field": ["get", "label"], "text-size": 13, "text-offset": [0, 2.5], "text-anchor": "top", "text-font": ["Open Sans Bold"] }, paint: { "text-color": ["get", "color"], "text-halo-color": "#000", "text-halo-width": 1.5 } });

      // Drones — GeoJSON circles that scale with map
      map.addSource("drones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "drone-glow", type: "circle", source: "drones", paint: { "circle-radius": 16, "circle-color": ["get", "color"], "circle-opacity": 0.2, "circle-blur": 0.8 } });
      map.addLayer({ id: "drone-dot", type: "circle", source: "drones", paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-width": 2.5, "circle-stroke-color": ["case", ["==", ["get", "iff"], "HOSTILE"], "#ff3b5c", "#ffffff"] } });
      map.addLayer({ id: "drone-labels", type: "symbol", source: "drones", layout: { "text-field": ["get", "label"], "text-size": 12, "text-offset": [0, 2], "text-anchor": "top", "text-font": ["Open Sans Bold"] }, paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.5 } });

      ready.current = true;
    });

    map.on("click", "drone-dot", (e) => { const id = e.features?.[0]?.properties?.id; if (id && onSelect) onSelect(id); });
    map.on("mouseenter", "drone-dot", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "drone-dot", () => { map.getCanvas().style.cursor = ""; });

    mapInst.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    if (mapInst.current && mission?.center) mapInst.current.flyTo({ center: mission.center, zoom: mission.zoom || 13, pitch: 50, duration: 2000 });
  }, [mission?.id]);

  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    const iv = setInterval(() => {
      if (!ready.current) return;
      const c = center;
      try {
        map.getSource("drones")?.setData(dronesToGJ(dRef.current, c));
        map.getSource("trails")?.setData(trailsToGJ(dRef.current, c));
        map.getSource("threats")?.setData(threatsToGJ(tRef.current, c));
        map.getSource("fp")?.setData(fpToGJ(wRef.current, c));
        map.getSource("victims")?.setData(victimsToGJ(victims));
      } catch {}
    }, 100);
    return () => clearInterval(iv);
  }, [center, victims]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%" }} />;
}
