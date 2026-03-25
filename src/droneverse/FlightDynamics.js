import { DEG } from "./constants.js";

export class FlightDynamics {
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
    const headwind = -(this.windX * Math.sin(r) + this.windY * Math.cos(r));
    const drainMul = headwind > 5 ? 1.5 : 1.0;
    this.battery = Math.max(0, this.battery - 0.03 * (this.speed / this.spec.cruiseSpeed) * (1 + Math.abs(this.vs) * 0.1) * drainMul * dt);
    this.signal = Math.max(20, Math.min(100, this.signal + (Math.random() - 0.5) * 1.5));
  }
}
