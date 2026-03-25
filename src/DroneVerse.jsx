import { useState, useEffect, useRef, useCallback } from "react";
import {
  Radar, Radio, Battery, Signal, Navigation, Target, AlertTriangle,
  Play, Pause, RotateCcw, Crosshair, Zap, Shield, Plane,
  Cpu, Gauge, Activity, Layers, Clock, Users, Box, ArrowUpRight,
  BarChart3, Compass, Maximize2, Eye, MapPin, FileText, Plus, Copy, X,
  Wind, UserPlus, Home, Shuffle, CircleDot, Film, Volume2, CheckCircle, Circle,
  Brain, GitBranch, Sun, Moon, HeartPulse, ShieldPlus, Anchor,
} from "lucide-react";
import { XAxis, YAxis, ResponsiveContainer, Area, AreaChart } from "recharts";
import MapView from "./MapView.jsx";
import { PI2, DEG, VI, THEMES, DRONE_SPECS, gpsToM, compassLabel } from "./droneverse/constants.js";
import { callAI } from "./droneverse/api.js";
import { FlightDynamics } from "./droneverse/FlightDynamics.js";
import { SwarmController } from "./droneverse/SwarmController.js";
import { KnowledgeGraph } from "./droneverse/KnowledgeGraph.js";
import { EmergenceDetector } from "./droneverse/EmergenceDetector.js";
import { MissionPhaseEngine } from "./droneverse/MissionPhaseEngine.js";
import { MISSIONS } from "./droneverse/missions.js";
import { ErrorBoundary } from "./droneverse/ErrorBoundary.jsx";

// Constants, classes, and missions imported from ./droneverse/*



// ═══════════════════════════════════════════
// RADAR PPI — phosphor persistence effect
// ═══════════════════════════════════════════
function RadarPPI({ drones, threats, waypoints, radarRange, selectedId, onSelect, onAddWaypoint, wind, graphOverlay, kg, radarTheme }) {
  const cvRef = useRef(null);
  const swRef = useRef(0);
  const cRef = useRef(new Map());

  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const S = cv.width, cx = S / 2, cy = S / 2, R = S / 2 - 28;
    let raf, last = performance.now();
    const draw = (now) => {
      const dt = (now - last) / 1000; last = now;
      swRef.current = (swRef.current + 24 * dt) % 360;
      const sw = swRef.current * DEG;

      const RT = radarTheme || THEMES.dark.radar;
      ctx.fillStyle = RT.overlay; ctx.fillRect(0, 0, S, S);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R + 2, 0, PI2); ctx.clip();

      for (let i = 1; i <= 5; i++) {
        const r = (R / 5) * i;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI2);
        ctx.strokeStyle = `rgba(${RT.ring},${i === 5 ? 0.45 : 0.18})`; ctx.lineWidth = i === 5 ? 1.5 : 0.7; ctx.stroke();
        ctx.fillStyle = `rgba(${RT.text},0.5)`; ctx.font = "10px monospace"; ctx.textAlign = "center";
        ctx.fillText(`${Math.round((radarRange / 5) * i)}`, cx, cy - r + 12);
      }
      for (let deg = 0; deg < 360; deg += 10) {
        const a = deg * DEG - Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (deg % 30 === 0 ? R - 8 : R - 4), cy + Math.sin(a) * (deg % 30 === 0 ? R - 8 : R - 4));
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.strokeStyle = deg % 30 === 0 ? `rgba(${RT.ring},0.45)` : `rgba(${RT.ring},0.18)`; ctx.lineWidth = 0.5; ctx.stroke();
        if (deg % 90 === 0) {
          ctx.fillStyle = `rgba(${RT.text},0.8)`; ctx.font = "bold 11px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText({ 0: "N", 90: "E", 180: "S", 270: "W" }[deg], cx + Math.cos(a) * (R + 15), cy + Math.sin(a) * (R + 15));
        }
      }
      ctx.strokeStyle = `rgba(${RT.ring},0.12)`; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();

      // Graph overlay
      if (graphOverlay && kg) {
        // Sector grid (4x4, 200m each, centered on origin)
        ctx.strokeStyle = "rgba(0,180,80,0.04)"; ctx.lineWidth = 0.5; ctx.setLineDash([4, 4]);
        for (let i = 1; i < 4; i++) {
          const gx = cx + ((i * 200 - 400) / radarRange) * R;
          ctx.beginPath(); ctx.moveTo(gx, cy - R); ctx.lineTo(gx, cy + R); ctx.stroke();
          const gy = cy - ((i * 200 - 400) / radarRange) * R;
          ctx.beginPath(); ctx.moveTo(cx - R, gy); ctx.lineTo(cx + R, gy); ctx.stroke();
        }
        ctx.setLineDash([]);
        // Visited sectors: green tint
        const sectors = kg.query("sector");
        for (const s of sectors) {
          if (!s.data.visitCount) continue;
          const sx1 = cx + (s.data.x / radarRange) * R, sy1 = cy - ((s.data.y + 200) / radarRange) * R;
          const sw2 = (200 / radarRange) * R, sh2 = (200 / radarRange) * R;
          ctx.fillStyle = `rgba(0,180,80,${Math.min(0.08, s.data.visitCount * 0.002)})`;
          ctx.fillRect(sx1, sy1 - sh2, sw2, sh2);
        }
        // Proximity edges
        const proxEdges = kg.edges.filter(e => e.relation === "proximity");
        for (const e of proxEdges) {
          const d1 = drones.find(d => d.id === e.from), d2 = drones.find(d => d.id === e.to);
          if (!d1 || !d2) continue;
          const x1 = cx + (d1.fd.x / radarRange) * R, y1 = cy - (d1.fd.y / radarRange) * R;
          const x2 = cx + (d2.fd.x / radarRange) * R, y2 = cy - (d2.fd.y / radarRange) * R;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
          ctx.strokeStyle = "rgba(0,200,255,0.15)"; ctx.lineWidth = 0.5; ctx.stroke();
        }
        // Detected edges (drone → threat)
        const detEdges = kg.edges.filter(e => e.relation === "detected");
        const shown = new Set();
        for (const e of detEdges) {
          const key = `${e.from}-${e.to}`;
          if (shown.has(key)) continue; shown.add(key);
          const d1 = drones.find(d => d.id === e.from), tn = kg.nodes.get(e.to);
          if (!d1 || !tn) continue;
          const x1 = cx + (d1.fd.x / radarRange) * R, y1 = cy - (d1.fd.y / radarRange) * R;
          const x2 = cx + (tn.data.x / radarRange) * R, y2 = cy - (tn.data.y / radarRange) * R;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
          ctx.strokeStyle = "rgba(255,60,60,0.2)"; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
        }
      }

      // Sweep fan + line
      ctx.save(); ctx.translate(cx, cy);
      const sa = sw - Math.PI / 2;
      const g = ctx.createConicGradient(sa - 0.35, 0, 0);
      g.addColorStop(0, `rgba(${RT.sweep},0)`); g.addColorStop(0.85, `rgba(${RT.sweep},0.1)`); g.addColorStop(1, `rgba(${RT.sweep},0.25)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, sa - 0.35, sa); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(sa) * R, Math.sin(sa) * R);
      ctx.strokeStyle = `rgba(${RT.sweep},1.0)`; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();

      // Detect
      for (const d of drones) {
        const rng = Math.sqrt(d.fd.x * d.fd.x + d.fd.y * d.fd.y);
        if (rng > radarRange) continue;
        const brg = (Math.atan2(d.fd.x, d.fd.y) / DEG + 360) % 360;
        if (Math.abs(((swRef.current - brg + 540) % 360) - 180) < 3)
          cRef.current.set(d.id, { brg, rng, iff: d.spec.iff, id: d.id, last: now, sx: cx + (d.fd.x / radarRange) * R, sy: cy - (d.fd.y / radarRange) * R, spd: d.fd.speed, alt: d.fd.alt, hdg: d.fd.hdg });
      }
      // Waypoints
      for (const wp of waypoints) {
        const wx = cx + (wp.x / radarRange) * R, wy = cy - (wp.y / radarRange) * R;
        if (Math.hypot(wx - cx, wy - cy) > R) continue;
        ctx.save(); ctx.translate(wx, wy); ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = "rgba(0,200,255,0.6)"; ctx.lineWidth = 1; ctx.strokeRect(-3, -3, 6, 6); ctx.restore();
      }
      // Threats
      for (const t of threats) {
        const tx = cx + (t.x / radarRange) * R, ty = cy - (t.y / radarRange) * R, tr = (t.radius / radarRange) * R;
        ctx.beginPath(); ctx.arc(tx, ty, tr, 0, PI2); ctx.fillStyle = "rgba(255,40,40,0.1)"; ctx.fill();
        ctx.strokeStyle = `rgba(255,60,60,${0.35 + Math.sin(now * 0.004) * 0.15})`; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,100,100,0.75)"; ctx.font = "bold 8px monospace"; ctx.textAlign = "center"; ctx.fillText(t.type, tx, ty - tr - 4);
      }
      // Blips
      for (const [id, c] of cRef.current) {
        const fade = Math.max(0, 1 - (now - c.last) / 1000 / (360 / 24));
        if (fade <= 0) { cRef.current.delete(id); continue; }
        const sel = id === selectedId, sz = sel ? 5 : 3;
        const rgb = c.iff === "HOSTILE" ? RT.blipHostile : RT.blipFriendly;
        ctx.beginPath(); ctx.arc(c.sx, c.sy, sz, 0, PI2); ctx.fillStyle = `rgba(${rgb},${fade})`; ctx.fill();
        ctx.beginPath(); ctx.arc(c.sx, c.sy, sz + 4, 0, PI2); ctx.strokeStyle = `rgba(${rgb},${fade * 0.45})`; ctx.lineWidth = 1; ctx.stroke();
        if (fade > 0.3) {
          const vr = c.hdg * DEG, vl = 12 + c.spd * 0.4;
          ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(c.sx + Math.sin(vr) * vl, c.sy - Math.cos(vr) * vl);
          ctx.strokeStyle = `rgba(${rgb},${fade * 0.9})`; ctx.lineWidth = 1; ctx.stroke();
        }
        if (fade > 0.4) {
          ctx.fillStyle = `rgba(${rgb},${Math.min(1, fade * 1.1)})`; ctx.font = `${sel ? "bold " : ""}9px monospace`; ctx.textAlign = "left";
          ctx.fillText(c.id, c.sx + 10, c.sy - 4);
          ctx.font = "8px monospace"; ctx.fillStyle = `rgba(0,255,140,${fade * 0.8})`;
          ctx.fillText(`${Math.round(c.alt)}m ${c.spd.toFixed(0)}m/s`, c.sx + 10, c.sy + 8);
        }
        if (sel) {
          const b = 14, g2 = 5; ctx.strokeStyle = `rgba(0,255,200,${0.5 + Math.sin(now * 0.005) * 0.3})`; ctx.lineWidth = 1.5;
          [[c.sx-b,c.sy-b+g2,c.sx-b,c.sy-b,c.sx-b+g2,c.sy-b],[c.sx+b-g2,c.sy-b,c.sx+b,c.sy-b,c.sx+b,c.sy-b+g2],[c.sx-b,c.sy+b-g2,c.sx-b,c.sy+b,c.sx-b+g2,c.sy+b],[c.sx+b-g2,c.sy+b,c.sx+b,c.sy+b,c.sx+b,c.sy+b-g2]].forEach(p=>{ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(p[2],p[3]);ctx.lineTo(p[4],p[5]);ctx.stroke();});
        }
      }
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, PI2); ctx.fillStyle = "rgba(0,255,200,0.7)"; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, PI2); ctx.strokeStyle = "rgba(0,255,200,0.2)"; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, R + 2, 0, PI2); ctx.strokeStyle = "rgba(0,220,100,0.4)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = `rgba(${RT.text},0.6)`; ctx.font = "10px monospace";
      ctx.textAlign = "left"; ctx.fillText(`RNG ${radarRange}m`, 8, S - 22); ctx.fillText(`SWP ${Math.round(swRef.current)}°`, 8, S - 10);
      ctx.textAlign = "right"; ctx.fillText(`TGT ${cRef.current.size}`, S - 8, S - 22); ctx.fillText(`THR ${threats.length}`, S - 8, S - 10);
      // Wind indicator
      if (wind && wind.speed > 0) {
        const wix = S - 45, wiy = 45;
        const wrad = wind.dir * DEG;
        const wlen = Math.min(25, 8 + wind.speed);
        ctx.save(); ctx.translate(wix, wiy); ctx.rotate(wrad);
        ctx.beginPath(); ctx.moveTo(0, -wlen); ctx.lineTo(0, wlen);
        ctx.strokeStyle = "rgba(100,200,255,0.7)"; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, wlen); ctx.lineTo(-4, wlen - 6); ctx.moveTo(0, wlen); ctx.lineTo(4, wlen - 6);
        ctx.stroke(); ctx.restore();
        ctx.fillStyle = "rgba(100,200,255,0.6)"; ctx.font = "bold 8px monospace"; ctx.textAlign = "center";
        ctx.fillText(`WIND ${wind.speed}m/s`, wix, wiy + wlen + 12);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [drones, threats, waypoints, radarRange, selectedId, wind, graphOverlay, kg]);

  return <canvas ref={cvRef} width={440} height={440} onClick={(e) => {
    const r = e.target.getBoundingClientRect(), sc = 440 / r.width;
    const mx = (e.clientX - r.left) * sc, my = (e.clientY - r.top) * sc;
    let best = null, bd = 20;
    for (const [id, c] of cRef.current) { const d = Math.hypot(c.sx - mx, c.sy - my); if (d < bd) { best = id; bd = d; } }
    onSelect(best);
  }} onContextMenu={(e) => {
    e.preventDefault();
    const r = e.target.getBoundingClientRect(), sc = 440 / r.width;
    const S = 440, cx = S / 2, cy = S / 2, R = S / 2 - 28;
    const mx = (e.clientX - r.left) * sc, my = (e.clientY - r.top) * sc;
    const wx = Math.round((mx - cx) / R * radarRange);
    const wy = Math.round(-(my - cy) / R * radarRange);
    if (onAddWaypoint) onAddWaypoint(wx, wy);
  }} style={{ width: "100%", aspectRatio: "1/1", cursor: "crosshair", borderRadius: 8 }} />;
}

// ═══════════════════════════════════════════
// 3D VIEWPORT — cinematic upgrade
// ═══════════════════════════════════════════
function Viewport3D({ drones, threats, waypoints, selectedId, camMode, windSpd, threeTheme, T }) {
  const mountRef = useRef(null);
  const dRef = useRef(drones); const tRef = useRef(threats); const wRef = useRef(waypoints);
  const sRef = useRef(selectedId); const cmRef = useRef(camMode || "orbit"); const wsRef = useRef(windSpd || 0);
  const objsRef = useRef(new Map()); const trailsRef = useRef(new Map()); const tmpRef = useRef([]);
  const exhaustRef = useRef(new Map()); const threatPartRef = useRef(new Map());
  const burstRef = useRef(new Map()); const alertedRef = useRef(new Set());
  const audioRef = useRef({ prop: 0, wind: 0, alert: 0 });
  const sceneRef = useRef(null); const ttRef = useRef(threeTheme);
  const themeObjsRef = useRef({}); // scene objects that need theme updates
  useEffect(() => {
    ttRef.current = threeTheme;
    const s = sceneRef.current; const to = themeObjsRef.current;
    if (s && threeTheme) {
      s.background.set(threeTheme.clearColor);
      if (s.fog) s.fog.color.set(threeTheme.clearColor);
      const isLight = threeTheme.clearColor === 0xd8e0e8;
      if (to.ambLight) { to.ambLight.color.set(threeTheme.ambient); to.ambLight.intensity = isLight ? 1.2 : 0.5; }
      if (to.terrain) to.terrain.material.color.set(threeTheme.terrain);
      if (to.groundGlow) to.groundGlow.material.color.set(threeTheme.ground);
      if (to.starMat) to.starMat.opacity = threeTheme.clearColor === 0x070e1a ? 0.45 : 0.05;
    }
  }, [threeTheme]);
  useEffect(() => { dRef.current = drones; }, [drones]);
  useEffect(() => { tRef.current = threats; }, [threats]);
  useEffect(() => { wRef.current = waypoints; }, [waypoints]);
  useEffect(() => { sRef.current = selectedId; }, [selectedId]);
  useEffect(() => { cmRef.current = camMode || "orbit"; }, [camMode]);
  useEffect(() => { wsRef.current = windSpd || 0; }, [windSpd]);

  useEffect(() => {
    const m = mountRef.current; if (!m) return;
    const T = window.THREE; if (!T) return;
    const w = m.clientWidth, h = m.clientHeight;
    const tt = ttRef.current || THEMES.dark.three;
    const scene = new T.Scene();
    scene.fog = new T.FogExp2(tt.clearColor, 0.0004);
    scene.background = new T.Color(tt.clearColor);
    sceneRef.current = scene;
    const cam = new T.PerspectiveCamera(55, w / h, 1, 5000); cam.position.set(0, 500, 350);
    const ren = new T.WebGLRenderer({ antialias: true, alpha: true });
    ren.setSize(w, h); ren.setPixelRatio(Math.min(devicePixelRatio, 2));
    ren.toneMapping = T.ACESFilmicToneMapping; ren.toneMappingExposure = 1.2;
    m.appendChild(ren.domElement);

    // Enhanced lighting
    const ambLight = new T.AmbientLight(tt.ambient, 0.5);
    scene.add(ambLight); themeObjsRef.current.ambLight = ambLight;
    scene.add(new T.HemisphereLight(0x0a1a3a, 0x000000, 0.4));
    const dl = new T.DirectionalLight(0xaaddff, 0.8); dl.position.set(300, 500, 200); scene.add(dl);
    const cpl = new T.PointLight(0x00ffcc, 0.6, 1400); scene.add(cpl);

    // SPEC-F: Star field
    const starCount = 200;
    const starGeo = new T.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starSz = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * PI2, phi = Math.acos(Math.random() * 0.6 + 0.4);
      const r = 1500 + Math.random() * 500;
      starPos[i*3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i*3+1] = r * Math.cos(phi);
      starPos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
      starSz[i] = 0.5 + Math.random() * 0.5;
    }
    starGeo.setAttribute("position", new T.BufferAttribute(starPos, 3));
    starGeo.setAttribute("size", new T.BufferAttribute(starSz, 1));
    const starMat = new T.PointsMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, size: 1.5, sizeAttenuation: true });
    scene.add(new T.Points(starGeo, starMat)); themeObjsRef.current.starMat = starMat;

    // SPEC-F: Ground glow plane
    const gndGlow = new T.Mesh(new T.PlaneGeometry(2000, 2000), new T.MeshBasicMaterial({ color: tt.ground, transparent: true, opacity: 0.3 }));
    gndGlow.rotation.x = -Math.PI / 2; gndGlow.position.y = -1; scene.add(gndGlow);
    themeObjsRef.current.groundGlow = gndGlow;

    // Grid + terrain
    const grid = new T.GridHelper(1600, 40, tt.grid1, tt.grid2);
    scene.add(grid); themeObjsRef.current.grid = grid;
    const tg = new T.PlaneGeometry(1600, 1600, 80, 80); tg.rotateX(-Math.PI / 2);
    const vt = tg.attributes.position;
    for (let i = 0; i < vt.count; i++) { const px = vt.getX(i), pz = vt.getZ(i); vt.setY(i, Math.sin(px * 0.005) * Math.cos(pz * 0.004) * 18 + Math.sin(px * 0.012 + pz * 0.008) * 10); }
    tg.computeVertexNormals();
    const terrainMat = new T.MeshPhongMaterial({ color: tt.terrain, transparent: true, opacity: 0.6, flatShading: true });
    const terrainMesh = new T.Mesh(tg, terrainMat);
    scene.add(terrainMesh); themeObjsRef.current.terrain = terrainMesh;

    // Beacon
    const beacon = new T.Mesh(new T.CylinderGeometry(4, 4, 3, 8), new T.MeshPhongMaterial({ color: 0x00ffaa, emissive: 0x00aa66 }));
    beacon.position.y = 1.5; scene.add(beacon);
    const bRing = new T.Mesh(new T.RingGeometry(6, 8, 32), new T.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.3, side: T.DoubleSide }));
    bRing.rotation.x = -Math.PI / 2; bRing.position.y = 0.5; scene.add(bRing);

    // SPEC-D: Build drone model
    function buildDroneModel(color, iff) {
      const g = new T.Group();
      const bodyCol = 0x2a2a30;
      const canopyCol = iff === "HOSTILE" ? 0xff3040 : new T.Color(color).getHex();
      // Body
      g.add(new T.Mesh(new T.BoxGeometry(4, 1.5, 6), new T.MeshPhongMaterial({ color: bodyCol, emissive: 0x111115 })));
      // Canopy
      const canopyMat = new T.MeshPhongMaterial({ color: canopyCol, emissive: canopyCol, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
      const canopy = new T.Mesh(new T.SphereGeometry(1.5, 8, 6, 0, PI2, 0, Math.PI / 2), canopyMat);
      canopy.position.y = 0.75; canopy.name = "canopy";
      g.add(canopy);
      // Arms + rotors
      const armMat = new T.MeshPhongMaterial({ color: bodyCol });
      const rotorMat = new T.MeshBasicMaterial({ color: canopyCol, transparent: true, opacity: 0.5, side: T.DoubleSide });
      const armOffsets = [[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1]];
      g.userData.rotors = [];
      for (const [ax,,az] of armOffsets) {
        const arm = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 5.5, 6), armMat);
        arm.rotation.z = Math.PI / 2; arm.rotation.y = Math.atan2(ax, az);
        arm.position.set(ax * 2.8, 0.2, az * 2.8);
        g.add(arm);
        const rotor = new T.Mesh(new T.RingGeometry(1.8, 2.3, 12), rotorMat);
        rotor.rotation.x = -Math.PI / 2;
        rotor.position.set(ax * 5, 0.5, az * 5);
        g.add(rotor);
        g.userData.rotors.push(rotor);
      }
      // Landing gear
      const gearMat = new T.MeshPhongMaterial({ color: 0x444450 });
      for (const xo of [-1.5, 1.5]) {
        const gear = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 2, 6), gearMat);
        gear.position.set(xo, -1.5, 0); g.add(gear);
      }
      // Point light (SPEC-A enhanced)
      g.add(new T.PointLight(new T.Color(color).getHex(), 0.6, 80));
      return g;
    }

    // Camera state
    let ang = 0; const clk = new T.Clock(); let raf; const SC = 0.8;
    const camTarget = new T.Vector3(0, 40, 0);
    const camPos = new T.Vector3(0, 300, 350);
    let cinIdx = 0, cinTimer = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clk.getDelta(), 0.05); ang += dt * 0.12;
      const cd = dRef.current, ct = tRef.current, cw = wRef.current, cs = sRef.current;
      const mode = cmRef.current;

      // SPEC-C: Camera modes
      const selDrone = cd.find(dd => dd.id === cs);
      let tgtPos = new T.Vector3(0, 40, 0);
      let tgtCam = new T.Vector3(Math.sin(ang) * 450, 300 + Math.sin(ang * 0.4) * 60, Math.cos(ang) * 350);

      if (mode === "chase" && selDrone) {
        const dp = new T.Vector3(selDrone.fd.x * SC, selDrone.fd.alt * 0.3, -selDrone.fd.y * SC);
        const hRad = -selDrone.fd.hdg * DEG;
        tgtCam.set(dp.x - Math.sin(hRad) * 50, dp.y + 30, dp.z - Math.cos(hRad) * 50);
        tgtPos.copy(dp);
      } else if (mode === "topdown") {
        tgtCam.set(0, 800, 0.1);
        tgtPos.set(0, 0, 0);
      } else if (mode === "cinematic" && cd.length > 0) {
        cinTimer += dt;
        if (cinTimer > 5) { cinTimer = 0; cinIdx = (cinIdx + 1) % cd.length; }
        const td = cd[cinIdx % cd.length];
        const dp = new T.Vector3(td.fd.x * SC, td.fd.alt * 0.3, -td.fd.y * SC);
        const cOff = new T.Vector3(80 * Math.sin(ang * 0.3), 60 + 40 * Math.sin(ang * 0.5), 80 * Math.cos(ang * 0.3));
        tgtCam.copy(dp).add(cOff);
        tgtPos.copy(dp);
      }
      // else orbit = default tgtCam already set

      camPos.lerp(tgtCam, mode === "orbit" ? 1 : 0.04);
      camTarget.lerp(tgtPos, mode === "orbit" ? 1 : 0.04);
      cam.position.copy(camPos);
      cam.lookAt(camTarget);

      // Update drones
      const ids = new Set();
      let totalSpeed = 0, alertLevel = 0;
      for (const d of cd) {
        ids.add(d.id);
        totalSpeed += d.fd.speed;
        let o = objsRef.current.get(d.id);
        if (!o) {
          o = buildDroneModel(d.spec.color, d.spec.iff);
          scene.add(o); objsRef.current.set(d.id, o);
        }
        const px = d.fd.x * SC, py = d.fd.alt * 0.3, pz = -d.fd.y * SC;
        o.position.set(px, py, pz);
        o.rotation.y = -d.fd.hdg * DEG; o.rotation.z = d.fd.bank * DEG * 0.5;
        o.scale.setScalar(d.id === cs ? 2.0 : 1.0);

        // SPEC-D: Rotor spin
        if (o.userData.rotors) {
          const rotSpd = 2 + (d.fd.speed / d.spec.maxSpeed) * 13;
          for (const r of o.userData.rotors) r.rotation.z += rotSpd * dt;
        }
        // SPEC-D: Selected canopy pulse
        const canopy = o.getObjectByName("canopy");
        if (canopy && d.id === cs) {
          canopy.material.emissiveIntensity = 0.3 + Math.sin(ang * 6) * 0.25;
        } else if (canopy) {
          canopy.material.emissiveIntensity = 0.5;
        }

        // SPEC-B1: Exhaust particles
        let exh = exhaustRef.current.get(d.id);
        if (!exh) {
          const N = 15;
          const eGeo = new T.BufferGeometry();
          const ePos = new Float32Array(N * 3);
          const eCol = new Float32Array(N * 4);
          eGeo.setAttribute("position", new T.BufferAttribute(ePos, 3));
          eGeo.setAttribute("color", new T.BufferAttribute(eCol, 4));
          const eMat = new T.PointsMaterial({ size: 2, transparent: true, opacity: 0.8, vertexColors: true, sizeAttenuation: true, depthWrite: false, blending: T.AdditiveBlending });
          const pts = new T.Points(eGeo, eMat);
          pts.frustumCulled = false;
          scene.add(pts);
          exh = { pts, positions: Array.from({length: N}, () => [px, py, pz]), idx: 0 };
          exhaustRef.current.set(d.id, exh);
        }
        exh.positions[exh.idx] = [px, py - 0.5, pz];
        exh.idx = (exh.idx + 1) % exh.positions.length;
        const ep = exh.pts.geometry.attributes.position.array;
        const ec = exh.pts.geometry.attributes.color.array;
        const dc = new T.Color(d.spec.color);
        for (let i = 0; i < exh.positions.length; i++) {
          const ri = (exh.idx + i) % exh.positions.length;
          const fade = i / exh.positions.length;
          ep[i*3] = exh.positions[ri][0]; ep[i*3+1] = exh.positions[ri][1]; ep[i*3+2] = exh.positions[ri][2];
          ec[i*4] = dc.r; ec[i*4+1] = dc.g; ec[i*4+2] = dc.b; ec[i*4+3] = fade * 0.6;
        }
        exh.pts.geometry.attributes.position.needsUpdate = true;
        exh.pts.geometry.attributes.color.needsUpdate = true;

        // Trail line
        let tl = trailsRef.current.get(d.id); if (tl) scene.remove(tl);
        if (d.trail.length > 2) {
          const pts2 = d.trail.map(p => new T.Vector3(p.x * SC, d.fd.alt * 0.3 - 1, -p.y * SC));
          const ln = new T.Line(new T.BufferGeometry().setFromPoints(pts2), new T.LineBasicMaterial({ color: new T.Color(d.spec.color), transparent: true, opacity: 0.25 }));
          scene.add(ln); trailsRef.current.set(d.id, ln);
        }

        // SPEC-B3: Alert burst on threat entry
        for (const t of ct) {
          const td2 = Math.hypot(d.fd.x - t.x, d.fd.y - t.y);
          const key = `${d.id}-${t.x}-${t.y}`;
          if (td2 < t.radius && !alertedRef.current.has(key)) {
            alertedRef.current.add(key);
            alertLevel = 1;
            const bGeo = new T.BufferGeometry();
            const bPos = new Float32Array(10 * 3);
            for (let bi = 0; bi < 10; bi++) {
              bPos[bi*3] = px; bPos[bi*3+1] = py; bPos[bi*3+2] = pz;
            }
            bGeo.setAttribute("position", new T.BufferAttribute(bPos, 3));
            const bPts = new T.Points(bGeo, new T.PointsMaterial({ color: 0xff4040, size: 3, transparent: true, opacity: 1, sizeAttenuation: true, depthWrite: false, blending: T.AdditiveBlending }));
            bPts.frustumCulled = false;
            scene.add(bPts);
            const vels = Array.from({length: 10}, () => [(Math.random()-0.5)*60, Math.random()*30, (Math.random()-0.5)*60]);
            burstRef.current.set(key, { pts: bPts, vels, age: 0, ox: px, oy: py, oz: pz });
          }
        }
      }

      // Audio levels
      audioRef.current.prop = cd.length > 0 ? Math.min(1, totalSpeed / (cd.length * 15)) : 0;
      audioRef.current.wind = Math.min(1, (wsRef.current || 0) / 25);
      audioRef.current.alert = Math.max(0, alertLevel, (audioRef.current.alert || 0) - dt * 0.5);

      // Cleanup removed drones
      for (const [id, o] of objsRef.current) {
        if (!ids.has(id)) {
          scene.remove(o); objsRef.current.delete(id);
          const tl = trailsRef.current.get(id); if (tl) { scene.remove(tl); trailsRef.current.delete(id); }
          const ex = exhaustRef.current.get(id); if (ex) { scene.remove(ex.pts); exhaustRef.current.delete(id); }
        }
      }

      // Update bursts
      for (const [key, b] of burstRef.current) {
        b.age += dt;
        if (b.age > 1) { scene.remove(b.pts); burstRef.current.delete(key); continue; }
        const bp = b.pts.geometry.attributes.position.array;
        for (let i = 0; i < 10; i++) {
          bp[i*3] = b.ox + b.vels[i][0] * b.age;
          bp[i*3+1] = b.oy + b.vels[i][1] * b.age;
          bp[i*3+2] = b.oz + b.vels[i][2] * b.age;
        }
        b.pts.geometry.attributes.position.needsUpdate = true;
        b.pts.material.opacity = 1 - b.age;
      }

      // Temporary objects (threats, waypoints)
      for (const x of tmpRef.current) scene.remove(x); tmpRef.current = [];

      // SPEC-B2: Threat zones + rising particles
      for (const t of ct) {
        const tx = t.x * SC, tz = -t.y * SC;
        const cy2 = new T.Mesh(new T.CylinderGeometry(t.radius * SC, t.radius * SC, 120, 16, 1, true), new T.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.08 + Math.sin(ang * 4) * 0.04, side: T.DoubleSide }));
        cy2.position.set(tx, 60, tz); scene.add(cy2); tmpRef.current.push(cy2);
        const rg = new T.Mesh(new T.RingGeometry(t.radius * SC - 2, t.radius * SC, 32), new T.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.15, side: T.DoubleSide }));
        rg.rotation.x = -Math.PI / 2; rg.position.set(tx, 0.5, tz); scene.add(rg); tmpRef.current.push(rg);
        // Rising particles
        const tKey = `${t.x}_${t.y}`;
        let tp = threatPartRef.current.get(tKey);
        if (!tp) {
          const N = 20;
          const pGeo = new T.BufferGeometry();
          const pPos = new Float32Array(N * 3);
          for (let i = 0; i < N; i++) {
            const a2 = Math.random() * PI2, r2 = Math.random() * t.radius * SC * 0.8;
            pPos[i*3] = tx + Math.cos(a2) * r2;
            pPos[i*3+1] = Math.random() * 120;
            pPos[i*3+2] = tz + Math.sin(a2) * r2;
          }
          pGeo.setAttribute("position", new T.BufferAttribute(pPos, 3));
          const pPts = new T.Points(pGeo, new T.PointsMaterial({ color: 0xff2020, size: 1.5, transparent: true, opacity: 0.2, sizeAttenuation: true, depthWrite: false, blending: T.AdditiveBlending }));
          pPts.frustumCulled = false;
          scene.add(pPts);
          tp = { pts: pPts, speeds: Array.from({length: N}, () => 0.5 + Math.random() * 1.5) };
          threatPartRef.current.set(tKey, tp);
        }
        const pp = tp.pts.geometry.attributes.position.array;
        for (let i = 0; i < tp.speeds.length; i++) {
          pp[i*3+1] += tp.speeds[i] * dt * 30;
          if (pp[i*3+1] > 120) {
            pp[i*3+1] = 0;
            const a2 = Math.random() * PI2, r2 = Math.random() * t.radius * SC * 0.8;
            pp[i*3] = tx + Math.cos(a2) * r2;
            pp[i*3+2] = tz + Math.sin(a2) * r2;
          }
        }
        tp.pts.geometry.attributes.position.needsUpdate = true;
      }
      // Clean up removed threat particles
      for (const [key, tp] of threatPartRef.current) {
        if (!ct.some(t => `${t.x}_${t.y}` === key)) { scene.remove(tp.pts); threatPartRef.current.delete(key); }
      }

      // Waypoints
      for (const wp of cw) {
        const wm = new T.Mesh(new T.OctahedronGeometry(4), new T.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.55, wireframe: true }));
        wm.position.set(wp.x * SC, (wp.alt || 150) * 0.3, -wp.y * SC); wm.rotation.y = ang * 2; scene.add(wm); tmpRef.current.push(wm);
        const vl = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(wp.x * SC, 0, -wp.y * SC), new T.Vector3(wp.x * SC, (wp.alt || 150) * 0.3, -wp.y * SC)]), new T.LineBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.25 }));
        scene.add(vl); tmpRef.current.push(vl);
      }

      bRing.scale.setScalar(1 + Math.sin(ang * 3) * 0.2);
      beacon.material.emissiveIntensity = 0.5 + Math.sin(ang * 4) * 0.3;
      ren.render(scene, cam);
    };
    animate();
    const onR = () => { const w2 = m.clientWidth, h2 = m.clientHeight; cam.aspect = w2 / h2; cam.updateProjectionMatrix(); ren.setSize(w2, h2); };
    window.addEventListener("resize", onR);
    return () => {
      window.removeEventListener("resize", onR); cancelAnimationFrame(raf);
      if (m.contains(ren.domElement)) m.removeChild(ren.domElement); ren.dispose();
      // Cleanup particles
      for (const [,ex] of exhaustRef.current) scene.remove(ex.pts); exhaustRef.current.clear();
      for (const [,tp] of threatPartRef.current) scene.remove(tp.pts); threatPartRef.current.clear();
      for (const [,b] of burstRef.current) scene.remove(b.pts); burstRef.current.clear();
      alertedRef.current.clear();
    };
  }, []);

  // SPEC-E: Audio indicator overlay
  const au = audioRef.current;
  return <div ref={mountRef} style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden", position: "relative" }}>
    <div style={{ position: "absolute", bottom: 8, left: 8, background: T.bgOverlay, borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 3, zIndex: 2 }}>
      {[["PROP", au.prop, "#00e5ff"], ["WIND", au.wind, "#00e878"], ["ALERT", au.alert, "#ff3b5c"]].map(([label, val, color]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Volume2 size={7} color={color} />
          <span style={{ color: T.textMuted, width: 28 }}>{label}</span>
          <div style={{ width: 60, height: 3, background: T.border, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${Math.round((val || 0) * 100)}%`, height: "100%", background: color, borderRadius: 2 }} />
          </div>
          <span style={{ color: T.textMuted, width: 22, textAlign: "right" }}>{Math.round((val || 0) * 100)}%</span>
        </div>
      ))}
    </div>
  </div>;
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════
export default function DroneVerse() {
  const swRef = useRef(new SwarmController());
  const [mis, setMis] = useState(null);
  const [run, setRun] = useState(false);
  const [sel, setSel] = useState(null);
  const [, setTick] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [logs, setLogs] = useState([]);
  const [rng, setRng] = useState(400);
  const [tel, setTel] = useState([]);
  const [vw, setVw] = useState("split");
  const [theme, setTheme] = useState("dark");
  const T = THEMES[theme];
  const [showReport, setShowReport] = useState(false);
  const [sideTab, setSideTab] = useState("fleet");
  const [camMode, setCamMode] = useState("orbit");
  const [windDir, setWindDir] = useState(0);
  const [windSpd, setWindSpd] = useState(0);
  const bogeyCounter = useRef(0);
  const phaseRef = useRef(null);
  const [phaseInfo, setPhaseInfo] = useState(null);
  const kgRef = useRef(null);
  const edRef = useRef(null);
  const tickRef = useRef(0);
  const [emergenceFeed, setEmergenceFeed] = useState([]);
  const [graphStats, setGraphStats] = useState(null);
  const [showGraphOverlay, setShowGraphOverlay] = useState(false);
  const [aiDebrief, setAiDebrief] = useState(null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [scenarioInput, setScenarioInput] = useState("");
  const [scenarioType, setScenarioType] = useState("Lũ lụt");
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [aiAdvice, setAiAdvice] = useState(null); // null | "loading" | string[]
  const [adviceCooldown, setAdviceCooldown] = useState(0);
  const [missionComplete, setMissionComplete] = useState(false); // { name, briefing, idx, total, objectives, status }

  const log = useCallback((m, l = "info") => setLogs(p => [{ m, l, t: Date.now() }, ...p].slice(0, 40)), []);

  const launch = useCallback((m) => {
    const s = new SwarmController();
    for (const d of m.drones) s.addDrone(d.id, d.type, d.x, d.y, d.alt, d.hdg);
    s.assignWaypoints([...m.waypoints]); s.setThreats([...m.threats]);
    // Per-drone waypoints for Light Show
    if (m.id === "lightshow") {
      m.drones.forEach((def, i) => {
        s.perDroneWP.set(def.id, {
          x: Math.round(180 * Math.cos(i * PI2 / 32)),
          y: Math.round(180 * Math.sin(i * PI2 / 32)),
          alt: 150,
        });
      });
    }
    // Elimination callback
    s.onEliminate = (hostileId, friendlyId) => {
      log(`KILL: ${hostileId} neutralized by ${friendlyId}`, "success");
    };
    // Escort Convoy: use cargo route as shared waypoints so cargo follows route, escorts orbit
    if (m.id === "escort" && m.phases && m.phases[0].cargoWP) {
      s.assignWaypoints([...m.phases[0].cargoWP]);
    }
    swRef.current = s; setMis({ ...m, threats: [...m.threats], waypoints: [...m.waypoints] });
    setRun(true); setElapsed(0); setSel(null); setTel([]);
    setWindDir(0); setWindSpd(0); bogeyCounter.current = 0; tickRef.current = 0;
    // Knowledge Graph init
    const kg = new KnowledgeGraph();
    for (const d of s.drones) kg.addNode(d.id, "drone", d.id, { typeKey: d.typeKey, iff: d.spec.iff });
    for (const t of s.threats) kg.addNode(`t-${t.x}-${t.y}`, "threat", t.type, { x: t.x, y: t.y, radius: t.radius });
    for (const w of s.waypoints) kg.addNode(`wp-${w.x}-${w.y}`, "waypoint", `WP(${w.x},${w.y})`, { x: w.x, y: w.y, alt: w.alt });
    for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < 4; gy++) {
      const label = String.fromCharCode(65 + gx) + (gy + 1);
      kg.addNode(`sec-${gx}-${gy}`, "sector", label, { x: gx * 200 - 400, y: gy * 200 - 400, visitCount: 0 });
    }
    kgRef.current = kg;
    edRef.current = new EmergenceDetector();
    setEmergenceFeed([]); setGraphStats(null); setAiDebrief(null); setShowAiModal(false); setShowGraphOverlay(false);
    // Phase engine
    if (m.phases) {
      const pe = new MissionPhaseEngine(m.phases);
      phaseRef.current = pe;
      const p0 = pe.getCurrentPhase();
      setPhaseInfo({ name: p0.name, briefing: p0.briefing, idx: 0, total: m.phases.length, objectives: p0.objectives || [], status: pe.objectiveStatus });
      log(`🚁 ${VI.phase} 1: ${p0.name} — ${p0.briefing}`, "success");
      if (p0.weather) { setWindDir(p0.weather.windDir); setWindSpd(p0.weather.windSpeed);
        const wx = Math.sin(p0.weather.windDir * DEG) * p0.weather.windSpeed;
        const wy = Math.cos(p0.weather.windDir * DEG) * p0.weather.windSpeed;
        for (const dd of s.drones) { dd.fd.windX = wx; dd.fd.windY = wy; } }
      // Emit phase 1 logs gradually
      const p1Logs = m.phaseLogs?.[1];
      if (p1Logs) p1Logs.forEach((msg, i) => setTimeout(() => setLogs(p => [{ m: msg, l: "info", t: Date.now() }, ...p].slice(0, 40)), (i + 1) * 2500));
    } else {
      phaseRef.current = null;
      setPhaseInfo(null);
    }
    log(`MISSION: ${m.name}`, "success"); log(`${m.drones.length} units — ${m.desc}`, "info");
    if (m.threats.length) log(`⚠️ ${m.threats.length} mối đe dọa phát hiện`, "warning");
  }, [log]);

  // Auto-demo: 1-click launch Lũ lụt QB + cinematic + weather
  const startDemo = useCallback(() => {
    const m = MISSIONS[0]; // Cứu hộ Tây Hoà — Kịch bản BQP
    launch(m);
    setTimeout(() => {
      setVw(m.center ? "map" : "split");
      setCamMode("cinematic"); setWindDir(90); setWindSpd(15);
      const wx = Math.sin(90 * DEG) * 15, wy = Math.cos(90 * DEG) * 15;
      for (const d of swRef.current.drones) { d.fd.windX = wx; d.fd.windY = wy; }
    }, 200);
  }, [launch]);

  // AI Scenario Generator
  const generateScenario = useCallback(async () => {
    setScenarioLoading(true);
    try {
      const prompt = `Bạn là chuyên gia tác chiến drone của Quân đội Nhân dân Việt Nam, chuyên về cứu hộ cứu nạn.\n\nTình huống: ${scenarioInput}\nLoại: ${scenarioType}\n\nTạo kịch bản mô phỏng dưới dạng JSON thuần (KHÔNG markdown, KHÔNG \`\`\`):\n{"missionName":"tên tiếng Việt","briefing":"mô tả 2 câu","domain":"RESCUE","phases":[{"name":"tên phase","briefing":"mô tả","drones":[{"id":"XX-1","type":"HERA-S","x":0,"y":-20,"alt":150,"hdg":0}],"waypoints":[{"x":200,"y":150,"alt":120}],"threats":[{"x":200,"y":150,"radius":80,"type":"Vùng ngập sâu"}],"objectives":["mục tiêu 1"],"transitionType":"time","transitionTime":20}]}\n\nQuy tắc: HERA-S trinh sát nhanh, HERA-C vận chuyển chậm, VEGA-X hộ tống. 3-4 phases. 8-16 drones. Origin (0,0) = sở chỉ huy. Vùng thiên tai 200-350m.`;
      let text = await callAI([{ role: "user", content: prompt }], 2000) || "";
      // Strip markdown code blocks if present
      text = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const scenario = JSON.parse(text);
      // Convert to mission format
      const drones = scenario.phases[0]?.drones || [{ id: "AI-1", type: "HERA-S", x: 0, y: -20, alt: 150, hdg: 0 }];
      const mission = {
        id: `ai-${Date.now()}`, name: scenario.missionName || "AI Mission", domain: scenario.domain || "RESCUE", icon: Brain, multi: true,
        desc: scenario.briefing || "Kịch bản AI", drones, waypoints: scenario.phases[0]?.waypoints || [], threats: scenario.phases[0]?.threats || [],
        phases: scenario.phases.map((p, i) => ({
          name: p.name, briefing: p.briefing,
          spawns: i > 0 ? (p.drones || []) : undefined,
          waypoints: i > 0 ? p.waypoints : undefined,
          threats: p.threats && i > 0 ? p.threats : undefined,
          weather: p.weather,
          objectives: (p.objectives || []).map((desc, j) => ({ id: `ai-obj-${i}-${j}`, desc, check: () => false })),
          transition: p.transitionType === "time" ? (pt) => pt > (p.transitionTime || 20) : (pt) => pt > 30,
        })),
      };
      setShowScenarioModal(false);
      launch(mission);
      setCamMode("cinematic");
    } catch (err) {
      log(`Lỗi tạo kịch bản: ${err.message}`, "warning");
    } finally {
      setScenarioLoading(false);
    }
  }, [scenarioInput, scenarioType, launch, log]);

  // AI Tactical Advisor
  const requestAdvice = useCallback(async () => {
    if (adviceCooldown > 0) return;
    setAiAdvice("loading");
    setAdviceCooldown(30);
    const cd = setInterval(() => setAdviceCooldown(c => { if (c <= 1) { clearInterval(cd); return 0; } return c - 1; }), 1000);
    try {
      const drones = swRef.current.drones.filter(d => d.status === "ACTIVE");
      const weakest = drones.filter(d => d.spec.iff === "FRIENDLY").sort((a, b) => a.fd.battery - b.fd.battery)[0];
      const pe = phaseRef.current;
      const prompt = `Bạn là cố vấn tác chiến drone QĐND Việt Nam.\n\nNhiệm vụ: ${mis?.name}\nPhase: ${pe ? `${pe.currentPhase+1}/${pe.phases.length} — ${pe.getCurrentPhase()?.name}` : "Đơn phase"}\nFleet: ${drones.filter(d=>d.spec.iff==="FRIENDLY").length} drone, ${drones.filter(d=>d.spec.iff==="HOSTILE").length} đối phương\nPin TB: ${Math.round(drones.reduce((s,d)=>s+d.fd.battery,0)/Math.max(1,drones.length))}%\nGió: ${windSpd}m/s\nĐe dọa: ${swRef.current.threats.map(t=>t.type).join(", ")||"Không"}\nDrone yếu nhất: ${weakest?`${weakest.id} (pin ${Math.round(weakest.fd.battery)}%)`:"N/A"}\n\n3 khuyến nghị chiến thuật ngắn (tiếng Việt). JSON: {"advice":["1","2","3"]}`;
      let text = await callAI([{ role: "user", content: prompt }], 500) || "{}";
      text = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(text);
      setAiAdvice(parsed.advice || ["Không có khuyến nghị"]);
      setTimeout(() => setAiAdvice(null), 10000);
    } catch {
      setAiAdvice(["Cố vấn AI không khả dụng — kiểm tra kết nối"]);
      setTimeout(() => setAiAdvice(null), 5000);
    }
  }, [mis, windSpd, adviceCooldown]);

  const addWaypoint = useCallback((wx, wy) => {
    const wp = { x: wx, y: wy, alt: 200 };
    swRef.current.waypoints.push(wp);
    if (mis) mis.waypoints = [...swRef.current.waypoints];
    setMis(m => m ? { ...m } : m);
    log(`WP ADDED: (${wx}, ${wy}) alt 200m`, "info");
  }, [mis, log]);

  const injectThreat = useCallback(() => {
    const types = ["SAM", "AAA", "RADAR", "JAMMER"];
    const type = types[Math.floor(Math.random() * types.length)];
    const x = Math.round(Math.random() * 300 - 150);
    const y = Math.round(Math.random() * 300 - 150);
    const radius = Math.round(60 + Math.random() * 40);
    const t = { x, y, radius, type };
    swRef.current.threats.push(t);
    if (mis) mis.threats = [...swRef.current.threats];
    setMis(m => m ? { ...m } : m);
    log(`THREAT INJECTED: ${type} at (${x}, ${y}) R:${radius}m`, "warning");
  }, [mis, log]);

  const generateReport = useCallback(() => {
    const drones = swRef.current.drones;
    const avg = (fn) => drones.length ? Math.round(drones.reduce((s, d) => s + fn(d), 0) / drones.length * 10) / 10 : 0;
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(Math.floor(elapsed % 60)).padStart(2, "0");
    const threats = swRef.current.threats;
    const wpTransits = drones.reduce((s, d) => s + d.wpIdx, 0);
    const friendly = drones.filter(d => d.spec.iff === "FRIENDLY").length;
    const hostile = drones.filter(d => d.spec.iff === "HOSTILE").length;
    return `═══ RTR DRONEVERSE — MISSION DEBRIEF ═══
Mission: ${mis?.name || "N/A"} [${mis?.domain || "N/A"}]
Elapsed: T+${mm}:${ss}
Status: ${run ? "IN PROGRESS" : "PAUSED"}

FLEET SUMMARY
  Total: ${drones.length} | Friendly: ${friendly} | Hostile: ${hostile}
  Avg Battery: ${avg(d => d.fd.battery)}% | Avg Signal: ${avg(d => d.fd.signal)}%
  Avg Altitude: ${avg(d => d.fd.alt)}m | Avg Speed: ${avg(d => d.fd.speed)}m/s

THREAT ENVIRONMENT
  Active Threats: ${threats.length}
${threats.map(t => `  ${t.type} at (${t.x}, ${t.y}) R:${t.radius}m`).join("\n") || "  None"}

NAVIGATION
  Waypoints in Route: ${swRef.current.waypoints.length}
  Total WP Transits: ${wpTransits}
${phaseRef.current ? `
PHASE PROGRESS
${phaseRef.current.phases.map((p, i) => {
  const status = i < phaseRef.current.currentPhase ? "COMPLETE" : i === phaseRef.current.currentPhase ? (phaseRef.current.completed ? "COMPLETE" : "IN PROGRESS") : "PENDING";
  const objCount = (p.objectives || []).length;
  const objDone = (p.objectives || []).filter(o => phaseRef.current.objectiveStatus[o.id]).length;
  return `  Phase ${i+1}: ${p.name} — ${status}${objCount > 0 ? ` (${objDone}/${objCount} objectives)` : ""}`;
}).join("\n")}` : ""}
${swRef.current.drones.filter(d=>d.status==="ELIMINATED").length > 0 ? `
COMBAT
  Eliminated: ${swRef.current.drones.filter(d=>d.status==="ELIMINATED").map(d=>d.id).join(", ")}` : ""}

═══ Generated by DroneVerse v2.1 ═══`;
  }, [mis, run, elapsed]);

  const requestAiDebrief = useCallback(async () => {
    setAiDebrief("loading"); setShowAiModal(true);
    try {
      const drones = swRef.current.drones;
      const active = drones.filter(d => d.status === "ACTIVE");
      const avg = fn => active.length ? Math.round(active.reduce((s, d) => s + fn(d), 0) / active.length * 10) / 10 : 0;
      const topDrones = [...drones].filter(d => d.memory).sort((a, b) => b.memory.experienceScore - a.memory.experienceScore).slice(0, 3);
      const gs = kgRef.current?.toSummary();
      const emEvents = edRef.current?.getRecent(30000)?.map(e => `${e.type}: ${e.desc}`) || [];
      const pe = phaseRef.current;
      const prompt = `You are a military drone operations analyst for RTR (Real-Time Robotics).
Analyze this simulation data and write a concise tactical debrief (150-200 words).

MISSION: ${mis?.name || "N/A"} [${mis?.domain || "N/A"}]
ELAPSED: ${Math.round(elapsed)}s
${pe ? `PHASE: ${pe.currentPhase + 1}/${pe.phases.length} — ${pe.getCurrentPhase()?.name || "Complete"}` : "Single-phase mission"}

FLEET: ${active.filter(d => d.spec.iff === "FRIENDLY").length} friendly, ${active.filter(d => d.spec.iff === "HOSTILE").length} hostile, ${drones.filter(d => d.status === "ELIMINATED").length} eliminated
AVG BATTERY: ${avg(d => d.fd.battery)}% | AVG SIGNAL: ${avg(d => d.fd.signal)}%

${gs ? `KNOWLEDGE GRAPH: ${gs.nodeCount} nodes, ${gs.edgeCount} edges. Types: ${JSON.stringify(gs.types)}` : ""}

EMERGENCE PATTERNS: ${emEvents.join(", ") || "None detected"}

TOP AGENTS:
${topDrones.map(d => `${d.id} (${d.typeKey}): XP ${Math.round(d.memory.experienceScore)}, ${d.memory.eliminationCount} kills, sectors ${d.memory.sectorsVisited.size}/16, personality: aggression=${d.memory.personality.aggression.toFixed(1)} autonomy=${d.memory.personality.autonomy.toFixed(1)} teamwork=${d.memory.personality.teamwork.toFixed(1)}`).join("\n")}

THREATS: ${swRef.current.threats.map(t => `${t.type} at (${t.x},${t.y})`).join(", ") || "None"}

Write the debrief in English with:
1. Situation summary (2-3 sentences)
2. Key tactical observations (what happened, why)
3. Swarm behavior assessment (any emergent patterns?)
4. Recommendations for next sortie
Format as plain text, no markdown.`;
      const text = await callAI([{ role: "user", content: prompt }], 1000);
      setAiDebrief(text || "No response content");
    } catch (err) {
      setAiDebrief(`AI debrief unavailable (${err.message}) — showing standard report:\n\n${generateReport()}`);
    }
  }, [mis, elapsed, generateReport]);


  const applyWind = useCallback((dir, spd) => {
    const wx = Math.sin(dir * DEG) * spd;
    const wy = Math.cos(dir * DEG) * spd;
    for (const d of swRef.current.drones) { d.fd.windX = wx; d.fd.windY = wy; }
  }, []);

  const spawnBogey = useCallback((count) => {
    const existing = swRef.current.drones.filter(d => d.id.startsWith("GOD-BOGEY")).length;
    if (existing >= 3) { log("MAX 3 GOD-BOGEYs reached", "warning"); return; }
    const toSpawn = Math.min(count, 3 - existing);
    for (let i = 0; i < toSpawn; i++) {
      bogeyCounter.current++;
      const angle = Math.random() * PI2;
      const range = 250 + Math.random() * 100;
      const x = Math.round(Math.cos(angle) * range);
      const y = Math.round(Math.sin(angle) * range);
      const id = `GOD-BOGEY-${bogeyCounter.current}`;
      swRef.current.addDrone(id, "BOGEY", x, y, 200 + Math.random() * 100, (Math.atan2(-x, -y) / DEG + 360) % 360);
      if (i > 0) { // triangle offset for ×3
        const off = 30;
        swRef.current.drones[swRef.current.drones.length - 1].fd.x += (i === 1 ? off : -off) * Math.cos(angle + Math.PI / 2);
        swRef.current.drones[swRef.current.drones.length - 1].fd.y += (i === 1 ? off : -off) * Math.sin(angle + Math.PI / 2);
      }
      log(`ADVERSARY: BOGEY spawned at (${x}, ${y})`, "warning");
    }
    setMis(m => m ? { ...m } : m);
  }, [log]);

  const gpsDeny = useCallback(() => {
    const t = { x: 0, y: 0, radius: 100, type: "GPS-DENY" };
    swRef.current.threats.push(t);
    if (mis) mis.threats = [...swRef.current.threats];
    setMis(m => m ? { ...m } : m);
    log("GPS-DENY zone activated at origin R:100m", "warning");
  }, [mis, log]);

  const rtbAll = useCallback(() => {
    for (const d of swRef.current.drones) {
      if (d.spec.iff !== "FRIENDLY") continue;
      d.fd.targetHdg = (Math.atan2(-d.fd.x, -d.fd.y) / DEG + 360) % 360;
      d.fd.targetAlt = 100;
    }
    swRef.current.perDroneWP.clear();
    log("RTB ALL: Friendly fleet returning to base", "success");
  }, [log]);

  const scatterAll = useCallback(() => {
    for (const d of swRef.current.drones) {
      if (d.spec.iff !== "FRIENDLY") continue;
      d.fd.targetHdg = Math.random() * 360;
      d.fd.targetSpeed = d.spec.maxSpeed;
    }
    swRef.current.perDroneWP.clear();
    log("SCATTER: Fleet dispersing at max speed", "info");
  }, [log]);

  const formUp = useCallback(() => {
    const friendlies = swRef.current.drones.filter(d => d.spec.iff === "FRIENDLY");
    const n = friendlies.length;
    swRef.current.perDroneWP.clear();
    friendlies.forEach((d, i) => {
      swRef.current.perDroneWP.set(d.id, {
        x: Math.round(80 * Math.cos(i * PI2 / n)),
        y: Math.round(80 * Math.sin(i * PI2 / n)),
        alt: 150,
      });
    });
    log(`FORM UP: ${n} drones forming circle R:80m`, "success");
  }, [log]);

  useEffect(() => {
    if (!run) return;
    const iv = setInterval(() => {
      swRef.current.update(0.2); tickRef.current++; setTick(t => t + 1); setElapsed(e => {
        const newE = e + 0.2;
        // Phase engine integration
        const pe = phaseRef.current;
        if (pe && !pe.completed) {
          pe.checkObjectives(swRef.current.drones, swRef.current.threats);
          const result = pe.checkTransition(newE, swRef.current.drones, swRef.current.threats);
          if (result) {
            if (result.type === "MISSION_COMPLETE") {
              setPhaseInfo(pi => pi ? { ...pi, name: VI.missionComplete, briefing: "Toàn bộ fleet về căn cứ an toàn" } : pi);
              setLogs(p => [{ m: `✅ ${VI.missionComplete} — Toàn bộ fleet về căn cứ an toàn`, l: "success", t: Date.now() }, ...p].slice(0, 40));
              setMissionComplete(true); setTimeout(() => setMissionComplete(false), 3000);
            } else if (result.type === "PHASE_ADVANCE") {
              const ph = result.phase;
              // Apply phase waypoints
              if (ph.waypoints) swRef.current.assignWaypoints([...ph.waypoints]);
              // Apply phase threats
              if (ph.clearThreats) swRef.current.threats = [];
              if (ph.threats) ph.threats.forEach(t => swRef.current.threats.push(t));
              // Spawn new drones
              if (ph.spawns) ph.spawns.forEach(d => swRef.current.addDrone(d.id, d.type, d.x, d.y, d.alt, d.hdg));
              // Strike targets as waypoints
              if (ph.strikeTargets) swRef.current.assignWaypoints(ph.strikeTargets.map(t => ({ x: t.x, y: t.y, alt: t.alt })));
              // Cargo waypoints
              if (ph.cargoWP) {
                const cargos = swRef.current.drones.filter(d => d.typeKey === "HERA-C" && d.status === "ACTIVE");
                cargos.forEach((c, i) => swRef.current.perDroneWP.set(c.id, ph.cargoWP[Math.min(i, ph.cargoWP.length - 1)]));
              }
              // Weather
              if (ph.weather) {
                setWindDir(ph.weather.windDir); setWindSpd(ph.weather.windSpeed);
                const wx = Math.sin(ph.weather.windDir * DEG) * ph.weather.windSpeed;
                const wy = Math.cos(ph.weather.windDir * DEG) * ph.weather.windSpeed;
                for (const dd of swRef.current.drones) { dd.fd.windX = wx; dd.fd.windY = wy; }
              }
              setPhaseInfo({ name: ph.name, briefing: ph.briefing, idx: pe.currentPhase, total: pe.phases.length, objectives: ph.objectives || [], status: pe.objectiveStatus });
              setLogs(p => [{ m: `🚁 ${VI.phase} ${pe.currentPhase + 1}: ${ph.name} — ${ph.briefing}`, l: "success", t: Date.now() }, ...p].slice(0, 40));
              // Emit phase-specific logs gradually
              const pLogs = mis?.phaseLogs?.[pe.currentPhase + 1];
              if (pLogs) pLogs.forEach((msg, i) => setTimeout(() => setLogs(p => [{ m: msg, l: "info", t: Date.now() }, ...p].slice(0, 40)), (i + 1) * 2500));
            }
          }
          // Update phase info objectives display
          const cp = pe.getCurrentPhase();
          if (cp) setPhaseInfo(pi => pi ? { ...pi, status: { ...pe.objectiveStatus } } : pi);
        }
        return newE;
      });
      const dr = swRef.current.drones;
      if (dr.length) {
        const active = dr.filter(d => d.status === "ACTIVE");
        if (active.length) {
          const a = fn => active.reduce((s, d) => s + fn(d), 0) / active.length;
          setTel(p => [...p.slice(-50), { t: p.length, bat: Math.round(a(d => d.fd.battery) * 10) / 10, sig: Math.round(a(d => d.fd.signal) * 10) / 10, alt: Math.round(a(d => d.fd.alt)), spd: Math.round(a(d => d.fd.speed) * 10) / 10 }]);
        }
      }
      // Knowledge Graph updates (every 10 ticks = 0.5s)
      const tk = tickRef.current;
      const kg = kgRef.current;
      if (kg && tk % 10 === 0) {
        const allDr = swRef.current.drones;
        kg.removeEdges("proximity");
        for (const d of allDr) {
          if (d.status !== "ACTIVE") continue;
          kg.updateNode(d.id, { x: d.fd.x, y: d.fd.y, battery: d.fd.battery, status: d.status });
          // Sector visit tracking
          const gx = Math.min(3, Math.max(0, Math.floor((d.fd.x + 400) / 200)));
          const gy = Math.min(3, Math.max(0, Math.floor((d.fd.y + 400) / 200)));
          const secId = `sec-${gx}-${gy}`;
          const sec = kg.nodes.get(secId);
          if (sec) {
            sec.data.visitCount = (sec.data.visitCount || 0) + 1;
            sec.data.lastVisit = Date.now();
          }
          // Proximity edges
          for (const o of allDr) {
            if (o.id <= d.id || o.status !== "ACTIVE") continue;
            if (Math.hypot(d.fd.x - o.fd.x, d.fd.y - o.fd.y) < 50) kg.addEdge(d.id, o.id, "proximity");
          }
          // Threat detection edges
          for (const t of swRef.current.threats) {
            if (Math.hypot(d.fd.x - t.x, d.fd.y - t.y) < t.radius * 1.5) {
              const tid = `t-${t.x}-${t.y}`;
              if (!kg.edges.some(e => e.from === d.id && e.to === tid && e.relation === "detected")) kg.addEdge(d.id, tid, "detected");
            }
          }
          // Low battery event
          if (d.fd.battery < 15 && !kg.nodes.has(`evt-lowbat-${d.id}`)) {
            kg.addNode(`evt-lowbat-${d.id}`, "event", `Low battery: ${d.id}`, { timestamp: Date.now() });
            kg.addEdge(`evt-lowbat-${d.id}`, d.id, "involves");
          }
        }
        setGraphStats(kg.toSummary());
      }
      // Emergence detection (every 20 ticks = 1s)
      const ed = edRef.current;
      if (ed && tk % 20 === 0) {
        const patterns = ed.analyze(swRef.current.drones);
        if (patterns.length > 0) {
          for (const p of patterns) {
            setLogs(prev => [{ m: `EMERGENCE: ${p.type} — ${p.desc}`, l: "info", t: Date.now() }, ...prev].slice(0, 40));
            if (kg) kg.addEvent(`${p.type}: ${p.desc}`, swRef.current.drones.filter(d => d.status === "ACTIVE" && d.spec.iff === "FRIENDLY").map(d => d.id));
          }
          setEmergenceFeed(ed.getRecent());
        } else {
          setEmergenceFeed(ed.getRecent());
        }
      }
    }, 50);
    return () => clearInterval(iv);
  }, [run]);

  const drAll = swRef.current.drones, dr = drAll.filter(d => d.status === "ACTIVE"), th = mis?.threats || [], wp = mis?.waypoints || [];
  const sd = dr.find(d => d.id === sel);
  const fr = dr.filter(d => d.spec.iff === "FRIENDLY").length, ho = dr.filter(d => d.spec.iff === "HOSTILE").length;
  const eliminated = drAll.filter(d => d.status === "ELIMINATED").length;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: T.bg, color: T.text, fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 14, lineHeight: 1.5, overflow: "hidden" }}>
      {/* TOP */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: missionComplete ? `2px solid ${T.success}` : `1px solid ${T.border}`, background: T.bgPanel, transition: "border-color 0.5s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Radar size={18} color={T.accent} /><span style={{ fontSize: 15, fontWeight: 700, color: T.accent, letterSpacing: 2 }}>RTR DRONEVERSE</span></div>
            <div style={{ fontSize: 12, color: T.textFaint, marginTop: -1, marginLeft: 24 }}>{VI.subtitle}</div>
          </div>
          <button onClick={startDemo} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 12px", borderRadius: 5, border: `1px solid ${T.success}60`, background: T.successBg, color: T.success, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}><Play size={12} /> {VI.demo}</button>
          <button onClick={() => setShowScenarioModal(true)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 12px", borderRadius: 5, border: `1px solid ${T.purple}60`, background: T.purpleBg, color: T.purple, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}><Brain size={12} /> {VI.aiScenario}</button>
          {mis && <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 4, background: mis.domain === "RESCUE" ? T.successBg : mis.domain === "MIL" ? T.dangerBg : T.accentBg, color: mis.domain === "RESCUE" ? T.success : mis.domain === "MIL" ? T.danger : T.accent }}>{mis.domain === "RESCUE" ? VI.rescue : mis.domain} — {mis.name}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={14} color={T.textMuted} /><span style={{ color: T.textDim, fontVariantNumeric: "tabular-nums" }}>T+{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}><Plane size={14} color={T.accent} /><span style={{ color: T.accent }}>{fr}</span></div>
          {ho > 0 && <div style={{ display: "flex", alignItems: "center", gap: 3 }}><AlertTriangle size={14} color={T.danger} /><span style={{ color: T.danger }}>{ho}</span></div>}
          {eliminated > 0 && <div style={{ display: "flex", alignItems: "center", gap: 3 }}><X size={14} color={T.hostile} /><span style={{ color: T.hostile }}>{eliminated}</span></div>}
          {/* Theme toggle */}
          <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} aria-label="Chuyển theme sáng/tối" style={{ display: "flex", alignItems: "center", padding: "4px 8px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textMuted, cursor: "pointer", fontFamily: "inherit" }}>{theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}</button>
          <div style={{ display: "flex", gap: 2, background: T.bgCard, borderRadius: 4, padding: 2 }}>
            {[["map", MapPin], ["split", Layers], ["radar", Radar], ["3d", Box]].map(([v, I]) => (
              <button key={v} onClick={() => setVw(v)} style={{ display: "flex", alignItems: "center", padding: "4px 10px", borderRadius: 3, border: "none", cursor: "pointer", background: vw === v ? T.accentBg : "transparent", color: vw === v ? T.accent : T.textMuted, fontSize: 11, fontFamily: "inherit", fontWeight: 600 }}><I size={13} /></button>
            ))}
          </div>
        </div>
      </div>
      {/* BODY */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* LEFT */}
        <div style={{ width: 240, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", background: T.bgPanel }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${T.border}`, maxHeight: 300, overflow: "auto" }}>
            <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: 1, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}><Target size={12} /> {VI.missions} ({MISSIONS.length})</div>
            {MISSIONS.map(m => { const I = m.icon, a = mis?.id === m.id; return <button key={m.id} onClick={() => launch(m)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6, border: a ? `1px solid ${T.accentBorder}` : `1px solid ${T.borderAccent}`, background: a ? T.accentBg : T.bgCard, cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: T.text, width: "100%", marginBottom: 3 }}><I size={14} color={a ? T.accent : T.textMuted} /><div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 11, fontWeight: 600, color: a ? T.accent : T.text }}>{m.name}</span>{m.multi && <span style={{ fontSize: 12, padding: "1px 4px", borderRadius: 2, background: T.purpleBg, color: T.purple, fontWeight: 700 }}>MULTI</span>}</div><div style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>{m.desc}</div></div></button>; })}
          </div>
          {mis && <div style={{ padding: "5px 8px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 3 }}>
            <button onClick={injectThreat} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "6px 0", borderRadius: 5, border: `1px solid ${T.danger}40`, background: T.dangerBg, color: T.danger, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}><Plus size={12} /> {VI.inject}</button>
            <button onClick={() => setSideTab("fleet")} aria-label={VI.fleet} style={{ padding: "6px 10px", borderRadius: 5, border: "none", cursor: "pointer", background: sideTab === "fleet" ? T.accentBg : T.bgCard, color: sideTab === "fleet" ? T.accent : T.textMuted, fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}><Plane size={12} /></button>
            <button onClick={() => setSideTab("god")} aria-label={VI.god} style={{ padding: "6px 10px", borderRadius: 5, border: "none", cursor: "pointer", background: sideTab === "god" ? T.warnBg : T.bgCard, color: sideTab === "god" ? T.warn : T.textMuted, fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}><Zap size={12} /></button>
            <button onClick={() => setSideTab("video")} style={{ padding: "6px 10px", borderRadius: 5, border: "none", cursor: "pointer", background: sideTab === "video" ? T.successBg : T.bgCard, color: sideTab === "video" ? T.success : T.textMuted, fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}><Film size={12} /></button>
          </div>}
          <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
            {sideTab === "fleet" ? <>
              <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: 1, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}><Plane size={12} /> {VI.fleet} ({dr.length})</div>
              {dr.map(d => (
                <div key={d.id} onClick={() => setSel(d.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", borderRadius: 4, cursor: "pointer", background: sel === d.id ? T.accentBg : "transparent", border: sel === d.id ? `1px solid ${T.accentBorder}` : "1px solid transparent", marginBottom: 2 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.spec.color, boxShadow: `0 0 5px ${d.spec.color}60`, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: d.spec.iff === "HOSTILE" ? T.danger : T.text }}>{d.id}</span>
                  <Battery size={11} color={d.fd.battery < 25 ? T.danger : T.success} />
                  <span style={{ fontSize: 13, color: T.textDim, width: 22, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(d.fd.battery)}</span>
                </div>
              ))}
            </> : sideTab === "god" ? <>
              <div style={{ fontSize: 11, color: T.warn, letterSpacing: 1, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}><Zap size={12} /> {VI.god}</div>
              {/* Weather Control */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: T.textMuted, letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><Wind size={9} /> {VI.weather}</div>
                <div style={{ fontSize: 13, color: T.textDim, marginBottom: 2 }}>Wind Dir: {windDir}° ({compassLabel(windDir)})</div>
                <input type="range" min={0} max={360} value={windDir} onChange={e => { const v = +e.target.value; setWindDir(v); applyWind(v, windSpd); if (windSpd > 0) log(`WIND: ${windSpd}m/s from ${compassLabel(v)}`, "info"); }} style={{ width: "100%", height: 4, accentColor: "#00e5ff" }} />
                <div style={{ fontSize: 13, color: T.textDim, marginBottom: 2, marginTop: 4 }}>Wind Spd: {windSpd} m/s</div>
                <input type="range" min={0} max={25} value={windSpd} onChange={e => { const v = +e.target.value; setWindSpd(v); applyWind(windDir, v); log(`WIND: ${v}m/s from ${compassLabel(windDir)}`, "info"); }} style={{ width: "100%", height: 4, accentColor: "#00e5ff" }} />
              </div>
              {/* Adversary Spawn */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: T.textMuted, letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><UserPlus size={9} /> {VI.adversary}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => spawnBogey(1)} style={{ flex: 1, padding: "8px 0", borderRadius: 5, minHeight: 36, border: "1px solid #ff6b3540", background: "#ff6b3512", color: T.hostile, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>BOGEY</button>
                  <button onClick={() => spawnBogey(3)} style={{ flex: 1, padding: "8px 0", borderRadius: 5, minHeight: 36, border: "1px solid #ff6b3540", background: "#ff6b3512", color: T.hostile, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>BOGEY x3</button>
                </div>
              </div>
              {/* GPS Denial */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: T.textMuted, letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><Radio size={9} /> {VI.electronic}</div>
                <button onClick={gpsDeny} style={{ width: "100%", padding: "8px 0", borderRadius: 5, minHeight: 36, border: "1px solid #a855f740", background: "#a855f712", color: "#a855f7", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>GPS DENY (origin)</button>
              </div>
              {/* Fleet Commands */}
              <div>
                <div style={{ fontSize: 13, color: T.textMuted, letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><Navigation size={9} /> {VI.fleetCmd}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <button onClick={rtbAll} style={{ padding: "8px 0", borderRadius: 5, minHeight: 36, border: "1px solid #00e87840", background: "#00e87812", color: "#00e878", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}><Home size={9} /> {VI.rtb}</button>
                  <button onClick={scatterAll} style={{ padding: "8px 0", borderRadius: 5, minHeight: 36, border: "1px solid #ffb02040", background: "#ffb02012", color: "#ffb020", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}><Shuffle size={9} /> {VI.scatter}</button>
                  <button onClick={formUp} style={{ padding: "8px 0", borderRadius: 5, minHeight: 36, border: "1px solid #00e5ff40", background: "#00e5ff12", color: "#00e5ff", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}><CircleDot size={9} /> {VI.formUp}</button>
                </div>
              </div>
              {/* Knowledge Graph Stats */}
              {graphStats && <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, color: T.textMuted, letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><GitBranch size={9} /> {VI.graph}</div>
                <div style={{ fontSize: 12, color: T.success, lineHeight: 1.5 }}>
                  Nodes: {graphStats.nodeCount} | Edges: {graphStats.edgeCount}<br/>
                  {Object.entries(graphStats.types).map(([t, c]) => `${t}: ${c}`).join(" | ")}<br/>
                  {graphStats.mostVisited && <>Top: {graphStats.mostVisited} ({graphStats.mostVisitCount})<br/></>}
                  {graphStats.leastVisited && <>Low: {graphStats.leastVisited} ({graphStats.leastVisitCount})</>}
                </div>
              </div>}
            </> : <>
              <div style={{ fontSize: 11, color: T.success, letterSpacing: 1, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}><Film size={12} /> VIDEO DEMO</div>
              {[
                { src: "/videos/hera-tiep-te.mp4", title: "HERA Tiếp tế", desc: "Drone HERA-C thực hiện tiếp tế vùng lũ" },
                { src: "/videos/hera-vung-lu.mp4", title: "HERA Vùng lũ", desc: "Trinh sát và đánh giá thiệt hại vùng lũ" },
                { src: "/videos/loa-tiep-can.mp4", title: "Loa tiếp cận", desc: "Hệ thống loa phát thanh tiếp cận nạn nhân" },
              ].map((v, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.text, marginBottom: 3 }}>{v.title}</div>
                  <video
                    src={v.src}
                    controls
                    preload="metadata"
                    style={{ width: "100%", borderRadius: 6, border: `1px solid ${T.border}`, background: "#000" }}
                  />
                  <div style={{ fontSize: 8, color: T.textMuted, marginTop: 2 }}>{v.desc}</div>
                </div>
              ))}
            </>}
          </div>
          <div style={{ padding: 8, borderTop: `1px solid ${T.border}`, display: "flex", gap: 4 }}>
            <button onClick={() => setRun(!run)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: `1px solid ${run ? T.accentBorder : T.border}`, background: run ? T.accentBg : T.bgCard, color: run ? T.accent : T.textDim, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>{run ? <Pause size={14} /> : <Play size={14} />}{run ? VI.pause : VI.run}</button>
            {mis && <button onClick={() => setShowReport(true)} aria-label={VI.report} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #00e5ff40", background: "#00e5ff10", color: "#00e5ff", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center" }}><FileText size={12} /></button>}
            {mis && <button onClick={requestAiDebrief} disabled={aiDebrief === "loading"} aria-label={VI.aiDebrief} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #a855f740", background: aiDebrief === "loading" ? "#a855f725" : "#a855f710", color: "#a855f7", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", fontSize: 12 }}>{aiDebrief === "loading" ? <span style={{ animation: "pulse 1s infinite" }}>...</span> : <Cpu size={12} />}</button>}
            <button onClick={() => { swRef.current = new SwarmController(); setMis(null); setRun(false); setElapsed(0); setSel(null); setTel([]); setLogs([]); setShowReport(false); setSideTab("fleet"); setWindDir(0); setWindSpd(0); setCamMode("orbit"); phaseRef.current = null; setPhaseInfo(null); kgRef.current = null; edRef.current = null; setEmergenceFeed([]); setGraphStats(null); setShowGraphOverlay(false); setAiDebrief(null); setShowAiModal(false); }} aria-label="Reset" style={{ padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textMuted, cursor: "pointer", fontFamily: "inherit" }}><RotateCcw size={12} /></button>
          </div>
        </div>
        {/* CENTER */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          {phaseInfo && <div style={{ position: "absolute", top: 44, left: 12, zIndex: 10, background: T.bgOverlay, border: `1px solid ${T.purple}40`, borderRadius: 8, padding: "10px 16px", maxWidth: 320, minWidth: 200, fontFamily: "inherit" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.purple, marginBottom: 4 }}>{VI.phase} {phaseInfo.idx + 1}/{phaseInfo.total}: {phaseInfo.name}</div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{phaseInfo.briefing}</span>
              {mis && <button onClick={requestAdvice} disabled={adviceCooldown > 0 || aiAdvice === "loading"} style={{ padding: "6px 10px", borderRadius: 4, minHeight: 32, border: "1px solid #a855f740", background: "#a855f715", color: adviceCooldown > 0 ? T.textFaint : "#a855f7", cursor: adviceCooldown > 0 ? "default" : "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}><Brain size={8} /> {adviceCooldown > 0 ? `${adviceCooldown}s` : VI.aiAdvisor}</button>}
            </div>
            {phaseInfo.objectives.map(obj => {
              const done = phaseInfo.status?.[obj.id];
              return <div key={obj.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, marginBottom: 3 }}>
                {done ? <CheckCircle size={11} color={T.success} /> : <Circle size={11} color={T.borderAccent} />}
                <span style={{ color: done ? T.success : T.textFaint }}>{obj.desc}</span>
              </div>;
            })}
            {mis?.victims && <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 4, paddingTop: 4, fontSize: 9 }}>
              <div style={{ color: "#ff2040", marginBottom: 2 }}>🔴 P1: {mis.victims.filter(v=>v.priority===1).reduce((s,v)=>s+v.people,0)} người ({mis.victims.filter(v=>v.priority===1).length} cụm)</div>
              <div style={{ color: "#ff8c00", marginBottom: 2 }}>🟠 P2: {mis.victims.filter(v=>v.priority===2).reduce((s,v)=>s+v.people,0)} người ({mis.victims.filter(v=>v.priority===2).length} cụm)</div>
              <div style={{ color: "#00cc66" }}>🟢 P3: {mis.victims.filter(v=>v.priority===3).reduce((s,v)=>s+v.people,0)} người ({mis.victims.filter(v=>v.priority===3).length} cụm)</div>
            </div>}
          </div>}
          <div style={{ flex: 1, display: "flex", gap: 1, padding: 1, background: T.bgCard, minHeight: 0, overflow: "hidden" }}>
            {vw === "map" && <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
              {/* MAP 70% */}
              <div style={{ width: "70%", position: "relative" }}>
                <div style={{ position: "absolute", inset: 0 }}>
                  <ErrorBoundary name="MapView"><MapView drones={dr} threats={th} waypoints={wp} selectedId={sel} onSelect={setSel} mission={mis} victims={mis?.victims} /></ErrorBoundary>
                </div>
                <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 4, background: "rgba(0,0,0,0.7)", padding: "4px 10px", borderRadius: 4, fontSize: 12, color: "#00e5ff", zIndex: 2 }}><MapPin size={12} /> BẢN ĐỒ VỆ TINH</div>
              </div>
              {/* LOG PANEL 30% */}
              <div style={{ width: "30%", display: "flex", flexDirection: "column", background: T.bgPanel, borderLeft: `1px solid ${T.border}` }}>
                {/* Clock — fixed */}
                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: elapsed > 300 ? T.danger : T.accent, fontVariantNumeric: "tabular-nums", fontFamily: "inherit" }}>T+{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}</div>
                  <div style={{ fontSize: 12, color: T.textDim }}>{dr.length} drone | Pin: {dr.length ? Math.round(dr.reduce((s,d) => s + d.fd.battery, 0) / dr.length) : 0}%</div>
                </div>
                {/* Phase — fixed, scrollable if too tall */}
                {phaseInfo && <div style={{ padding: "8px 14px", borderBottom: `1px solid ${T.border}`, borderLeft: `3px solid ${T.purple}`, maxHeight: "30%", overflow: "auto", flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.purple, marginBottom: 4 }}>{VI.phase} {phaseInfo.idx + 1}/{phaseInfo.total}: {phaseInfo.name}</div>
                  <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6 }}>{phaseInfo.briefing}</div>
                  {phaseInfo.objectives.map(obj => {
                    const done = phaseInfo.status?.[obj.id];
                    return <div key={obj.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, marginBottom: 3 }}>
                      {done ? <CheckCircle size={13} color={T.success} /> : <Circle size={13} color={T.borderAccent} />}
                      <span style={{ color: done ? T.success : T.textFaint }}>{obj.desc}</span>
                    </div>;
                  })}
                  {mis?.victims && <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 6, paddingTop: 6, fontSize: 12, display: "flex", gap: 12 }}>
                    <span style={{ color: "#ff2040" }}>🔴 P1: {mis.victims.filter(v=>v.priority===1).reduce((s,v)=>s+v.people,0)}</span>
                    <span style={{ color: "#ff8c00" }}>🟠 P2: {mis.victims.filter(v=>v.priority===2).reduce((s,v)=>s+v.people,0)}</span>
                    <span style={{ color: "#00cc66" }}>🟢 P3: {mis.victims.filter(v=>v.priority===3).reduce((s,v)=>s+v.people,0)}</span>
                  </div>}
                </div>}
                {/* Log — fills remaining space, SCROLLABLE */}
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "6px 10px 0", fontSize: 12, color: T.textMuted, letterSpacing: 1, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}><Activity size={12} /> {VI.log}</div>
                  <div ref={el => { if (el) setTimeout(() => { el.scrollTop = el.scrollHeight; }, 0); }} style={{ flex: 1, minHeight: 0, overflowY: "scroll", padding: "4px 10px 8px" }}>
                    {logs.map((l, i) => <div key={i} style={{
                      fontSize: 13, padding: "6px 10px", marginBottom: 4, borderRadius: 6, lineHeight: 1.6,
                      borderLeft: `3px solid ${l.l === "success" ? T.success : l.l === "warning" ? T.warn : l.l === "critical" ? T.danger : T.border}`,
                      background: l.l === "success" ? `${T.success}10` : l.l === "warning" ? `${T.warn}10` : l.l === "critical" ? `${T.danger}10` : "transparent",
                      color: T.text, animation: i === 0 ? "logSlide 0.3s ease" : "none",
                    }}>
                      <span style={{ color: T.textMuted, marginRight: 6, fontSize: 11 }}>{new Date(l.t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      {l.m}
                    </div>)}
                  </div>
                </div>
                {/* Fleet status — fixed bottom */}
                <div style={{ padding: "6px 14px", borderTop: `1px solid ${T.border}`, fontSize: 13, color: T.textDim, display: "flex", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
                  <span>Gió: {windSpd}m/s</span>
                  <span>{VI.friendly}: {fr}</span>
                  {ho > 0 && <span style={{ color: T.danger }}>{VI.hostile}: {ho}</span>}
                  {eliminated > 0 && <span style={{ color: T.hostile }}>Loại: {eliminated}</span>}
                </div>
              </div>
            </div>}
            {(vw === "split" || vw === "3d") && <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
              <ErrorBoundary name="Viewport3D"><Viewport3D drones={dr} threats={th} waypoints={wp} selectedId={sel} camMode={camMode} windSpd={windSpd} threeTheme={T.three} T={T} /></ErrorBoundary>
              <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 4, background: T.bgOverlay, padding: "4px 10px", borderRadius: 4, fontSize: 11, color: T.textMuted }}><Box size={12} /> 3D TACTICAL</div>
              <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 3, zIndex: 2 }}>
                {[["orbit", RotateCcw], ["chase", Eye], ["topdown", Maximize2], ["cinematic", Film]].map(([md, Icon]) => (
                  <button key={md} onClick={() => setCamMode(md)} style={{ padding: "4px 6px", borderRadius: 4, border: "none", cursor: "pointer", background: camMode === md ? "#00e5ff30" : "#000000aa", color: camMode === md ? "#00e5ff" : "#7090b0", fontSize: 12, fontFamily: "inherit", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}><Icon size={10} />{md.toUpperCase()}</button>
                ))}
              </div>
              {emergenceFeed.length > 0 && <div style={{ position: "absolute", bottom: 50, left: 8, background: T.bgOverlay, border: "1px solid #a855f730", borderRadius: 6, padding: "5px 8px", maxWidth: 250, zIndex: 2 }}>
                <div style={{ fontSize: 12, color: "#a855f7", letterSpacing: 1, marginBottom: 3, display: "flex", alignItems: "center", gap: 3 }}><Brain size={8} /> {VI.emergence}</div>
                {emergenceFeed.slice(0, 4).map((e, i) => <div key={i} style={{ fontSize: 12, color: T.textDim, marginBottom: 1, opacity: Math.max(0.3, 1 - (Date.now() - e.timestamp) / 8000) }}>⚡ {e.type}: {e.desc}</div>)}
              </div>}
            </div>}
            {(vw === "split" || vw === "radar") && <div style={{ flex: vw === "radar" ? 1 : 0, flexBasis: vw === "split" ? 400 : "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: T.radar.bg, position: "relative", padding: 8 }}>
              <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 4, background: T.bgOverlay, padding: "4px 10px", borderRadius: 4, fontSize: 11, color: T.success }}><Radar size={12} /> PPI RADAR</div>
              <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 3 }}>
                <button onClick={() => setShowGraphOverlay(!showGraphOverlay)} style={{ padding: "6px 10px", borderRadius: 4, minHeight: 32, border: "none", cursor: "pointer", background: showGraphOverlay ? "#a855f730" : "#111", color: showGraphOverlay ? "#a855f7" : "#40a070", fontSize: 12, fontFamily: "inherit", fontWeight: 600 }}><GitBranch size={9} /></button>
                {[200, 400, 600, 800].map(r => <button key={r} onClick={() => setRng(r)} style={{ padding: "6px 10px", borderRadius: 4, minHeight: 32, border: "none", cursor: "pointer", background: rng === r ? "#00aa60" : T.bgCard, color: rng === r ? "#00ff80" : "#40a070", fontSize: 12, fontFamily: "inherit", fontWeight: 600 }}>{r}</button>)}
              </div>
              <ErrorBoundary name="RadarPPI"><RadarPPI drones={dr} threats={th} waypoints={wp} radarRange={rng} selectedId={sel} onSelect={setSel} onAddWaypoint={addWaypoint} wind={{ dir: windDir, speed: windSpd }} graphOverlay={showGraphOverlay} kg={kgRef.current} radarTheme={T.radar} /></ErrorBoundary>
            </div>}
          </div>
          {/* BOTTOM */}
          <div style={{ height: 150, flexShrink: 0, borderTop: `1px solid ${T.border}`, display: "flex", background: T.bgPanel, overflow: "hidden" }}>
            <div style={{ width: 270, borderRight: `1px solid ${T.border}`, padding: "6px 10px", overflow: "auto" }}>
              <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Crosshair size={12} /> {sd ? VI.track : VI.noTrk}</div>
              {sd ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 10px" }}>
                {[[Navigation,"HDG",`${Math.round(sd.fd.hdg)}°`,"#c0d0e0"],[Gauge,"SPD",`${sd.fd.speed.toFixed(1)}`,"#00e5ff"],[ArrowUpRight,"ALT",`${Math.round(sd.fd.alt)}m`,"#00e878"],[Activity,"VS",`${sd.fd.vs > 0 ? "+" : ""}${sd.fd.vs.toFixed(1)}`,(sd.fd.vs > 0 ? "#00e878" : "#ff3b5c")],[Battery,"BAT",`${Math.round(sd.fd.battery)}%`,(sd.fd.battery < 25 ? "#ff3b5c" : "#00e878")],[Signal,"SIG",`${Math.round(sd.fd.signal)}%`,(sd.fd.signal < 60 ? "#ffb020" : "#00e5ff")],[Compass,"BNK",`${Math.round(sd.fd.bank)}°`,"#a855f7"],[Shield,"IFF",sd.spec.iff,(sd.spec.iff === "HOSTILE" ? "#ff3b5c" : "#00e878")]].map(([I,k,v,c]) => <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}><I size={9} color={T.textMuted} /><span style={{ fontSize: 13, color: T.textMuted, width: 30 }}>{k}</span><span style={{ fontSize: 12, fontWeight: 600, color: c, fontVariantNumeric: "tabular-nums" }}>{v}</span></div>)}
              {sd.memory && <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #222", paddingTop: 3, marginTop: 2 }}>
                <div style={{ fontSize: 12, color: "#a855f7", letterSpacing: 1, marginBottom: 2, display: "flex", alignItems: "center", gap: 3 }}><Brain size={7} /> {VI.agentMem}</div>
                <div style={{ fontSize: 12, color: T.textMuted, display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                  <span>XP:<b style={{color:"#a855f7"}}>{Math.round(sd.memory.experienceScore)}</b></span>
                  <span>Sec:<b style={{color:"#00e5ff"}}>{sd.memory.sectorsVisited.size}/16</b></span>
                  <span>Dist:<b style={{color:"#00e878"}}>{(sd.memory.distanceTraveled/1000).toFixed(1)}km</b></span>
                  <span>Kills:<b style={{color:"#ff3b5c"}}>{sd.memory.eliminationCount}</b></span>
                  <span style={{fontSize:7}}>A:{sd.memory.personality.aggression.toFixed(1)} U:{sd.memory.personality.autonomy.toFixed(1)} T:{sd.memory.personality.teamwork.toFixed(1)}</span>
                </div>
              </div>}
              </div> : <div style={{ fontSize: 12, color: "#333", padding: 8 }}>{VI.clickTrack}</div>}
            </div>
            <div style={{ flex: 1, display: "flex", gap: 1 }}>
              {[{ k: "bat", n: "BATTERY", c: "#00e878" }, { k: "alt", n: "ALTITUDE", c: "#00e5ff" }, { k: "spd", n: "SPEED", c: "#a855f7" }].map(ch => (
                <div key={ch.k} style={{ flex: 1, padding: "4px 6px" }}>
                  <div style={{ fontSize: 13, color: T.textMuted, letterSpacing: 1, marginBottom: 2, display: "flex", alignItems: "center", gap: 3 }}><BarChart3 size={10} /> {ch.n}</div>
                  <ResponsiveContainer width="100%" height={90}>
                    <AreaChart data={tel}><defs><linearGradient id={`gv-${ch.k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ch.c} stopOpacity={0.5} /><stop offset="100%" stopColor={ch.c} stopOpacity={0} /></linearGradient></defs><XAxis dataKey="t" hide /><YAxis hide domain={["auto","auto"]} /><Area type="monotone" dataKey={ch.k} stroke={ch.c} strokeWidth={2} fill={`url(#gv-${ch.k})`} dot={false} isAnimationActive={false} /></AreaChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
            <div style={{ width: 220, borderLeft: `1px solid ${T.border}`, padding: "6px 8px", overflow: "auto", height: "100%", minHeight: 0 }}>
              <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Activity size={12} /> {VI.log}</div>
              {logs.map((l, i) => <div key={i} style={{ fontSize: 13, padding: "2px 4px", marginBottom: 2, borderLeft: `2px solid ${l.l === "success" ? T.success : l.l === "warning" ? T.warn : T.border}`, color: T.textDim, lineHeight: 1.4 }}><span style={{ color: T.textMuted, marginRight: 4 }}>{new Date(l.t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>{l.m}</div>)}
            </div>
          </div>
        </div>
      </div>
      {showReport && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setShowReport(false)} onKeyDown={e => e.key === "Escape" && setShowReport(false)} tabIndex={-1} ref={el => el?.focus()}>
        <div style={{ background: T.bgOverlay, border: "1px solid #00e5ff40", borderRadius: 12, maxWidth: 500, width: "90%", padding: "20px 24px", fontFamily: "inherit" }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#00e5ff" }}><FileText size={14} /> MISSION DEBRIEF</div>
            <button onClick={() => setShowReport(false)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", padding: 4 }}><X size={16} /></button>
          </div>
          <pre style={{ fontSize: 13, color: T.text, lineHeight: 1.6, whiteSpace: "pre-wrap", background: T.bgCard, borderRadius: 8, padding: 14, border: `1px solid ${T.border}`, marginBottom: 14, maxHeight: 400, overflow: "auto" }}>{generateReport()}</pre>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { navigator.clipboard.writeText(generateReport()).then(() => log("Đã sao chép báo cáo", "success")).catch(() => log("Không thể sao chép", "warning")); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: "1px solid #00e5ff40", background: "#00e5ff15", color: "#00e5ff", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}><Copy size={12} /> COPY</button>
            <button onClick={() => setShowReport(false)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: `1px solid ${T.borderAccent}`, background: T.bgCard, color: T.textMuted, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}><X size={12} /> CLOSE</button>
          </div>
        </div>
      </div>}
      {showAiModal && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setShowAiModal(false)} onKeyDown={e => e.key === "Escape" && setShowAiModal(false)} tabIndex={-1} ref={el => el?.focus()}>
        <div style={{ background: T.bgOverlay, border: "1px solid #a855f740", borderRadius: 12, maxWidth: 540, width: "90%", padding: "20px 24px", fontFamily: "inherit" }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#a855f7" }}><Cpu size={14} /> AI TACTICAL DEBRIEF</div>
            <button onClick={() => setShowAiModal(false)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", padding: 4 }}><X size={16} /></button>
          </div>
          {aiDebrief === "loading" ? <div style={{ fontSize: 11, color: "#a855f7", padding: 20, textAlign: "center" }}>Analyzing simulation data...</div>
          : <pre style={{ fontSize: 13, color: T.text, lineHeight: 1.6, whiteSpace: "pre-wrap", background: T.bgCard, borderRadius: 8, padding: 14, border: `1px solid ${T.border}`, marginBottom: 14, maxHeight: 400, overflow: "auto" }}>{aiDebrief}</pre>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { if (aiDebrief && aiDebrief !== "loading") navigator.clipboard.writeText(aiDebrief).then(() => log("Đã sao chép", "success")).catch(() => {}); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: "1px solid #a855f740", background: "#a855f715", color: "#a855f7", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}><Copy size={12} /> COPY</button>
            <button onClick={() => setShowAiModal(false)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: `1px solid ${T.borderAccent}`, background: T.bgCard, color: T.textMuted, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}><X size={12} /> CLOSE</button>
          </div>
          <div style={{ fontSize: 12, color: T.textFaint, marginTop: 8, textAlign: "center" }}>Generated by Claude — {new Date().toLocaleString()}</div>
        </div>
      </div>}
      {/* AI Scenario Generator Modal */}
      {showScenarioModal && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => { setShowScenarioModal(false); setScenarioLoading(false); }} onKeyDown={e => e.key === "Escape" && (setShowScenarioModal(false), setScenarioLoading(false))} tabIndex={-1} ref={el => el?.focus()}>
        <div style={{ background: T.bgOverlay, border: "1px solid #a855f740", borderRadius: 12, maxWidth: 500, width: "90%", padding: "20px 24px", fontFamily: "inherit" }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#a855f7" }}><Brain size={14} /> {VI.aiScenario}</div>
            <button onClick={() => { setShowScenarioModal(false); setScenarioLoading(false); }} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", padding: 4 }}><X size={16} /></button>
          </div>
          {scenarioLoading ? <div style={{ textAlign: "center", padding: 30, color: "#a855f7", fontSize: 11 }}>Đang phân tích tình huống...</div> : <>
            <select value={scenarioType} onChange={e => setScenarioType(e.target.value)} style={{ width: "100%", padding: "8px 10px", marginBottom: 8, borderRadius: 6, border: `1px solid ${T.borderAccent}`, background: T.bgCard, color: T.text, fontSize: 13, fontFamily: "inherit" }}>
              {["Lũ lụt", "Sạt lở", "Bão", "Cháy rừng", "Tuần tra biển", "Tùy chỉnh"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <textarea value={scenarioInput} onChange={e => setScenarioInput(e.target.value)} placeholder="VD: Lũ lụt tại Quảng Bình, 15 điểm dân cư bị cô lập, gió cấp 8..." rows={4} style={{ width: "100%", padding: "8px 10px", marginBottom: 12, borderRadius: 6, border: `1px solid ${T.borderAccent}`, background: T.bgCard, color: T.text, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
            <button onClick={generateScenario} disabled={!scenarioInput.trim()} style={{ width: "100%", padding: "10px 0", borderRadius: 6, border: "1px solid #a855f740", background: "#a855f720", color: "#a855f7", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}>AI PHÂN TÍCH VÀ TẠO KỊCH BẢN</button>
          </>}
        </div>
      </div>}
      {/* AI Advice Toast */}
      {aiAdvice && aiAdvice !== "loading" && <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", background: T.bgOverlay, border: "1px solid #a855f740", borderRadius: 8, padding: "10px 16px", maxWidth: 400, zIndex: 100, fontFamily: "inherit" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#a855f7", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>🎖️ {VI.aiAdvisor}</div>
        {aiAdvice.map((a, i) => <div key={i} style={{ fontSize: 12, color: T.text, marginBottom: 3 }}>{i + 1}. {a}</div>)}
      </div>}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.borderAccent};border-radius:3px}button:hover{filter:brightness(1.1)}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}@keyframes logSlide{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}input[type=range]{appearance:none;background:${T.border};border-radius:2px;outline:none}input[type=range]::-webkit-slider-thumb{appearance:none;width:12px;height:12px;border-radius:50%;background:${T.accent};cursor:pointer}`}</style>
    </div>
  );
}
