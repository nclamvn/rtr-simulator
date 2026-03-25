import { useState, useEffect, useRef, useCallback } from "react";
import {
  Radar, Radio, Battery, Signal, Navigation, Target, AlertTriangle,
  Play, Pause, RotateCcw, Crosshair, Zap, Shield, Plane,
  Cpu, Gauge, Activity, Layers, Clock, Users, Box, ArrowUpRight,
  BarChart3, Compass, Maximize2, Eye, MapPin, FileText, Plus, Copy, X,
  Wind, UserPlus, Home, Shuffle, CircleDot, Film, Volume2, CheckCircle, Circle,
  Brain, GitBranch, Sparkles,
} from "lucide-react";
import { XAxis, YAxis, ResponsiveContainer, Area, AreaChart } from "recharts";

const PI2 = Math.PI * 2;
const DEG = Math.PI / 180;

const VI = {
  missions: "NHIỆM VỤ", fleet: "ĐỘI HÌNH", god: "CHỈ HUY", track: "THEO DÕI", noTrk: "CHƯA CHỌN",
  log: "NHẬT KÝ", battery: "PIN", altitude: "ĐỘ CAO", speed: "TỐC ĐỘ", signal: "TÍN HIỆU",
  heading: "HƯỚNG", bank: "NGHIÊNG", pause: "DỪNG", run: "CHẠY",
  friendly: "TA", hostile: "ĐỊCH", rescue: "CỨU HỘ", phase: "GIAI ĐOẠN", objective: "MỤC TIÊU",
  elapsed: "T.GIAN", weather: "THỜI TIẾT", adversary: "ĐỐI PHƯƠNG", electronic: "TÁC CHIẾN ĐT",
  fleetCmd: "LỆNH ĐỘI HÌNH", inject: "+ ĐE DỌA", spawnBogey: "MỤC TIÊU", gpsDeny: "CHẶN GPS",
  rtb: "VỀ CĂN CỨ", scatter: "PHÂN TÁN", formUp: "TẬP HỢP", report: "BÁO CÁO",
  aiDebrief: "AI PHÂN TÍCH", aiScenario: "AI TẠO KỊCH BẢN", aiAdvisor: "AI CỐ VẤN",
  graph: "ĐỒ THỊ TRI THỨC", emergence: "HÀNH VI NỔI TRỘI", experience: "KINH NGHIỆM",
  agentMem: "BỘ NHỚ AGENT", demo: "DEMO", missionComplete: "NHIỆM VỤ HOÀN THÀNH",
  subtitle: "Hệ thống mô phỏng UAV đa nhiệm vụ",
  clickTrack: "Chọn drone để theo dõi", selectMission: "Chọn nhiệm vụ",
};

const DRONE_SPECS = {
  "HERA-S": { name: "HERA Scout", maxSpeed: 22, cruiseSpeed: 15, maxAlt: 500, endurance: 45, rcs: 0.01, sensors: ["EO/IR","LiDAR"], color: "#00e5ff", iff: "FRIENDLY" },
  "HERA-C": { name: "HERA Cargo", maxSpeed: 16, cruiseSpeed: 11, maxAlt: 300, endurance: 30, rcs: 0.05, sensors: ["GPS","Alt"], color: "#ffb020", iff: "FRIENDLY" },
  "VEGA-X": { name: "Vega Combat", maxSpeed: 30, cruiseSpeed: 22, maxAlt: 800, endurance: 35, rcs: 0.008, sensors: ["EO/IR","SAR","ESM"], color: "#ff3b5c", iff: "FRIENDLY" },
  "BOGEY":  { name: "Unknown UAV", maxSpeed: 20, cruiseSpeed: 14, maxAlt: 400, endurance: 40, rcs: 0.03, sensors: [], color: "#ff6b35", iff: "HOSTILE" },
};

class FlightDynamics {
  constructor(spec, x, y, alt, hdg) {
    this.spec = spec; this.x = x; this.y = y; this.alt = alt; this.hdg = hdg;
    this.speed = spec.cruiseSpeed * 0.5; this.vs = 0; this.bank = 0;
    this.targetHdg = hdg; this.targetAlt = alt; this.targetSpeed = spec.cruiseSpeed;
    this.battery = 95 + Math.random() * 5; this.signal = 92 + Math.random() * 8; this.gLoad = 1.0;
    this.windX = 0; this.windY = 0;
  }
  update(dt) {
    const hdgErr = ((this.targetHdg - this.hdg + 540) % 360) - 180;
    const tr = Math.max(-3, Math.min(3, hdgErr * 0.8));
    this.bank = tr * 10;
    this.hdg = (this.hdg + tr * dt + 360) % 360;
    this.gLoad = 1 / Math.cos(Math.abs(this.bank) * DEG);
    this.speed = Math.max(0, Math.min(this.spec.maxSpeed, this.speed + Math.max(-2, Math.min(1.5, (this.targetSpeed - this.speed) * 0.5)) * dt));
    this.vs = Math.max(-5, Math.min(5, (this.targetAlt - this.alt) * 0.3));
    this.alt = Math.max(10, Math.min(this.spec.maxAlt, this.alt + this.vs * dt));
    const r = this.hdg * DEG;
    this.x += (Math.sin(r) * this.speed + this.windX) * dt;
    this.y += (Math.cos(r) * this.speed + this.windY) * dt;
    // Headwind detection: wind component opposing flight direction
    const headwind = -(this.windX * Math.sin(r) + this.windY * Math.cos(r));
    const drainMul = headwind > 5 ? 1.5 : 1.0;
    this.battery = Math.max(0, this.battery - 0.03 * (this.speed / this.spec.cruiseSpeed) * (1 + Math.abs(this.vs) * 0.1) * drainMul * dt);
    this.signal = Math.max(20, Math.min(100, this.signal + (Math.random() - 0.5) * 1.5));
  }
}

class SwarmController {
  constructor() { this.drones = []; this.waypoints = []; this.threats = []; this.perDroneWP = new Map(); }
  addDrone(id, typeKey, x, y, alt, hdg) {
    const spec = DRONE_SPECS[typeKey];
    this.drones.push({ id, typeKey, spec, fd: new FlightDynamics(spec, x, y, alt || 150, hdg || Math.random() * 360), wpIdx: 0, status: "ACTIVE", trail: [],
      memory: { sectorsVisited: new Set(), threatsEncountered: new Set(), eliminationCount: 0, distanceTraveled: 0, timeInDangerZone: 0, closeCallCount: 0, missionPhases: 0, experienceScore: 0,
        personality: { aggression: Math.random(), autonomy: Math.random(), teamwork: Math.random() } } });
  }
  assignWaypoints(w) { this.waypoints = w; }
  setThreats(t) { this.threats = t; }
  update(dt) {
    for (const d of this.drones) {
      if (d.status !== "ACTIVE") continue;

      // SPEC-C: Adversary AI — hostiles intercept nearest friendly
      if (d.spec.iff === "HOSTILE") {
        let nearest = null, nearestDist = Infinity;
        for (const o of this.drones) {
          if (o.spec.iff !== "FRIENDLY") continue;
          const dist = Math.hypot(d.fd.x - o.fd.x, d.fd.y - o.fd.y);
          if (dist < nearestDist) { nearest = o; nearestDist = dist; }
        }
        if (nearest) {
          d.fd.targetHdg = (Math.atan2(nearest.fd.x - d.fd.x, nearest.fd.y - d.fd.y) / DEG + 360) % 360;
          d.fd.targetSpeed = d.spec.maxSpeed * 0.8;
        }
      } else {
        // Per-drone waypoint (e.g., Light Show, Form Up)
        const pdwp = this.perDroneWP.get(d.id);
        if (pdwp) {
          const dx = pdwp.x - d.fd.x, dy = pdwp.y - d.fd.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 15) { d.fd.targetSpeed = 0.5; }
          else { d.fd.targetHdg = (Math.atan2(dx, dy) / DEG + 360) % 360; d.fd.targetSpeed = dist > 100 ? d.spec.cruiseSpeed : d.spec.cruiseSpeed * 0.4; }
          d.fd.targetAlt = pdwp.alt || 150;
        } else if (d.typeKey === "HERA-S" && this.drones.some(o => o.typeKey === "HERA-C" && o.status === "ACTIVE")) {
          // Escort behavior: HERA-S orbits nearest HERA-C cargo
          let nearestCargo = null, nd = Infinity;
          for (const o of this.drones) {
            if (o.typeKey !== "HERA-C" || o.status !== "ACTIVE") continue;
            const dist = Math.hypot(d.fd.x - o.fd.x, d.fd.y - o.fd.y);
            if (dist < nd) { nearestCargo = o; nd = dist; }
          }
          if (nearestCargo) {
            const orbitAngle = (Date.now() * 0.001 + d.id.charCodeAt(d.id.length - 1)) % PI2;
            const ox = nearestCargo.fd.x + Math.cos(orbitAngle) * 40;
            const oy = nearestCargo.fd.y + Math.sin(orbitAngle) * 40;
            d.fd.targetHdg = (Math.atan2(ox - d.fd.x, oy - d.fd.y) / DEG + 360) % 360;
            d.fd.targetSpeed = d.spec.cruiseSpeed * 0.7;
            d.fd.targetAlt = nearestCargo.fd.alt + 20;
          }
        } else if (this.waypoints.length > 0) {
          // Shared waypoint navigation (friendlies only)
          const wp = this.waypoints[d.wpIdx % this.waypoints.length];
          const dx = wp.x - d.fd.x, dy = wp.y - d.fd.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 30) d.wpIdx = (d.wpIdx + 1) % this.waypoints.length;
          else { d.fd.targetHdg = (Math.atan2(dx, dy) / DEG + 360) % 360; d.fd.targetSpeed = dist > 200 ? d.spec.cruiseSpeed : d.spec.cruiseSpeed * 0.6; }
          d.fd.targetAlt = wp.alt || 150;
        }
      }

      // Separation — personality: teamwork affects distance
      const sepDist = d.memory ? (d.memory.personality.teamwork > 0.7 ? 20 : d.memory.personality.teamwork < 0.3 ? 35 : 25) : 25;
      for (const o of this.drones) {
        if (o.id === d.id) continue;
        const sx = d.fd.x - o.fd.x, sy = d.fd.y - o.fd.y, sd = Math.sqrt(sx * sx + sy * sy);
        if (sd < sepDist && sd > 0) d.fd.targetHdg = (d.fd.targetHdg + ((Math.atan2(sx, sy) / DEG + 360) % 360 - d.fd.targetHdg) * ((sepDist - sd) / sepDist) * 0.3 + 360) % 360;
      }

      // Combat: VEGA-X eliminates nearby HOSTILE
      if (d.typeKey === "VEGA-X" && d.spec.iff === "FRIENDLY") {
        for (const o of this.drones) {
          if (o.spec.iff !== "HOSTILE" || o.status !== "ACTIVE") continue;
          if (Math.hypot(d.fd.x - o.fd.x, d.fd.y - o.fd.y) < 15) {
            o.status = "ELIMINATED";
            if (d.memory) d.memory.eliminationCount++;
            if (this.onEliminate) this.onEliminate(o.id, d.id);
          }
        }
      }

      // Threat avoidance — personality: aggression affects evade radius
      const evadeMul = d.memory ? (d.memory.personality.aggression < 0.3 ? 1.5 : d.memory.personality.aggression > 0.7 ? 0.8 : 1.2) : 1.2;
      for (const t of this.threats) {
        const tx = d.fd.x - t.x, ty = d.fd.y - t.y, td = Math.sqrt(tx * tx + ty * ty);
        if (td < t.radius * evadeMul) {
          d.fd.targetHdg = (Math.atan2(tx, ty) / DEG + 360) % 360;
          d.fd.targetSpeed = d.spec.maxSpeed;
          d.fd.targetAlt = Math.min(d.spec.maxAlt, d.fd.alt + 50);
        }
        // GPS-DENY zone: signal degrades, speed penalty
        if (t.type.includes("GPS") && td < t.radius) {
          d.fd.signal = Math.max(5, d.fd.signal - 2 * dt);
          d.fd.targetSpeed = Math.min(d.fd.targetSpeed, d.spec.cruiseSpeed * 0.7);
        }
      }

      // Autonomy: high-autonomy drones occasionally deviate heading
      if (d.memory && d.memory.personality.autonomy > 0.7 && Math.random() < 0.1 * dt) {
        d.fd.targetHdg = (d.fd.targetHdg + (Math.random() - 0.5) * 30 + 360) % 360;
      }

      // Agent memory updates
      if (d.memory) {
        d.memory.distanceTraveled += d.fd.speed * dt;
        const sid = `${Math.floor((d.fd.x + 400) / 200)}-${Math.floor((d.fd.y + 400) / 200)}`;
        d.memory.sectorsVisited.add(sid);
        for (const t of this.threats) {
          const td2 = Math.hypot(d.fd.x - t.x, d.fd.y - t.y);
          if (td2 < t.radius) d.memory.timeInDangerZone += dt;
          if (td2 < t.radius * 0.5) d.memory.threatsEncountered.add(t.type);
        }
        for (const o of this.drones) {
          if (o.spec.iff === "HOSTILE" && o.status === "ACTIVE" && Math.hypot(d.fd.x - o.fd.x, d.fd.y - o.fd.y) < 20) d.memory.closeCallCount++;
        }
        d.memory.experienceScore = Math.min(100, Math.max(0,
          d.memory.sectorsVisited.size * 5 + d.memory.eliminationCount * 15 + d.memory.distanceTraveled * 0.005 + d.memory.missionPhases * 10 - d.memory.closeCallCount * 2));
      }

      d.fd.update(dt);
      d.trail.push({ x: d.fd.x, y: d.fd.y }); if (d.trail.length > 80) d.trail.shift();
    }
  }
}

// ═══════════════════════════════════════════
// KNOWLEDGE GRAPH
// ═══════════════════════════════════════════
class KnowledgeGraph {
  constructor() { this.nodes = new Map(); this.edges = []; }
  addNode(id, type, label, data = {}) { this.nodes.set(id, { type, label, data, createdAt: Date.now() }); }
  updateNode(id, data) { const n = this.nodes.get(id); if (n) Object.assign(n.data, data); }
  addEdge(from, to, relation, weight = 1) { this.edges.push({ from, to, relation, weight, timestamp: Date.now() }); }
  removeEdges(relation) { this.edges = this.edges.filter(e => e.relation !== relation); }
  getNeighbors(id, relation) { return this.edges.filter(e => (e.from === id || e.to === id) && (!relation || e.relation === relation)).map(e => e.from === id ? e.to : e.from); }
  query(type) { return [...this.nodes.entries()].filter(([, n]) => n.type === type).map(([id, n]) => ({ id, ...n })); }
  addEvent(desc, involved = []) {
    const events = this.query("event");
    if (events.length >= 100) { const oldest = events[0]; this.nodes.delete(oldest.id); this.edges = this.edges.filter(e => e.from !== oldest.id && e.to !== oldest.id); }
    const eid = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.addNode(eid, "event", desc, { timestamp: Date.now() });
    for (const nid of involved) this.addEdge(eid, nid, "involves");
    return eid;
  }
  toSummary() {
    const types = {}; for (const [, n] of this.nodes) types[n.type] = (types[n.type] || 0) + 1;
    const rels = {}; for (const e of this.edges) rels[e.relation] = (rels[e.relation] || 0) + 1;
    const sectors = this.query("sector");
    const mostVisited = sectors.reduce((best, s) => (s.data.visitCount || 0) > (best?.data.visitCount || 0) ? s : best, null);
    const leastVisited = sectors.reduce((least, s) => (s.data.visitCount || 0) < (least?.data.visitCount || Infinity) ? s : least, null);
    return { nodeCount: this.nodes.size, edgeCount: this.edges.length, types, rels, mostVisited: mostVisited?.label, leastVisited: leastVisited?.label, mostVisitCount: mostVisited?.data.visitCount || 0, leastVisitCount: leastVisited?.data.visitCount || 0 };
  }
}

// ═══════════════════════════════════════════
// EMERGENCE DETECTOR
// ═══════════════════════════════════════════
class EmergenceDetector {
  constructor() { this.events = []; this.lastPatterns = []; }
  analyze(drones) {
    const active = drones.filter(d => d.status === "ACTIVE" && d.spec.iff === "FRIENDLY");
    if (active.length < 3) return [];
    const patterns = [];
    // Clustering
    const clusters = this.findClusters(active, 60);
    if (clusters.length >= 2 && clusters.some(c => c.length >= 3))
      patterns.push({ type: "SPLIT", desc: `Fleet split into ${clusters.length} groups` });
    // Herding
    const hdgs = active.map(d => d.fd.hdg);
    const hdgStd = this.circularStdDev(hdgs);
    if (hdgStd < 20) patterns.push({ type: "HERDING", desc: `Coordinated movement, spread ${Math.round(hdgStd)}°` });
    // Retreat detection — center of mass moving away from threats
    if (drones.some(d => d.spec.iff === "HOSTILE" && d.status === "ACTIVE")) {
      const cx = active.reduce((s, d) => s + d.fd.x, 0) / active.length;
      const cy = active.reduce((s, d) => s + d.fd.y, 0) / active.length;
      const avgHdg = Math.atan2(active.reduce((s, d) => s + Math.sin(d.fd.hdg * DEG), 0), active.reduce((s, d) => s + Math.cos(d.fd.hdg * DEG), 0));
      const hostiles = drones.filter(d => d.spec.iff === "HOSTILE" && d.status === "ACTIVE");
      const hx = hostiles.reduce((s, d) => s + d.fd.x, 0) / hostiles.length;
      const hy = hostiles.reduce((s, d) => s + d.fd.y, 0) / hostiles.length;
      const awayAngle = Math.atan2(cx - hx, cy - hy);
      if (Math.abs(avgHdg - awayAngle) < 0.5) patterns.push({ type: "RETREAT", desc: "Fleet retreating from hostiles" });
    }
    // Deduplicate vs last analysis
    const newPatterns = patterns.filter(p => !this.lastPatterns.some(lp => lp.type === p.type));
    this.lastPatterns = patterns;
    for (const p of newPatterns) { p.timestamp = Date.now(); this.events.push(p); }
    // Keep last 20 events
    if (this.events.length > 20) this.events = this.events.slice(-20);
    return newPatterns;
  }
  findClusters(drones, radius) {
    const visited = new Set(); const clusters = [];
    for (const d of drones) {
      if (visited.has(d.id)) continue;
      const cluster = [d]; visited.add(d.id); const queue = [d];
      while (queue.length) { const cur = queue.shift(); for (const o of drones) { if (visited.has(o.id)) continue; if (Math.hypot(cur.fd.x - o.fd.x, cur.fd.y - o.fd.y) < radius) { visited.add(o.id); cluster.push(o); queue.push(o); } } }
      clusters.push(cluster);
    }
    return clusters;
  }
  circularStdDev(angles) {
    if (angles.length < 2) return 360;
    const rads = angles.map(a => a * DEG);
    const s = rads.reduce((acc, r) => acc + Math.sin(r), 0) / rads.length;
    const c = rads.reduce((acc, r) => acc + Math.cos(r), 0) / rads.length;
    const R = Math.sqrt(s * s + c * c);
    return R > 0.999 ? 0 : Math.sqrt(-2 * Math.log(Math.max(0.001, R))) / DEG;
  }
  getRecent(maxAge = 8000) { return this.events.filter(e => Date.now() - e.timestamp < maxAge); }
}

// ═══════════════════════════════════════════
// MISSION PHASE ENGINE
// ═══════════════════════════════════════════
class MissionPhaseEngine {
  constructor(phases) {
    this.phases = phases;
    this.currentPhase = 0;
    this.phaseStartTime = 0;
    this.completed = false;
    this.objectiveStatus = {};
  }
  getCurrentPhase() { return this.phases[this.currentPhase] || null; }
  checkObjectives(drones, threats) {
    const phase = this.getCurrentPhase();
    if (!phase || this.completed) return;
    for (const obj of (phase.objectives || [])) {
      if (!this.objectiveStatus[obj.id]) {
        this.objectiveStatus[obj.id] = obj.check(drones, threats);
      }
    }
  }
  checkTransition(elapsed, drones, threats) {
    if (this.completed) return null;
    const phase = this.getCurrentPhase();
    if (!phase) return null;
    const met = phase.transition(elapsed - this.phaseStartTime, drones, threats, this.objectiveStatus);
    if (met) {
      this.currentPhase++;
      this.phaseStartTime = elapsed;
      if (this.currentPhase >= this.phases.length) {
        this.completed = true;
        return { type: "MISSION_COMPLETE" };
      }
      return { type: "PHASE_ADVANCE", phase: this.phases[this.currentPhase] };
    }
    return null;
  }
}

// ═══════════════════════════════════════════
// RADAR PPI — phosphor persistence effect
// ═══════════════════════════════════════════
function RadarPPI({ drones, threats, waypoints, radarRange, selectedId, onSelect, onAddWaypoint, wind, graphOverlay, kg }) {
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

      ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(0, 0, S, S);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R + 2, 0, PI2); ctx.clip();

      for (let i = 1; i <= 5; i++) {
        const r = (R / 5) * i;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, PI2);
        ctx.strokeStyle = `rgba(0,220,100,${i === 5 ? 0.45 : 0.18})`; ctx.lineWidth = i === 5 ? 1.5 : 0.7; ctx.stroke();
        ctx.fillStyle = "rgba(0,255,120,0.5)"; ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText(`${Math.round((radarRange / 5) * i)}`, cx, cy - r + 12);
      }
      for (let deg = 0; deg < 360; deg += 10) {
        const a = deg * DEG - Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (deg % 30 === 0 ? R - 8 : R - 4), cy + Math.sin(a) * (deg % 30 === 0 ? R - 8 : R - 4));
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.strokeStyle = deg % 30 === 0 ? "rgba(0,220,100,0.45)" : "rgba(0,220,100,0.18)"; ctx.lineWidth = 0.5; ctx.stroke();
        if (deg % 90 === 0) {
          ctx.fillStyle = "rgba(0,255,140,0.8)"; ctx.font = "bold 10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText({ 0: "N", 90: "E", 180: "S", 270: "W" }[deg], cx + Math.cos(a) * (R + 15), cy + Math.sin(a) * (R + 15));
        }
      }
      ctx.strokeStyle = "rgba(0,220,100,0.12)"; ctx.lineWidth = 0.5;
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
      g.addColorStop(0, "rgba(0,255,100,0)"); g.addColorStop(0.85, "rgba(0,255,100,0.1)"); g.addColorStop(1, "rgba(0,255,100,0.25)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, sa - 0.35, sa); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(sa) * R, Math.sin(sa) * R);
      ctx.strokeStyle = "rgba(0,255,120,1.0)"; ctx.lineWidth = 2; ctx.stroke();
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
        const rgb = c.iff === "HOSTILE" ? "255,60,60" : "0,255,120";
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
      ctx.fillStyle = "rgba(0,255,140,0.6)"; ctx.font = "9px monospace";
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
function Viewport3D({ drones, threats, waypoints, selectedId, camMode, windSpd }) {
  const mountRef = useRef(null);
  const dRef = useRef(drones); const tRef = useRef(threats); const wRef = useRef(waypoints);
  const sRef = useRef(selectedId); const cmRef = useRef(camMode || "orbit"); const wsRef = useRef(windSpd || 0);
  const objsRef = useRef(new Map()); const trailsRef = useRef(new Map()); const tmpRef = useRef([]);
  const exhaustRef = useRef(new Map()); const threatPartRef = useRef(new Map());
  const burstRef = useRef(new Map()); const alertedRef = useRef(new Set());
  const audioRef = useRef({ prop: 0, wind: 0, alert: 0 });
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
    const scene = new T.Scene();
    scene.fog = new T.FogExp2(0x070e1a, 0.0004);
    scene.background = new T.Color(0x070e1a);
    const cam = new T.PerspectiveCamera(55, w / h, 1, 5000); cam.position.set(0, 500, 350);
    const ren = new T.WebGLRenderer({ antialias: true, alpha: true });
    ren.setSize(w, h); ren.setPixelRatio(Math.min(devicePixelRatio, 2));
    ren.toneMapping = T.ACESFilmicToneMapping; ren.toneMappingExposure = 1.2;
    m.appendChild(ren.domElement);

    // SPEC-A Fallback: enhanced lighting
    scene.add(new T.AmbientLight(0x3050a0, 0.5));
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
    scene.add(new T.Points(starGeo, new T.PointsMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, size: 1.5, sizeAttenuation: true })));

    // SPEC-F: Ground glow plane
    const gndGlow = new T.Mesh(new T.PlaneGeometry(2000, 2000), new T.MeshBasicMaterial({ color: 0x041210, transparent: true, opacity: 0.3 }));
    gndGlow.rotation.x = -Math.PI / 2; gndGlow.position.y = -1; scene.add(gndGlow);

    // Grid + terrain
    scene.add(new T.GridHelper(1600, 40, 0x1a5050, 0x0a2a2a));
    const tg = new T.PlaneGeometry(1600, 1600, 80, 80); tg.rotateX(-Math.PI / 2);
    const vt = tg.attributes.position;
    for (let i = 0; i < vt.count; i++) { const px = vt.getX(i), pz = vt.getZ(i); vt.setY(i, Math.sin(px * 0.005) * Math.cos(pz * 0.004) * 18 + Math.sin(px * 0.012 + pz * 0.008) * 10); }
    tg.computeVertexNormals();
    scene.add(new T.Mesh(tg, new T.MeshPhongMaterial({ color: 0x0a2a1a, transparent: true, opacity: 0.6, flatShading: true })));

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
    <div style={{ position: "absolute", bottom: 8, left: 8, background: "#000000aa", borderRadius: 6, padding: "5px 8px", fontSize: 7, fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 3, zIndex: 2 }}>
      {[["PROP", au.prop, "#00e5ff"], ["WIND", au.wind, "#00e878"], ["ALERT", au.alert, "#ff3b5c"]].map(([label, val, color]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Volume2 size={7} color={color} />
          <span style={{ color: "#7090b0", width: 28 }}>{label}</span>
          <div style={{ width: 60, height: 3, background: "#222", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${Math.round((val || 0) * 100)}%`, height: "100%", background: color, borderRadius: 2 }} />
          </div>
          <span style={{ color: "#7090b0", width: 22, textAlign: "right" }}>{Math.round((val || 0) * 100)}%</span>
        </div>
      ))}
    </div>
  </div>;
}

// ═══════════════════════════════════════════
// MISSIONS
// ═══════════════════════════════════════════
const MISSIONS = [
  // ── RESCUE PRESET MISSIONS (Demo Bộ Quốc Phòng) ──
  { id: "flood_qb", name: "Lũ lụt Quảng Bình", domain: "RESCUE", icon: Sparkles, multi: true,
    desc: "4 giai đoạn: trinh sát → xác định nạn nhân → cứu hộ → rút lui",
    drones: Array.from({ length: 6 }, (_, i) => ({ id: `TS-${i+1}`, type: "HERA-S", x: -20+i*8, y: -20, alt: 150, hdg: 45 })),
    waypoints: [{ x: 200, y: 150, alt: 150 }, { x: -150, y: 200, alt: 140 }, { x: 250, y: -100, alt: 160 }, { x: -200, y: -150, alt: 130 }, { x: 100, y: 250, alt: 150 }, { x: -100, y: 100, alt: 140 }],
    threats: [{ x: 200, y: 150, radius: 80, type: "Vùng ngập sâu" }, { x: -150, y: 250, radius: 50, type: "Sạt lở" }],
    phases: [
      { name: "Trinh sát vùng lũ", briefing: "6 drone trinh sát 6 điểm dân cư bị cô lập",
        weather: { windSpeed: 15, windDir: 90 },
        objectives: [{ id: "scout", desc: "Trinh sát 6 điểm dân cư", check: (dr) => dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE").every(d=>d.fd.speed>3) }],
        transition: (pt) => pt > 20 },
      { name: "Xác định nạn nhân", briefing: "Tăng cường tìm kiếm, định vị cụm nạn nhân",
        spawns: [{ id: "TS-7", type: "HERA-S", x: 0, y: -30, alt: 150, hdg: 45 }, { id: "TS-8", type: "HERA-S", x: 10, y: -30, alt: 150, hdg: 45 }],
        waypoints: [{ x: 180, y: 120, alt: 130 }, { x: -120, y: 180, alt: 120 }, { x: 220, y: -80, alt: 140 }, { x: -180, y: -120, alt: 130 }],
        threats: [{ x: 50, y: 100, radius: 60, type: "Gió giật" }],
        objectives: [{ id: "locate", desc: "Định vị 4 cụm nạn nhân", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"&&d.memory); return f.length>0&&f.reduce((s,d)=>s+d.memory.sectorsVisited.size,0)/f.length>=4; } }],
        transition: (_,__,___,os) => os["locate"] },
      { name: "Cứu hộ & Vận chuyển", briefing: "4 drone cargo + 2 hộ tống triển khai cứu trợ",
        spawns: [
          { id: "CH-1", type: "HERA-C", x: 0, y: -40, alt: 100, hdg: 45 }, { id: "CH-2", type: "HERA-C", x: 10, y: -40, alt: 100, hdg: 45 },
          { id: "CH-3", type: "HERA-C", x: 20, y: -40, alt: 100, hdg: 45 }, { id: "CH-4", type: "HERA-C", x: 30, y: -40, alt: 100, hdg: 45 },
          { id: "HT-1", type: "VEGA-X", x: -10, y: -50, alt: 160, hdg: 45 }, { id: "HT-2", type: "VEGA-X", x: 40, y: -50, alt: 160, hdg: 45 },
        ],
        cargoWP: [{ x: 180, y: 120, alt: 100 }, { x: -120, y: 180, alt: 100 }, { x: 220, y: -80, alt: 100 }, { x: -180, y: -120, alt: 100 }],
        objectives: [{ id: "deliver", desc: "Giao hàng cứu trợ 4 điểm", check: (dr) => { const c=dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE"); return c.length>0&&c.every(d=>{ const wp=[[180,120],[-120,180],[220,-80],[-180,-120]]; return wp.some(w=>Math.hypot(d.fd.x-w[0],d.fd.y-w[1])<40); }); } }],
        transition: (_,__,___,os) => os["deliver"] },
      { name: "Rút lui an toàn", briefing: "Toàn bộ fleet RTB về Sở Chỉ Huy",
        waypoints: [{ x: 0, y: 0, alt: 120 }], clearThreats: true,
        weather: { windSpeed: 5, windDir: 90 },
        objectives: [{ id: "rtb_safe", desc: "80% fleet về căn cứ", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x,d.fd.y)<80).length>=f.length*0.8; } }],
        transition: (_,__,___,os) => os["rtb_safe"] },
    ],
  },
  { id: "landslide_qn", name: "Sạt lở Quảng Nam", domain: "RESCUE", icon: Sparkles, multi: true,
    desc: "3 giai đoạn: đánh giá → tìm kiếm → vận chuyển y tế",
    drones: Array.from({ length: 4 }, (_, i) => ({ id: `SL-S${i+1}`, type: "HERA-S", x: -10+i*8, y: -15, alt: 140, hdg: 30 })),
    waypoints: [{ x: 150, y: 180, alt: 120 }, { x: 200, y: 220, alt: 130 }, { x: 100, y: 250, alt: 120 }],
    threats: [{ x: 180, y: 200, radius: 100, type: "Sạt lở chính" }, { x: 120, y: 280, radius: 70, type: "Nguy cơ sạt thêm" }],
    phases: [
      { name: "Đánh giá hiện trường", briefing: "4 drone trinh sát vùng sạt lở",
        weather: { windSpeed: 8, windDir: 45 },
        objectives: [{ id: "assess", desc: "Đánh giá hiện trường sạt lở", check: () => true }],
        transition: (pt) => pt > 15 },
      { name: "Tìm kiếm người mất tích", briefing: "Quét toàn bộ khu vực — tìm nạn nhân",
        spawns: [
          ...Array.from({ length: 4 }, (_, i) => ({ id: `SL-S${i+5}`, type: "HERA-S", x: i*10, y: -25, alt: 130, hdg: 30 })),
          { id: "SL-C1", type: "HERA-C", x: -20, y: -30, alt: 100, hdg: 30 }, { id: "SL-C2", type: "HERA-C", x: 20, y: -30, alt: 100, hdg: 30 },
        ],
        waypoints: [{ x: 100, y: 150, alt: 100 }, { x: 200, y: 150, alt: 110 }, { x: 200, y: 250, alt: 100 }, { x: 100, y: 250, alt: 110 }],
        objectives: [{ id: "search", desc: "Quét 10/16 sectors", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"&&d.memory); const total=new Set(); f.forEach(d=>d.memory.sectorsVisited.forEach(s=>total.add(s))); return total.size>=10; } }],
        transition: (_,__,___,os) => os["search"] },
      { name: "Vận chuyển cấp cứu", briefing: "HERA-C bay đến 3 điểm y tế",
        cargoWP: [{ x: 150, y: 180, alt: 80 }, { x: 200, y: 220, alt: 80 }, { x: 100, y: 250, alt: 80 }],
        clearThreats: true,
        objectives: [{ id: "medevac", desc: "Hoàn thành 3 chuyến y tế", check: (dr) => { const c=dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE"); return c.length>0&&c.every(d=>[[150,180],[200,220],[100,250]].some(w=>Math.hypot(d.fd.x-w[0],d.fd.y-w[1])<40)); } }],
        transition: (_,__,___,os) => os["medevac"] },
    ],
  },
  { id: "patrol_ts", name: "Tuần tra Trường Sa", domain: "MIL", icon: Shield, multi: true,
    desc: "3 giai đoạn: trinh sát biển → phát hiện tàu lạ → báo cáo RTB",
    drones: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `TT-S${i+1}`, type: "HERA-S", x: -30+i*12, y: -20, alt: 200, hdg: 0 })),
      { id: "TT-V1", type: "VEGA-X", x: -20, y: -40, alt: 250, hdg: 0 }, { id: "TT-V2", type: "VEGA-X", x: 20, y: -40, alt: 250, hdg: 0 },
    ],
    waypoints: [{ x: -250, y: -250, alt: 200 }, { x: 250, y: -250, alt: 200 }, { x: 250, y: 250, alt: 200 }, { x: -250, y: 250, alt: 200 }],
    threats: [], phases: [
      { name: "Trinh sát vùng biển", briefing: "8 drone tuần tra vùng biển Trường Sa",
        weather: { windSpeed: 12, windDir: 180 },
        objectives: [{ id: "patrol", desc: "Hoàn thành vòng tuần tra", check: () => true }],
        transition: (pt) => pt > 20 },
      { name: "Phát hiện tàu lạ", briefing: "4 tàu không xác định — VEGA-X tiếp cận xác minh",
        spawns: [
          { id: "TL-1", type: "BOGEY", x: 320, y: 280, alt: 150, hdg: 225 }, { id: "TL-2", type: "BOGEY", x: 300, y: -300, alt: 160, hdg: 135 },
          { id: "TL-3", type: "BOGEY", x: -310, y: 270, alt: 140, hdg: 315 }, { id: "TL-4", type: "BOGEY", x: -290, y: -280, alt: 170, hdg: 45 },
        ],
        threats: [{ x: 0, y: 200, radius: 90, type: "Vùng tranh chấp" }],
        objectives: [{ id: "identify", desc: "Xác minh 4 mục tiêu", check: (dr) => { const h=dr.filter(d=>d.id.startsWith("TL")); return h.length>0&&h.every(d=>d.status==="ELIMINATED"); } }],
        transition: (_,__,___,os) => os["identify"] },
      { name: "Báo cáo & RTB", briefing: "Hoàn thành báo cáo — fleet về căn cứ",
        waypoints: [{ x: 0, y: 0, alt: 150 }], clearThreats: true,
        objectives: [{ id: "rtb_ts", desc: "80% fleet RTB an toàn", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x,d.fd.y)<80).length>=f.length*0.8; } }],
        transition: (_,__,___,os) => os["rtb_ts"] },
    ],
  },
  // ── EXISTING MISSIONS ──
  { id: "alpha", name: "Alpha Recon", domain: "MIL", icon: Target, desc: "8 drones ISR — 1 BOGEY in AO",
    drones: [
      { id: "HERA-01", type: "HERA-S", x: -50, y: -50, alt: 200, hdg: 45 }, { id: "HERA-02", type: "HERA-S", x: -30, y: -60, alt: 180, hdg: 50 },
      { id: "HERA-03", type: "HERA-S", x: 20, y: -40, alt: 220, hdg: 90 }, { id: "HERA-04", type: "HERA-S", x: 40, y: -30, alt: 190, hdg: 85 },
      { id: "VEGA-01", type: "VEGA-X", x: 0, y: -80, alt: 300, hdg: 10 }, { id: "VEGA-02", type: "VEGA-X", x: -20, y: -90, alt: 280, hdg: 5 },
      { id: "HERA-C1", type: "HERA-C", x: -100, y: -100, alt: 100, hdg: 45 }, { id: "BOGEY-1", type: "BOGEY", x: 280, y: 200, alt: 250, hdg: 210 },
    ],
    waypoints: [{ x: 200, y: 150, alt: 200 }, { x: 300, y: -100, alt: 250 }, { x: 100, y: -250, alt: 180 }, { x: -150, y: -100, alt: 200 }],
    threats: [{ x: 260, y: 60, radius: 80, type: "SAM" }, { x: -100, y: 200, radius: 60, type: "EWR" }],
  },
  { id: "swarm", name: "Swarm Assault", domain: "MIL", icon: Zap, desc: "20+4 saturate target zone",
    drones: [...Array.from({ length: 20 }, (_, i) => ({ id: `SW-${String(i + 1).padStart(2, "0")}`, type: i < 12 ? "VEGA-X" : i < 16 ? "HERA-S" : "HERA-C", x: -200 + (i % 5) * 35, y: -250 + Math.floor(i / 5) * 35, alt: 150 + Math.random() * 100, hdg: 30 + Math.random() * 20 })),
      { id: "BOGEY-A", type: "BOGEY", x: 300, y: 250, alt: 200, hdg: 240 }, { id: "BOGEY-B", type: "BOGEY", x: 280, y: 280, alt: 180, hdg: 250 }, { id: "BOGEY-C", type: "BOGEY", x: 320, y: 230, alt: 220, hdg: 230 }, { id: "BOGEY-D", type: "BOGEY", x: 350, y: 260, alt: 190, hdg: 245 }],
    waypoints: [{ x: 280, y: 250, alt: 200 }, { x: 300, y: 200, alt: 260 }, { x: 260, y: 300, alt: 180 }],
    threats: [{ x: 280, y: 260, radius: 100, type: "SAM" }, { x: 350, y: 150, radius: 70, type: "AAA" }, { x: 200, y: 300, radius: 50, type: "MANPAD" }],
  },
  { id: "sar", name: "SAR Grid", domain: "DUAL", icon: Users, desc: "12 drones search & rescue",
    drones: Array.from({ length: 12 }, (_, i) => ({ id: `SAR-${String(i + 1).padStart(2, "0")}`, type: i < 8 ? "HERA-S" : "HERA-C", x: -100 + (i % 4) * 50, y: -200 + Math.floor(i / 4) * 60, alt: 120 + Math.random() * 60, hdg: Math.random() * 360 })),
    waypoints: [{ x: -200, y: -200, alt: 120 }, { x: 200, y: -200, alt: 120 }, { x: 200, y: 200, alt: 130 }, { x: -200, y: 200, alt: 130 }], threats: [],
  },
  { id: "ew", name: "EW Counter", domain: "MIL", icon: Radio, desc: "8 drones vs jamming zones",
    drones: Array.from({ length: 8 }, (_, i) => ({ id: `EW-${String(i + 1).padStart(2, "0")}`, type: i < 4 ? "VEGA-X" : "HERA-S", x: -80 + (i % 3) * 40, y: -100 + Math.floor(i / 3) * 50, alt: 200 + Math.random() * 100, hdg: 60 })),
    waypoints: [{ x: 150, y: 100, alt: 250 }, { x: 200, y: -150, alt: 300 }, { x: -50, y: -200, alt: 200 }],
    threats: [{ x: 100, y: 0, radius: 120, type: "GPS-J" }, { x: -50, y: 150, radius: 90, type: "RF-J" }, { x: 250, y: -50, radius: 70, type: "SPOOF" }],
  },
  { id: "medevac", name: "Medical Delivery", domain: "CIV", icon: MapPin, desc: "6 drones — depot to 3 delivery pts",
    drones: [
      { id: "CARGO-1", type: "HERA-C", x: -300, y: -200, alt: 120, hdg: 45 }, { id: "CARGO-2", type: "HERA-C", x: -290, y: -210, alt: 120, hdg: 45 },
      { id: "CARGO-3", type: "HERA-C", x: -310, y: -190, alt: 120, hdg: 45 }, { id: "CARGO-4", type: "HERA-C", x: -280, y: -200, alt: 120, hdg: 45 },
      { id: "ESC-01", type: "HERA-S", x: -320, y: -220, alt: 160, hdg: 45 }, { id: "ESC-02", type: "HERA-S", x: -270, y: -180, alt: 160, hdg: 45 },
    ],
    waypoints: [{ x: -300, y: -200, alt: 120 }, { x: -100, y: -50, alt: 130 }, { x: 50, y: 100, alt: 140 }, { x: 250, y: 300, alt: 120 }],
    threats: [],
  },
  { id: "lightshow", name: "Light Show", domain: "CIV", icon: Eye, desc: "32 drones — circular formation",
    drones: Array.from({ length: 32 }, (_, i) => ({ id: `LS-${String(i + 1).padStart(2, "0")}`, type: "HERA-S", x: -50 + (i % 8) * 12, y: -50 + Math.floor(i / 8) * 12, alt: 150, hdg: Math.random() * 360 })),
    waypoints: Array.from({ length: 32 }, (_, i) => ({ x: Math.round(180 * Math.cos(i * 2 * Math.PI / 32)), y: Math.round(180 * Math.sin(i * 2 * Math.PI / 32)), alt: 150 })),
    threats: [],
  },
  { id: "pipeline", name: "Pipeline Inspect", domain: "CIV", icon: Cpu, desc: "6 drones — linear sweep 700m",
    drones: [
      { id: "INS-01", type: "HERA-S", x: -350, y: -10, alt: 80, hdg: 90 }, { id: "INS-02", type: "HERA-S", x: -350, y: 10, alt: 80, hdg: 90 },
      { id: "INS-03", type: "HERA-S", x: -340, y: -20, alt: 80, hdg: 90 }, { id: "INS-04", type: "HERA-S", x: -340, y: 20, alt: 80, hdg: 90 },
      { id: "INS-C1", type: "HERA-C", x: -360, y: 0, alt: 100, hdg: 90 }, { id: "INS-C2", type: "HERA-C", x: -370, y: 0, alt: 100, hdg: 90 },
    ],
    waypoints: Array.from({ length: 8 }, (_, i) => ({ x: -350 + i * 100, y: 0, alt: 80 })),
    threats: [],
  },
  { id: "border", name: "Border Patrol", domain: "MIL", icon: Shield, desc: "10 drones — 2 BOGEY incursion",
    drones: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `BP-${String(i + 1).padStart(2, "0")}`, type: "HERA-S", x: -200 + (i % 3) * 40, y: -200 + Math.floor(i / 3) * 40, alt: 200, hdg: 0 })),
      { id: "BP-V1", type: "VEGA-X", x: -100, y: -250, alt: 300, hdg: 0 }, { id: "BP-V2", type: "VEGA-X", x: 100, y: -250, alt: 300, hdg: 0 },
      { id: "BOGEY-X", type: "BOGEY", x: 350, y: 300, alt: 200, hdg: 225 }, { id: "BOGEY-Y", type: "BOGEY", x: -350, y: 280, alt: 180, hdg: 315 },
    ],
    waypoints: [{ x: -250, y: -250, alt: 200 }, { x: 250, y: -250, alt: 200 }, { x: 250, y: 250, alt: 200 }, { x: -250, y: 250, alt: 200 }],
    threats: [{ x: 200, y: 200, radius: 80, type: "RADAR" }, { x: -200, y: 200, radius: 70, type: "JAMMER" }],
  },
  // ── MULTI-PHASE MISSIONS ──
  { id: "svs", name: "Swarm vs Swarm", domain: "MIL", icon: Zap, multi: true,
    desc: "4-phase: deploy → advance → engage → extract",
    drones: [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `SV-V${i+1}`, type: "VEGA-X", x: -80 + (i%4)*20, y: -180 + Math.floor(i/4)*20, alt: 200, hdg: 0 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `SV-S${i+1}`, type: "HERA-S", x: -50 + i*25, y: -220, alt: 180, hdg: 0 })),
    ],
    waypoints: [{ x: 0, y: -150, alt: 200 }], threats: [],
    phases: [
      { name: "Deploy", briefing: "Get all drones airborne",
        objectives: [{ id: "airborne", desc: "All drones airborne (speed > 5)", check: (dr) => dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE").every(d=>d.fd.speed>5) }],
        transition: (pt) => pt > 15 },
      { name: "Advance", briefing: "Move to engagement area",
        waypoints: [{ x: 150, y: 50, alt: 220 }],
        threats: [{ x: 200, y: 100, radius: 60, type: "RADAR" }],
        objectives: [{ id: "reach_ea", desc: "80% at engagement area", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x-150,d.fd.y-50)<80).length>=f.length*0.8; } }],
        transition: (_,__,___,os) => os["reach_ea"] },
      { name: "Engage", briefing: "Neutralize all hostiles",
        spawns: Array.from({ length: 6 }, (_, i) => ({ id: `SV-BG${i+1}`, type: "BOGEY", x: 280+(i%3)*25, y: 180+Math.floor(i/3)*25, alt: 200, hdg: 225 })),
        objectives: [{ id: "kill_all", desc: "All hostiles eliminated", check: (dr) => { const h=dr.filter(d=>d.spec.iff==="HOSTILE"); return h.length>0 && h.every(d=>d.status==="ELIMINATED"); } }],
        transition: (_,__,___,os) => os["kill_all"] },
      { name: "Extract", briefing: "RTB to origin",
        waypoints: [{ x: 0, y: 0, alt: 150 }], clearThreats: true,
        objectives: [{ id: "rtb", desc: "80% at origin", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x,d.fd.y)<80).length>=f.length*0.8; } }],
        transition: (_,__,___,os) => os["rtb"] },
    ],
  },
  { id: "escort", name: "Escort Convoy", domain: "DUAL", icon: Shield, multi: true,
    desc: "3-phase: form up → ambush → deliver",
    drones: [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `EC-C${i+1}`, type: "HERA-C", x: -300+i*15, y: -200+i*10, alt: 100, hdg: 45 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `EC-S${i+1}`, type: "HERA-S", x: -320+i*20, y: -220+i*10, alt: 140, hdg: 45 })),
      { id: "EC-V1", type: "VEGA-X", x: -280, y: -180, alt: 160, hdg: 45 },
      { id: "EC-V2", type: "VEGA-X", x: -330, y: -230, alt: 160, hdg: 45 },
    ],
    waypoints: [], threats: [],
    phases: [
      { name: "Form Escort", briefing: "Establish convoy formation",
        cargoWP: [{ x: -300, y: -200, alt: 100 }, { x: -100, y: 0, alt: 110 }, { x: 100, y: 100, alt: 110 }, { x: 300, y: 200, alt: 100 }],
        objectives: [{ id: "formed", desc: "Escort formation established", check: () => true }],
        transition: (pt) => pt > 10 },
      { name: "Ambush", briefing: "Repel hostile ambush",
        spawns: [
          { id: "AMB-1", type: "BOGEY", x: 0, y: 250, alt: 180, hdg: 180 }, { id: "AMB-2", type: "BOGEY", x: -50, y: 260, alt: 190, hdg: 180 },
          { id: "AMB-3", type: "BOGEY", x: 0, y: -250, alt: 170, hdg: 0 }, { id: "AMB-4", type: "BOGEY", x: 50, y: -240, alt: 185, hdg: 0 },
        ],
        threats: [{ x: 0, y: 100, radius: 70, type: "JAMMER" }, { x: -50, y: -50, radius: 50, type: "SAM" }],
        objectives: [{ id: "repel", desc: "All ambushers eliminated", check: (dr) => { const h=dr.filter(d=>d.id.startsWith("AMB")); return h.length>0&&h.every(d=>d.status==="ELIMINATED"); } }],
        transition: (_,__,___,os) => os["repel"] },
      { name: "Deliver", briefing: "Cargo to destination",
        clearThreats: true,
        objectives: [{ id: "delivered", desc: "All cargo at destination", check: (dr) => { const c=dr.filter(d=>d.typeKey==="HERA-C"&&d.status==="ACTIVE"); return c.length>0&&c.every(d=>Math.hypot(d.fd.x-300,d.fd.y-200)<50); } }],
        transition: (_,__,___,os) => os["delivered"] },
    ],
  },
  { id: "strike", name: "Strike Package", domain: "MIL", icon: Target, multi: true,
    desc: "3-phase: ingress → strike → egress",
    drones: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `ST-V${i+1}`, type: "VEGA-X", x: -250+(i%3)*20, y: -250+Math.floor(i/3)*20, alt: 100, hdg: 45 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `ST-ISR${i+1}`, type: "HERA-S", x: -280+i*15, y: -270, alt: 120, hdg: 45 })),
      { id: "ST-SEAD1", type: "HERA-S", x: -230, y: -280, alt: 130, hdg: 45 },
      { id: "ST-SEAD2", type: "HERA-S", x: -240, y: -290, alt: 130, hdg: 45 },
    ],
    waypoints: [{ x: -100, y: -80, alt: 100 }, { x: 50, y: 0, alt: 120 }, { x: 150, y: 80, alt: 130 }],
    threats: [{ x: 0, y: -50, radius: 70, type: "SAM" }, { x: 100, y: 30, radius: 60, type: "SAM" }, { x: -80, y: 50, radius: 50, type: "RADAR" }],
    phases: [
      { name: "Ingress", briefing: "Low-alt approach through SAM corridor",
        objectives: [{ id: "at_ip", desc: "80% at Initial Point", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x-150,d.fd.y-80)<80).length>=f.length*0.8; } }],
        transition: (_,__,___,os) => os["at_ip"] },
      { name: "Strike", briefing: "Engage 3 targets",
        strikeTargets: [{ x: 250, y: 120, alt: 100, id: "tgt_a" }, { x: 300, y: 180, alt: 100, id: "tgt_b" }, { x: 280, y: 250, alt: 100, id: "tgt_c" }],
        objectives: [
          { id: "tgt_a", desc: "Target Alpha struck", check: (dr) => dr.some(d=>d.typeKey==="VEGA-X"&&d.status==="ACTIVE"&&Math.hypot(d.fd.x-250,d.fd.y-120)<20) },
          { id: "tgt_b", desc: "Target Bravo struck", check: (dr) => dr.some(d=>d.typeKey==="VEGA-X"&&d.status==="ACTIVE"&&Math.hypot(d.fd.x-300,d.fd.y-180)<20) },
          { id: "tgt_c", desc: "Target Charlie struck", check: (dr) => dr.some(d=>d.typeKey==="VEGA-X"&&d.status==="ACTIVE"&&Math.hypot(d.fd.x-280,d.fd.y-250)<20) },
        ],
        transition: (_,__,___,os) => os["tgt_a"]&&os["tgt_b"]&&os["tgt_c"] },
      { name: "Egress", briefing: "RTB — avoid pursuit",
        waypoints: [{ x: -100, y: 100, alt: 120 }, { x: -200, y: 0, alt: 100 }, { x: 0, y: 0, alt: 100 }],
        spawns: [{ id: "PUR-1", type: "BOGEY", x: 350, y: 250, alt: 200, hdg: 225 }, { id: "PUR-2", type: "BOGEY", x: 320, y: 280, alt: 180, hdg: 225 }],
        clearThreats: true,
        objectives: [{ id: "egress", desc: "80% at origin (RTB)", check: (dr) => { const f=dr.filter(d=>d.spec.iff==="FRIENDLY"&&d.status==="ACTIVE"); return f.filter(d=>Math.hypot(d.fd.x,d.fd.y)<80).length>=f.length*0.8; } }],
        transition: (_,__,___,os) => os["egress"] },
    ],
  },
];

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
    } else {
      phaseRef.current = null;
      setPhaseInfo(null);
    }
    log(`MISSION: ${m.name}`, "success"); log(`${m.drones.length} units — ${m.desc}`, "info");
    if (m.threats.length) log(`⚠️ ${m.threats.length} mối đe dọa phát hiện`, "warning");
  }, [log]);

  // Auto-demo: 1-click launch Lũ lụt QB + cinematic + weather
  const startDemo = useCallback(() => {
    const m = MISSIONS[0]; // Lũ lụt Quảng Bình
    launch(m);
    setTimeout(() => { setCamMode("cinematic"); setWindDir(90); setWindSpd(15);
      const wx = Math.sin(90 * DEG) * 15, wy = Math.cos(90 * DEG) * 15;
      for (const d of swRef.current.drones) { d.fd.windX = wx; d.fd.windY = wy; }
    }, 200);
  }, [launch]);

  // AI Scenario Generator
  const generateScenario = useCallback(async () => {
    setScenarioLoading(true);
    try {
      const prompt = `Bạn là chuyên gia tác chiến drone của Quân đội Nhân dân Việt Nam, chuyên về cứu hộ cứu nạn.\n\nTình huống: ${scenarioInput}\nLoại: ${scenarioType}\n\nTạo kịch bản mô phỏng dưới dạng JSON thuần (KHÔNG markdown, KHÔNG \`\`\`):\n{"missionName":"tên tiếng Việt","briefing":"mô tả 2 câu","domain":"RESCUE","phases":[{"name":"tên phase","briefing":"mô tả","drones":[{"id":"XX-1","type":"HERA-S","x":0,"y":-20,"alt":150,"hdg":0}],"waypoints":[{"x":200,"y":150,"alt":120}],"threats":[{"x":200,"y":150,"radius":80,"type":"Vùng ngập sâu"}],"objectives":["mục tiêu 1"],"transitionType":"time","transitionTime":20}]}\n\nQuy tắc: HERA-S trinh sát nhanh, HERA-C vận chuyển chậm, VEGA-X hộ tống. 3-4 phases. 8-16 drones. Origin (0,0) = sở chỉ huy. Vùng thiên tai 200-350m.`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      let text = data.content?.[0]?.text || "";
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
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      let text = data.content?.[0]?.text || "{}";
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
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      setAiDebrief(data.content?.[0]?.text || "No response content");
    } catch (err) {
      setAiDebrief(`AI debrief unavailable (${err.message}) — showing standard report:\n\n${generateReport()}`);
    }
  }, [mis, elapsed, generateReport]);

  const compassLabel = (deg) => {
    const dirs = ["N","NE","E","SE","S","SW","W","NW"];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  };

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
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#000000", color: "#c8d6e5", fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 11, overflow: "hidden" }}>
      {/* TOP */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", borderBottom: missionComplete ? "2px solid #00e878" : "1px solid #222", background: "#000000", transition: "border-color 0.5s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Radar size={16} color="#00e5ff" /><span style={{ fontSize: 13, fontWeight: 700, color: "#00e5ff", letterSpacing: 2 }}>RTR DRONEVERSE</span></div>
            <div style={{ fontSize: 7, color: "#556070", marginTop: -1, marginLeft: 22 }}>{VI.subtitle}</div>
          </div>
          <button onClick={startDemo} style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 10px", borderRadius: 5, border: "1px solid #00e87860", background: "#00e87820", color: "#00e878", cursor: "pointer", fontSize: 9, fontWeight: 700, fontFamily: "inherit" }}><Play size={10} /> {VI.demo}</button>
          <button onClick={() => setShowScenarioModal(true)} style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 10px", borderRadius: 5, border: "1px solid #a855f760", background: "#a855f720", color: "#a855f7", cursor: "pointer", fontSize: 9, fontWeight: 700, fontFamily: "inherit" }}><Brain size={10} /> {VI.aiScenario}</button>
          {mis && <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 3, background: mis.domain === "RESCUE" ? "#00e87820" : mis.domain === "MIL" ? "#ff3b5c30" : "#00e5ff50", color: mis.domain === "RESCUE" ? "#00e878" : mis.domain === "MIL" ? "#ff3b5c" : "#00e5ff" }}>{mis.domain === "RESCUE" ? VI.rescue : mis.domain} — {mis.name}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={12} color="#7090b0" /><span style={{ color: "#90b0d0", fontVariantNumeric: "tabular-nums" }}>T+{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}><Plane size={12} color="#00e5ff" /><span style={{ color: "#00e5ff" }}>{fr}</span></div>
          {ho > 0 && <div style={{ display: "flex", alignItems: "center", gap: 3 }}><AlertTriangle size={12} color="#ff3b5c" /><span style={{ color: "#ff3b5c" }}>{ho}</span></div>}
          {eliminated > 0 && <div style={{ display: "flex", alignItems: "center", gap: 3 }}><X size={12} color="#ff6b35" /><span style={{ color: "#ff6b35" }}>{eliminated}</span></div>}
          <div style={{ display: "flex", gap: 2, background: "#0a0a0a", borderRadius: 4, padding: 2 }}>
            {[["split", Layers], ["radar", Radar], ["3d", Box]].map(([v, I]) => (
              <button key={v} onClick={() => setVw(v)} style={{ display: "flex", alignItems: "center", padding: "3px 8px", borderRadius: 3, border: "none", cursor: "pointer", background: vw === v ? "#00e5ff50" : "transparent", color: vw === v ? "#00e5ff" : "#7090b0", fontSize: 9, fontFamily: "inherit", fontWeight: 600 }}><I size={11} /></button>
            ))}
          </div>
        </div>
      </div>
      {/* BODY */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* LEFT */}
        <div style={{ width: 220, borderRight: "1px solid #222", display: "flex", flexDirection: "column", background: "#000000" }}>
          <div style={{ padding: 8, borderBottom: "1px solid #222", maxHeight: 280, overflow: "auto" }}>
            <div style={{ fontSize: 9, color: "#7090b0", letterSpacing: 1, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}><Target size={10} /> {VI.missions} ({MISSIONS.length})</div>
            {MISSIONS.map(m => { const I = m.icon, a = mis?.id === m.id; return <button key={m.id} onClick={() => launch(m)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, border: a ? "1px solid #00e5ff60" : "1px solid #333", background: a ? "#00e5ff18" : "#0a0a0a", cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: "#c8d6e5", width: "100%", marginBottom: 3 }}><I size={12} color={a ? "#00e5ff" : "#7090b0"} /><div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 9, fontWeight: 600, color: a ? "#00e5ff" : "#c0d0e0" }}>{m.name}</span>{m.multi && <span style={{ fontSize: 6, padding: "1px 3px", borderRadius: 2, background: "#a855f720", color: "#a855f7", fontWeight: 700 }}>MULTI</span>}</div><div style={{ fontSize: 7, color: "#7090b0", marginTop: 1 }}>{m.desc}</div></div></button>; })}
          </div>
          {mis && <div style={{ padding: "4px 8px", borderBottom: "1px solid #222", display: "flex", gap: 3 }}>
            <button onClick={injectThreat} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: "5px 0", borderRadius: 5, border: "1px solid #ff3b5c40", background: "#ff3b5c12", color: "#ff5070", cursor: "pointer", fontSize: 8, fontWeight: 700, fontFamily: "inherit" }}><Plus size={10} /> {VI.inject}</button>
            <button onClick={() => setSideTab("fleet")} style={{ padding: "5px 8px", borderRadius: 5, border: "none", cursor: "pointer", background: sideTab === "fleet" ? "#00e5ff25" : "#0a0a0a", color: sideTab === "fleet" ? "#00e5ff" : "#7090b0", fontSize: 8, fontWeight: 600, fontFamily: "inherit" }}><Plane size={10} /></button>
            <button onClick={() => setSideTab("god")} style={{ padding: "5px 8px", borderRadius: 5, border: "none", cursor: "pointer", background: sideTab === "god" ? "#ffb02025" : "#0a0a0a", color: sideTab === "god" ? "#ffb020" : "#7090b0", fontSize: 8, fontWeight: 600, fontFamily: "inherit" }}><Zap size={10} /></button>
          </div>}
          <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
            {sideTab === "fleet" ? <>
              <div style={{ fontSize: 9, color: "#7090b0", letterSpacing: 1, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}><Plane size={10} /> {VI.fleet} ({dr.length})</div>
              {dr.map(d => (
                <div key={d.id} onClick={() => setSel(d.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 4, cursor: "pointer", background: sel === d.id ? "#00e5ff18" : "transparent", border: sel === d.id ? "1px solid #00e5ff50" : "1px solid transparent", marginBottom: 1 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: d.spec.color, boxShadow: `0 0 4px ${d.spec.color}60`, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 9, fontWeight: 600, color: d.spec.iff === "HOSTILE" ? "#ff3b5c" : "#c0d0e0" }}>{d.id}</span>
                  <Battery size={9} color={d.fd.battery < 25 ? "#ff3b5c" : "#00e878"} />
                  <span style={{ fontSize: 8, color: "#90b0d0", width: 20, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(d.fd.battery)}</span>
                </div>
              ))}
            </> : <>
              <div style={{ fontSize: 9, color: "#ffb020", letterSpacing: 1, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}><Zap size={10} /> {VI.god}</div>
              {/* Weather Control */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 8, color: "#7090b0", letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><Wind size={9} /> {VI.weather}</div>
                <div style={{ fontSize: 8, color: "#90b0d0", marginBottom: 2 }}>Wind Dir: {windDir}° ({compassLabel(windDir)})</div>
                <input type="range" min={0} max={360} value={windDir} onChange={e => { const v = +e.target.value; setWindDir(v); applyWind(v, windSpd); if (windSpd > 0) log(`WIND: ${windSpd}m/s from ${compassLabel(v)}`, "info"); }} style={{ width: "100%", height: 4, accentColor: "#00e5ff" }} />
                <div style={{ fontSize: 8, color: "#90b0d0", marginBottom: 2, marginTop: 4 }}>Wind Spd: {windSpd} m/s</div>
                <input type="range" min={0} max={25} value={windSpd} onChange={e => { const v = +e.target.value; setWindSpd(v); applyWind(windDir, v); log(`WIND: ${v}m/s from ${compassLabel(windDir)}`, "info"); }} style={{ width: "100%", height: 4, accentColor: "#00e5ff" }} />
              </div>
              {/* Adversary Spawn */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 8, color: "#7090b0", letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><UserPlus size={9} /> {VI.adversary}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => spawnBogey(1)} style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "1px solid #ff6b3540", background: "#ff6b3512", color: "#ff6b35", cursor: "pointer", fontSize: 8, fontWeight: 700, fontFamily: "inherit" }}>BOGEY</button>
                  <button onClick={() => spawnBogey(3)} style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "1px solid #ff6b3540", background: "#ff6b3512", color: "#ff6b35", cursor: "pointer", fontSize: 8, fontWeight: 700, fontFamily: "inherit" }}>BOGEY x3</button>
                </div>
              </div>
              {/* GPS Denial */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 8, color: "#7090b0", letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><Radio size={9} /> {VI.electronic}</div>
                <button onClick={gpsDeny} style={{ width: "100%", padding: "5px 0", borderRadius: 5, border: "1px solid #a855f740", background: "#a855f712", color: "#a855f7", cursor: "pointer", fontSize: 8, fontWeight: 700, fontFamily: "inherit" }}>GPS DENY (origin)</button>
              </div>
              {/* Fleet Commands */}
              <div>
                <div style={{ fontSize: 8, color: "#7090b0", letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><Navigation size={9} /> {VI.fleetCmd}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <button onClick={rtbAll} style={{ padding: "5px 0", borderRadius: 5, border: "1px solid #00e87840", background: "#00e87812", color: "#00e878", cursor: "pointer", fontSize: 8, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}><Home size={9} /> {VI.rtb}</button>
                  <button onClick={scatterAll} style={{ padding: "5px 0", borderRadius: 5, border: "1px solid #ffb02040", background: "#ffb02012", color: "#ffb020", cursor: "pointer", fontSize: 8, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}><Shuffle size={9} /> {VI.scatter}</button>
                  <button onClick={formUp} style={{ padding: "5px 0", borderRadius: 5, border: "1px solid #00e5ff40", background: "#00e5ff12", color: "#00e5ff", cursor: "pointer", fontSize: 8, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}><CircleDot size={9} /> {VI.formUp}</button>
                </div>
              </div>
              {/* Knowledge Graph Stats */}
              {graphStats && <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 8, color: "#7090b0", letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}><GitBranch size={9} /> {VI.graph}</div>
                <div style={{ fontSize: 8, color: "#20c080", lineHeight: 1.5 }}>
                  Nodes: {graphStats.nodeCount} | Edges: {graphStats.edgeCount}<br/>
                  {Object.entries(graphStats.types).map(([t, c]) => `${t}: ${c}`).join(" | ")}<br/>
                  {graphStats.mostVisited && <>Top: {graphStats.mostVisited} ({graphStats.mostVisitCount})<br/></>}
                  {graphStats.leastVisited && <>Low: {graphStats.leastVisited} ({graphStats.leastVisitCount})</>}
                </div>
              </div>}
            </>}
          </div>
          <div style={{ padding: 8, borderTop: "1px solid #222", display: "flex", gap: 4 }}>
            <button onClick={() => setRun(!run)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: `1px solid ${run ? "#00e5ff60" : "#222"}`, background: run ? "#00e5ff25" : "#0a0a0a", color: run ? "#00e5ff" : "#90b0d0", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}>{run ? <Pause size={12} /> : <Play size={12} />}{run ? VI.pause : VI.run}</button>
            {mis && <button onClick={() => setShowReport(true)} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #00e5ff40", background: "#00e5ff10", color: "#00e5ff", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center" }}><FileText size={12} /></button>}
            {mis && <button onClick={requestAiDebrief} disabled={aiDebrief === "loading"} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #a855f740", background: aiDebrief === "loading" ? "#a855f725" : "#a855f710", color: "#a855f7", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", fontSize: 8 }}>{aiDebrief === "loading" ? <span style={{ animation: "pulse 1s infinite" }}>...</span> : <Cpu size={12} />}</button>}
            <button onClick={() => { swRef.current = new SwarmController(); setMis(null); setRun(false); setElapsed(0); setSel(null); setTel([]); setLogs([]); setShowReport(false); setSideTab("fleet"); setWindDir(0); setWindSpd(0); setCamMode("orbit"); phaseRef.current = null; setPhaseInfo(null); kgRef.current = null; edRef.current = null; setEmergenceFeed([]); setGraphStats(null); setShowGraphOverlay(false); setAiDebrief(null); setShowAiModal(false); }} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #222", background: "#0a0a0a", color: "#7090b0", cursor: "pointer", fontFamily: "inherit" }}><RotateCcw size={12} /></button>
          </div>
        </div>
        {/* CENTER */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          {phaseInfo && <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 10, background: "#0c1525ee", border: "1px solid #a855f740", borderRadius: 8, padding: "8px 14px", maxWidth: 300, minWidth: 200, fontFamily: "inherit" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#a855f7", marginBottom: 4 }}>{VI.phase} {phaseInfo.idx + 1}/{phaseInfo.total}: {phaseInfo.name}</div>
            <div style={{ fontSize: 8, color: "#7090b0", marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{phaseInfo.briefing}</span>
              {mis && <button onClick={requestAdvice} disabled={adviceCooldown > 0 || aiAdvice === "loading"} style={{ padding: "2px 6px", borderRadius: 3, border: "1px solid #a855f740", background: "#a855f715", color: adviceCooldown > 0 ? "#556070" : "#a855f7", cursor: adviceCooldown > 0 ? "default" : "pointer", fontSize: 7, fontFamily: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}><Brain size={8} /> {adviceCooldown > 0 ? `${adviceCooldown}s` : VI.aiAdvisor}</button>}
            </div>
            {phaseInfo.objectives.map(obj => {
              const done = phaseInfo.status?.[obj.id];
              return <div key={obj.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, marginBottom: 2 }}>
                {done ? <CheckCircle size={9} color="#00e878" /> : <Circle size={9} color="#333" />}
                <span style={{ color: done ? "#00e878" : "#556070" }}>{obj.desc}</span>
              </div>;
            })}
          </div>}
          <div style={{ flex: 1, display: "flex", gap: 1, padding: 1, background: "#0a0a0a" }}>
            {(vw === "split" || vw === "3d") && <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
              <Viewport3D drones={dr} threats={th} waypoints={wp} selectedId={sel} camMode={camMode} windSpd={windSpd} />
              <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 4, background: "#000000cc", padding: "3px 8px", borderRadius: 4, fontSize: 9, color: "#7090b0" }}><Box size={10} /> 3D TACTICAL</div>
              <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 3, zIndex: 2 }}>
                {[["orbit", RotateCcw], ["chase", Eye], ["topdown", Maximize2], ["cinematic", Film]].map(([md, Icon]) => (
                  <button key={md} onClick={() => setCamMode(md)} style={{ padding: "4px 6px", borderRadius: 4, border: "none", cursor: "pointer", background: camMode === md ? "#00e5ff30" : "#000000aa", color: camMode === md ? "#00e5ff" : "#7090b0", fontSize: 7, fontFamily: "inherit", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}><Icon size={10} />{md.toUpperCase()}</button>
                ))}
              </div>
              {emergenceFeed.length > 0 && <div style={{ position: "absolute", bottom: 50, left: 8, background: "#0c1525ee", border: "1px solid #a855f730", borderRadius: 6, padding: "5px 8px", maxWidth: 250, zIndex: 2 }}>
                <div style={{ fontSize: 7, color: "#a855f7", letterSpacing: 1, marginBottom: 3, display: "flex", alignItems: "center", gap: 3 }}><Brain size={8} /> {VI.emergence}</div>
                {emergenceFeed.slice(0, 4).map((e, i) => <div key={i} style={{ fontSize: 8, color: "#c0a0e0", marginBottom: 1, opacity: Math.max(0.3, 1 - (Date.now() - e.timestamp) / 8000) }}>⚡ {e.type}: {e.desc}</div>)}
              </div>}
            </div>}
            {(vw === "split" || vw === "radar") && <div style={{ flex: vw === "radar" ? 1 : 0, flexBasis: vw === "split" ? 380 : "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#000000", position: "relative", padding: 8 }}>
              <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 4, background: "#000000cc", padding: "3px 8px", borderRadius: 4, fontSize: 9, color: "#20c080" }}><Radar size={10} /> PPI RADAR</div>
              <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 3 }}>
                <button onClick={() => setShowGraphOverlay(!showGraphOverlay)} style={{ padding: "2px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: showGraphOverlay ? "#a855f730" : "#111", color: showGraphOverlay ? "#a855f7" : "#40a070", fontSize: 8, fontFamily: "inherit", fontWeight: 600 }}><GitBranch size={9} /></button>
                {[200, 400, 600, 800].map(r => <button key={r} onClick={() => setRng(r)} style={{ padding: "2px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: rng === r ? "#00aa60" : "#111", color: rng === r ? "#00ff80" : "#40a070", fontSize: 8, fontFamily: "inherit", fontWeight: 600 }}>{r}</button>)}
              </div>
              <RadarPPI drones={dr} threats={th} waypoints={wp} radarRange={rng} selectedId={sel} onSelect={setSel} onAddWaypoint={addWaypoint} wind={{ dir: windDir, speed: windSpd }} graphOverlay={showGraphOverlay} kg={kgRef.current} />
            </div>}
          </div>
          {/* BOTTOM */}
          <div style={{ height: 140, borderTop: "1px solid #222", display: "flex", background: "#000000" }}>
            <div style={{ width: 250, borderRight: "1px solid #222", padding: "6px 10px", overflow: "auto" }}>
              <div style={{ fontSize: 9, color: "#7090b0", letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Crosshair size={10} /> {sd ? VI.track : VI.noTrk}</div>
              {sd ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 10px" }}>
                {[[Navigation,"HDG",`${Math.round(sd.fd.hdg)}°`,"#c0d0e0"],[Gauge,"SPD",`${sd.fd.speed.toFixed(1)}`,"#00e5ff"],[ArrowUpRight,"ALT",`${Math.round(sd.fd.alt)}m`,"#00e878"],[Activity,"VS",`${sd.fd.vs > 0 ? "+" : ""}${sd.fd.vs.toFixed(1)}`,(sd.fd.vs > 0 ? "#00e878" : "#ff3b5c")],[Battery,"BAT",`${Math.round(sd.fd.battery)}%`,(sd.fd.battery < 25 ? "#ff3b5c" : "#00e878")],[Signal,"SIG",`${Math.round(sd.fd.signal)}%`,(sd.fd.signal < 60 ? "#ffb020" : "#00e5ff")],[Compass,"BNK",`${Math.round(sd.fd.bank)}°`,"#a855f7"],[Shield,"IFF",sd.spec.iff,(sd.spec.iff === "HOSTILE" ? "#ff3b5c" : "#00e878")]].map(([I,k,v,c]) => <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}><I size={9} color="#5580a0" /><span style={{ fontSize: 8, color: "#7090b0", width: 26 }}>{k}</span><span style={{ fontSize: 10, fontWeight: 600, color: c, fontVariantNumeric: "tabular-nums" }}>{v}</span></div>)}
              {sd.memory && <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #222", paddingTop: 3, marginTop: 2 }}>
                <div style={{ fontSize: 7, color: "#a855f7", letterSpacing: 1, marginBottom: 2, display: "flex", alignItems: "center", gap: 3 }}><Brain size={7} /> {VI.agentMem}</div>
                <div style={{ fontSize: 8, color: "#7090b0", display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                  <span>XP:<b style={{color:"#a855f7"}}>{Math.round(sd.memory.experienceScore)}</b></span>
                  <span>Sec:<b style={{color:"#00e5ff"}}>{sd.memory.sectorsVisited.size}/16</b></span>
                  <span>Dist:<b style={{color:"#00e878"}}>{(sd.memory.distanceTraveled/1000).toFixed(1)}km</b></span>
                  <span>Kills:<b style={{color:"#ff3b5c"}}>{sd.memory.eliminationCount}</b></span>
                  <span style={{fontSize:7}}>A:{sd.memory.personality.aggression.toFixed(1)} U:{sd.memory.personality.autonomy.toFixed(1)} T:{sd.memory.personality.teamwork.toFixed(1)}</span>
                </div>
              </div>}
              </div> : <div style={{ fontSize: 9, color: "#333", padding: 8 }}>{VI.clickTrack}</div>}
            </div>
            <div style={{ flex: 1, display: "flex", gap: 1 }}>
              {[{ k: "bat", n: "BATTERY", c: "#00e878" }, { k: "alt", n: "ALTITUDE", c: "#00e5ff" }, { k: "spd", n: "SPEED", c: "#a855f7" }].map(ch => (
                <div key={ch.k} style={{ flex: 1, padding: "4px 6px" }}>
                  <div style={{ fontSize: 8, color: "#7090b0", letterSpacing: 1, marginBottom: 2, display: "flex", alignItems: "center", gap: 3 }}><BarChart3 size={8} /> {ch.n}</div>
                  <ResponsiveContainer width="100%" height={90}>
                    <AreaChart data={tel}><defs><linearGradient id={`gv-${ch.k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ch.c} stopOpacity={0.5} /><stop offset="100%" stopColor={ch.c} stopOpacity={0} /></linearGradient></defs><XAxis dataKey="t" hide /><YAxis hide domain={["auto","auto"]} /><Area type="monotone" dataKey={ch.k} stroke={ch.c} strokeWidth={2} fill={`url(#gv-${ch.k})`} dot={false} isAnimationActive={false} /></AreaChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
            <div style={{ width: 200, borderLeft: "1px solid #222", padding: "6px 8px", overflow: "auto" }}>
              <div style={{ fontSize: 9, color: "#7090b0", letterSpacing: 1, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Activity size={10} /> {VI.log}</div>
              {logs.map((l, i) => <div key={i} style={{ fontSize: 8, padding: "2px 4px", marginBottom: 2, borderLeft: `2px solid ${l.l === "success" ? "#00e878" : l.l === "warning" ? "#ffb020" : "#333"}`, color: "#90b0d0", lineHeight: 1.4 }}><span style={{ color: "#5580a0", marginRight: 4 }}>{new Date(l.t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>{l.m}</div>)}
            </div>
          </div>
        </div>
      </div>
      {showReport && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setShowReport(false)}>
        <div style={{ background: "#0c1525ee", border: "1px solid #00e5ff40", borderRadius: 12, maxWidth: 500, width: "90%", padding: "20px 24px", fontFamily: "inherit" }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#00e5ff" }}><FileText size={14} /> MISSION DEBRIEF</div>
            <button onClick={() => setShowReport(false)} style={{ background: "none", border: "none", color: "#7090b0", cursor: "pointer", padding: 4 }}><X size={16} /></button>
          </div>
          <pre style={{ fontSize: 10, color: "#c0d0e0", lineHeight: 1.6, whiteSpace: "pre-wrap", background: "#000", borderRadius: 8, padding: 14, border: "1px solid #222", marginBottom: 14, maxHeight: 400, overflow: "auto" }}>{generateReport()}</pre>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { navigator.clipboard.writeText(generateReport()); log("Report copied to clipboard", "success"); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: "1px solid #00e5ff40", background: "#00e5ff15", color: "#00e5ff", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}><Copy size={12} /> COPY</button>
            <button onClick={() => setShowReport(false)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: "1px solid #333", background: "#0a0a0a", color: "#7090b0", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}><X size={12} /> CLOSE</button>
          </div>
        </div>
      </div>}
      {showAiModal && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setShowAiModal(false)}>
        <div style={{ background: "#0c1525ee", border: "1px solid #a855f740", borderRadius: 12, maxWidth: 540, width: "90%", padding: "20px 24px", fontFamily: "inherit" }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#a855f7" }}><Cpu size={14} /> AI TACTICAL DEBRIEF</div>
            <button onClick={() => setShowAiModal(false)} style={{ background: "none", border: "none", color: "#7090b0", cursor: "pointer", padding: 4 }}><X size={16} /></button>
          </div>
          {aiDebrief === "loading" ? <div style={{ fontSize: 11, color: "#a855f7", padding: 20, textAlign: "center" }}>Analyzing simulation data...</div>
          : <pre style={{ fontSize: 10, color: "#c0d0e0", lineHeight: 1.6, whiteSpace: "pre-wrap", background: "#000", borderRadius: 8, padding: 14, border: "1px solid #222", marginBottom: 14, maxHeight: 400, overflow: "auto" }}>{aiDebrief}</pre>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { if (aiDebrief && aiDebrief !== "loading") navigator.clipboard.writeText(aiDebrief); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: "1px solid #a855f740", background: "#a855f715", color: "#a855f7", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}><Copy size={12} /> COPY</button>
            <button onClick={() => setShowAiModal(false)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 0", borderRadius: 6, border: "1px solid #333", background: "#0a0a0a", color: "#7090b0", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}><X size={12} /> CLOSE</button>
          </div>
          <div style={{ fontSize: 7, color: "#556070", marginTop: 8, textAlign: "center" }}>Generated by Claude — {new Date().toLocaleString()}</div>
        </div>
      </div>}
      {/* AI Scenario Generator Modal */}
      {showScenarioModal && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => { setShowScenarioModal(false); setScenarioLoading(false); }}>
        <div style={{ background: "#0c1525ee", border: "1px solid #a855f740", borderRadius: 12, maxWidth: 500, width: "90%", padding: "20px 24px", fontFamily: "inherit" }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#a855f7" }}><Brain size={14} /> {VI.aiScenario}</div>
            <button onClick={() => { setShowScenarioModal(false); setScenarioLoading(false); }} style={{ background: "none", border: "none", color: "#7090b0", cursor: "pointer", padding: 4 }}><X size={16} /></button>
          </div>
          {scenarioLoading ? <div style={{ textAlign: "center", padding: 30, color: "#a855f7", fontSize: 11 }}>Đang phân tích tình huống...</div> : <>
            <select value={scenarioType} onChange={e => setScenarioType(e.target.value)} style={{ width: "100%", padding: "8px 10px", marginBottom: 8, borderRadius: 6, border: "1px solid #333", background: "#0a0a0a", color: "#c0d0e0", fontSize: 10, fontFamily: "inherit" }}>
              {["Lũ lụt", "Sạt lở", "Bão", "Cháy rừng", "Tuần tra biển", "Tùy chỉnh"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <textarea value={scenarioInput} onChange={e => setScenarioInput(e.target.value)} placeholder="VD: Lũ lụt tại Quảng Bình, 15 điểm dân cư bị cô lập, gió cấp 8..." rows={4} style={{ width: "100%", padding: "8px 10px", marginBottom: 12, borderRadius: 6, border: "1px solid #333", background: "#0a0a0a", color: "#c0d0e0", fontSize: 10, fontFamily: "inherit", resize: "vertical" }} />
            <button onClick={generateScenario} disabled={!scenarioInput.trim()} style={{ width: "100%", padding: "10px 0", borderRadius: 6, border: "1px solid #a855f740", background: "#a855f720", color: "#a855f7", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}>AI PHÂN TÍCH VÀ TẠO KỊCH BẢN</button>
          </>}
        </div>
      </div>}
      {/* AI Advice Toast */}
      {aiAdvice && aiAdvice !== "loading" && <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", background: "#0c1525ee", border: "1px solid #a855f740", borderRadius: 8, padding: "10px 16px", maxWidth: 400, zIndex: 100, fontFamily: "inherit" }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#a855f7", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>🎖️ {VI.aiAdvisor}</div>
        {aiAdvice.map((a, i) => <div key={i} style={{ fontSize: 9, color: "#c0d0e0", marginBottom: 3 }}>{i + 1}. {a}</div>)}
      </div>}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#222;border-radius:3px}button:hover{filter:brightness(1.15)}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );
}
