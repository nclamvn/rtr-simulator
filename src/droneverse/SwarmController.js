import { FlightDynamics } from "./FlightDynamics.js";
import { DRONE_SPECS, DEG, PI2 } from "./constants.js";

export class SwarmController {
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
      if (d.spec.iff === "HOSTILE") {
        let nearest = null, nearestDist = Infinity;
        for (const o of this.drones) { if (o.spec.iff !== "FRIENDLY") continue; const dist = Math.hypot(d.fd.x - o.fd.x, d.fd.y - o.fd.y); if (dist < nearestDist) { nearest = o; nearestDist = dist; } }
        if (nearest) { d.fd.targetHdg = (Math.atan2(nearest.fd.x - d.fd.x, nearest.fd.y - d.fd.y) / DEG + 360) % 360; d.fd.targetSpeed = d.spec.maxSpeed * 0.8; }
      } else {
        const pdwp = this.perDroneWP.get(d.id);
        if (pdwp) {
          const dx = pdwp.x - d.fd.x, dy = pdwp.y - d.fd.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 15) { d.fd.targetSpeed = 0.5; }
          else { d.fd.targetHdg = (Math.atan2(dx, dy) / DEG + 360) % 360; d.fd.targetSpeed = dist > 100 ? d.spec.cruiseSpeed : d.spec.cruiseSpeed * 0.4; }
          d.fd.targetAlt = pdwp.alt || 150;
        } else if (d.typeKey === "HERA-S" && this.drones.some(o => o.typeKey === "HERA-C" && o.status === "ACTIVE")) {
          let nearestCargo = null, nd = Infinity;
          for (const o of this.drones) { if (o.typeKey !== "HERA-C" || o.status !== "ACTIVE") continue; const dist = Math.hypot(d.fd.x - o.fd.x, d.fd.y - o.fd.y); if (dist < nd) { nearestCargo = o; nd = dist; } }
          if (nearestCargo) { const orbitAngle = (Date.now() * 0.001 + d.id.charCodeAt(d.id.length - 1)) % PI2; const ox = nearestCargo.fd.x + Math.cos(orbitAngle) * 40; const oy = nearestCargo.fd.y + Math.sin(orbitAngle) * 40; d.fd.targetHdg = (Math.atan2(ox - d.fd.x, oy - d.fd.y) / DEG + 360) % 360; d.fd.targetSpeed = d.spec.cruiseSpeed * 0.7; d.fd.targetAlt = nearestCargo.fd.alt + 20; }
        } else if (this.waypoints.length > 0) {
          const wp = this.waypoints[d.wpIdx % this.waypoints.length];
          const dx = wp.x - d.fd.x, dy = wp.y - d.fd.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 30) d.wpIdx = (d.wpIdx + 1) % this.waypoints.length;
          else { d.fd.targetHdg = (Math.atan2(dx, dy) / DEG + 360) % 360; d.fd.targetSpeed = dist > 200 ? d.spec.cruiseSpeed : d.spec.cruiseSpeed * 0.6; }
          d.fd.targetAlt = wp.alt || 150;
        }
      }
      const sepDist = d.memory ? (d.memory.personality.teamwork > 0.7 ? 20 : d.memory.personality.teamwork < 0.3 ? 35 : 25) : 25;
      for (const o of this.drones) { if (o.id === d.id) continue; const sx = d.fd.x - o.fd.x, sy = d.fd.y - o.fd.y, sd = Math.sqrt(sx * sx + sy * sy); if (sd < sepDist && sd > 0) d.fd.targetHdg = (d.fd.targetHdg + ((Math.atan2(sx, sy) / DEG + 360) % 360 - d.fd.targetHdg) * ((sepDist - sd) / sepDist) * 0.3 + 360) % 360; }
      if (d.typeKey === "VEGA-X" && d.spec.iff === "FRIENDLY") { for (const o of this.drones) { if (o.spec.iff !== "HOSTILE" || o.status !== "ACTIVE") continue; if (Math.hypot(d.fd.x - o.fd.x, d.fd.y - o.fd.y) < 15) { o.status = "ELIMINATED"; if (d.memory) d.memory.eliminationCount++; if (this.onEliminate) this.onEliminate(o.id, d.id); } } }
      const evadeMul = d.memory ? (d.memory.personality.aggression < 0.3 ? 1.5 : d.memory.personality.aggression > 0.7 ? 0.8 : 1.2) : 1.2;
      for (const t of this.threats) { const tx = d.fd.x - t.x, ty = d.fd.y - t.y, td = Math.sqrt(tx * tx + ty * ty); if (td < t.radius * evadeMul) { d.fd.targetHdg = (Math.atan2(tx, ty) / DEG + 360) % 360; d.fd.targetSpeed = d.spec.maxSpeed; d.fd.targetAlt = Math.min(d.spec.maxAlt, d.fd.alt + 50); } if (t.type.includes("GPS") && td < t.radius) { d.fd.signal = Math.max(5, d.fd.signal - 2 * dt); d.fd.targetSpeed = Math.min(d.fd.targetSpeed, d.spec.cruiseSpeed * 0.7); } }
      if (d.memory && d.memory.personality.autonomy > 0.7 && Math.random() < 0.1 * dt) { d.fd.targetHdg = (d.fd.targetHdg + (Math.random() - 0.5) * 30 + 360) % 360; }
      if (d.memory) {
        d.memory.distanceTraveled += d.fd.speed * dt;
        d.memory.sectorsVisited.add(`${Math.floor((d.fd.x + 400) / 200)}-${Math.floor((d.fd.y + 400) / 200)}`);
        for (const t of this.threats) { const td2 = Math.hypot(d.fd.x - t.x, d.fd.y - t.y); if (td2 < t.radius) d.memory.timeInDangerZone += dt; if (td2 < t.radius * 0.5) d.memory.threatsEncountered.add(t.type); }
        for (const o of this.drones) { if (o.spec.iff === "HOSTILE" && o.status === "ACTIVE" && Math.hypot(d.fd.x - o.fd.x, d.fd.y - o.fd.y) < 20) d.memory.closeCallCount++; }
        d.memory.experienceScore = Math.min(100, Math.max(0, d.memory.sectorsVisited.size * 5 + d.memory.eliminationCount * 15 + d.memory.distanceTraveled * 0.005 + d.memory.missionPhases * 10 - d.memory.closeCallCount * 2));
      }
      d.fd.update(dt);
      d.trail.push({ x: d.fd.x, y: d.fd.y }); if (d.trail.length > 80) d.trail.shift();
    }
  }
}
