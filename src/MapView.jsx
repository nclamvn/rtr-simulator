import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Esri World Imagery — free, no API key
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    esri: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 18, attribution: "Esri, Maxar" },
    terrain: { type: "raster-dem", url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json", tileSize: 256 },
  },
  layers: [{ id: "satellite", type: "raster", source: "esri" }],
  terrain: { source: "terrain", exaggeration: 1.5 },
};

function metersToGPS(x, y, cLng, cLat) {
  const mLat = 111320, mLng = 111320 * Math.cos(cLat * Math.PI / 180);
  return [cLng + x / mLng, cLat + y / mLat];
}

function threatsToGeoJSON(threats, center) {
  const features = [];
  for (const t of threats) {
    const [cx, cy] = metersToGPS(t.x, t.y, center[0], center[1]);
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const dlng = (t.radius * Math.cos(a)) / (111320 * Math.cos(cy * Math.PI / 180));
      const dlat = (t.radius * Math.sin(a)) / 111320;
      pts.push([cx + dlng, cy + dlat]);
    }
    features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: { type: t.type } });
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [cx, cy] }, properties: { label: t.type } });
  }
  return { type: "FeatureCollection", features };
}

function trailsToGeoJSON(drones, center) {
  const features = [];
  for (const d of drones) {
    if (d.trail.length < 2) continue;
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: d.trail.map(p => metersToGPS(p.x, p.y, center[0], center[1])) }, properties: { color: d.spec.color } });
  }
  return { type: "FeatureCollection", features };
}

function flightPathGeoJSON(waypoints, center) {
  if (waypoints.length < 2) return { type: "FeatureCollection", features: [] };
  return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: waypoints.map(w => metersToGPS(w.x, w.y, center[0], center[1])) }, properties: {} }] };
}

export default function MapView({ drones, threats, waypoints, selectedId, onSelect, mission, victims }) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const sourcesReady = useRef(false);
  const droneRef = useRef(drones);
  const threatRef = useRef(threats);
  const wpRef = useRef(waypoints);
  const droneMarkersRef = useRef(new Map());
  const victimMarkersRef = useRef([]);

  useEffect(() => { droneRef.current = drones; }, [drones]);
  useEffect(() => { threatRef.current = threats; }, [threats]);
  useEffect(() => { wpRef.current = waypoints; }, [waypoints]);

  const center = mission?.center || [109.253, 12.752];

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: SATELLITE_STYLE,
      center,
      zoom: mission?.zoom || 13,
      pitch: 50,
      bearing: -15,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("terrain-dem", { type: "raster-dem", url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json", tileSize: 256 });
      try { map.setTerrain({ source: "terrain-dem", exaggeration: 1.5 }); } catch {}

      // Trails
      map.addSource("trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "trail-lines", type: "line", source: "trails", paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.5 } });

      // Flight path
      map.addSource("flightpath", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "fp-line", type: "line", source: "flightpath", paint: { "line-color": "#00e5ff", "line-width": 2, "line-dasharray": [4, 4], "line-opacity": 0.6 } });

      // Threats
      map.addSource("threats", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "threat-fill", type: "fill", source: "threats", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#ff2040", "fill-opacity": 0.18 } });
      map.addLayer({ id: "threat-border", type: "line", source: "threats", filter: ["==", "$type", "Polygon"], paint: { "line-color": "#ff2040", "line-width": 2.5, "line-dasharray": [4, 3], "line-opacity": 0.7 } });
      map.addLayer({ id: "threat-labels", type: "symbol", source: "threats", filter: ["has", "label"], layout: { "text-field": ["get", "label"], "text-size": 13, "text-offset": [0, 0], "text-font": ["Open Sans Bold"] }, paint: { "text-color": "#ffffff", "text-halo-color": "#ff2040", "text-halo-width": 2 } });

      sourcesReady.current = true;
    });

    mapInst.current = map;
    return () => { map.remove(); droneMarkersRef.current.forEach(m => m.remove()); droneMarkersRef.current.clear(); };
  }, []);

  // Fly to mission
  useEffect(() => {
    if (mapInst.current && mission?.center) {
      mapInst.current.flyTo({ center: mission.center, zoom: mission.zoom || 13, pitch: 50, duration: 2000 });
    }
  }, [mission?.id]);

  // Victim HTML markers
  useEffect(() => {
    victimMarkersRef.current.forEach(m => m.remove());
    victimMarkersRef.current = [];
    if (!mapInst.current || !victims) return;
    for (const v of victims) {
      const el = document.createElement("div");
      el.className = `victim-marker victim-p${v.priority}`;
      el.innerHTML = `<span>${v.priority === 1 ? "🔴" : v.priority === 2 ? "🟠" : "🟢"} ${v.people} người</span><br/><small>${v.name}</small>`;
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(v.pos).addTo(mapInst.current);
      victimMarkersRef.current.push(marker);
    }
  }, [victims, mission?.id]);

  // Update loop
  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    const iv = setInterval(() => {
      const dr = droneRef.current;
      const th = threatRef.current;
      const wp = wpRef.current;
      const c = center;

      // Update/create HTML drone markers
      const activeIds = new Set();
      for (const d of dr) {
        if (d.status === "ELIMINATED") continue;
        activeIds.add(d.id);
        const [lng, lat] = metersToGPS(d.fd.x, d.fd.y, c[0], c[1]);
        let marker = droneMarkersRef.current.get(d.id);
        if (!marker) {
          const el = document.createElement("div");
          el.className = "drone-marker";
          el.innerHTML = `<div class="drone-body" style="background:${d.spec.color};border-color:${d.spec.iff === "HOSTILE" ? "#ff3b5c" : "#fff"}"><div class="drone-arrow"></div></div><div class="drone-pulse" style="border-color:${d.spec.color}"></div><div class="drone-label">${d.id}<br/>${Math.round(d.fd.alt)}m</div>`;
          el.onclick = () => onSelect?.(d.id);
          marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
          droneMarkersRef.current.set(d.id, marker);
        }
        marker.setLngLat([lng, lat]);
        const arrow = marker.getElement().querySelector(".drone-arrow");
        if (arrow) arrow.style.transform = `rotate(${d.fd.hdg}deg)`;
        const lbl = marker.getElement().querySelector(".drone-label");
        if (lbl) lbl.innerHTML = `${d.id}<br/>${Math.round(d.fd.alt)}m`;
      }
      // Remove old markers
      for (const [id, m] of droneMarkersRef.current) { if (!activeIds.has(id)) { m.remove(); droneMarkersRef.current.delete(id); } }

      // GeoJSON layers
      if (sourcesReady.current) {
        try {
          map.getSource("trails")?.setData(trailsToGeoJSON(dr, c));
          map.getSource("threats")?.setData(threatsToGeoJSON(th, c));
          map.getSource("flightpath")?.setData(flightPathGeoJSON(wp, c));
        } catch {}
      }
    }, 100);
    return () => clearInterval(iv);
  }, [center]);

  return <>
    <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
    <style>{`
      .drone-marker { position:relative; width:44px; height:44px; cursor:pointer; }
      .drone-body { width:18px; height:18px; border-radius:50%; position:absolute; top:13px; left:13px; border:2.5px solid #fff; z-index:2; box-shadow:0 0 12px rgba(0,229,255,0.6); }
      .drone-arrow { width:0; height:0; border-left:5px solid transparent; border-right:5px solid transparent; border-bottom:14px solid #fff; position:absolute; top:-12px; left:4px; transform-origin:center 17px; filter:drop-shadow(0 0 2px rgba(0,0,0,0.8)); }
      .drone-pulse { position:absolute; top:2px; left:2px; width:40px; height:40px; border-radius:50%; border:2px solid; opacity:0; animation:dronePulse 2s infinite; }
      .drone-label { position:absolute; top:46px; left:50%; transform:translateX(-50%); font:bold 13px 'JetBrains Mono',monospace; color:#fff; text-shadow:0 0 6px #000,0 0 12px #000; white-space:nowrap; text-align:center; z-index:3; line-height:1.5; }
      @keyframes dronePulse { 0%{transform:scale(0.5);opacity:0.8} 100%{transform:scale(2.2);opacity:0} }
      .victim-marker { padding:6px 12px; border-radius:8px; font:bold 14px 'JetBrains Mono',monospace; color:#fff; text-shadow:0 0 4px #000; border:2px solid rgba(255,255,255,0.8); cursor:pointer; white-space:nowrap; text-align:center; line-height:1.5; backdrop-filter:blur(4px); }
      .victim-marker small { font-size:12px; font-weight:400; opacity:0.9; }
      .victim-p1 { background:rgba(255,32,64,0.85); animation:victimPulse 1.2s infinite; }
      .victim-p2 { background:rgba(255,140,0,0.8); }
      .victim-p3 { background:rgba(0,170,85,0.75); }
      @keyframes victimPulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,32,64,0.7)} 50%{box-shadow:0 0 0 14px rgba(255,32,64,0)} }
    `}</style>
  </>;
}
