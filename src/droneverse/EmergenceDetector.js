import { DEG } from "./constants.js";

export class EmergenceDetector {
  constructor() { this.events = []; this.lastPatterns = []; }
  analyze(drones) {
    const active = drones.filter(d => d.status === "ACTIVE" && d.spec.iff === "FRIENDLY");
    if (active.length < 3) return [];
    const patterns = [];
    const clusters = this.findClusters(active, 60);
    if (clusters.length >= 2 && clusters.some(c => c.length >= 3))
      patterns.push({ type: "SPLIT", desc: `Fleet split into ${clusters.length} groups` });
    const hdgs = active.map(d => d.fd.hdg);
    const hdgStd = this.circularStdDev(hdgs);
    if (hdgStd < 20) patterns.push({ type: "HERDING", desc: `Coordinated movement, spread ${Math.round(hdgStd)}°` });
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
    const newPatterns = patterns.filter(p => !this.lastPatterns.some(lp => lp.type === p.type));
    this.lastPatterns = patterns;
    for (const p of newPatterns) { p.timestamp = Date.now(); this.events.push(p); }
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
