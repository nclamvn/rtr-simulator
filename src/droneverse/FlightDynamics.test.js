import { describe, it, expect } from 'vitest';
import { FlightDynamics } from './FlightDynamics.js';

const mockSpec = { cruiseSpeed: 15, maxSpeed: 22, maxAlt: 500 };

describe('FlightDynamics', () => {
  it('initializes with correct defaults', () => {
    const fd = new FlightDynamics(mockSpec, 0, 0, 100, 90);
    expect(fd.x).toBe(0);
    expect(fd.y).toBe(0);
    expect(fd.alt).toBe(100);
    expect(fd.hdg).toBe(90);
    expect(fd.speed).toBeCloseTo(7.5); // cruiseSpeed * 0.5
    expect(fd.battery).toBeGreaterThan(90);
    expect(fd.windX).toBe(0);
  });

  it('accelerates toward target speed', () => {
    const fd = new FlightDynamics(mockSpec, 0, 0, 100, 0);
    fd.targetSpeed = 15;
    for (let i = 0; i < 100; i++) fd.update(0.1);
    expect(fd.speed).toBeGreaterThan(12);
  });

  it('turns toward target heading', () => {
    const fd = new FlightDynamics(mockSpec, 0, 0, 100, 0);
    fd.targetHdg = 90;
    for (let i = 0; i < 200; i++) fd.update(0.1);
    expect(fd.hdg).toBeGreaterThan(45);
  });

  it('climbs to target altitude', () => {
    const fd = new FlightDynamics(mockSpec, 0, 0, 100, 0);
    fd.targetAlt = 300;
    for (let i = 0; i < 200; i++) fd.update(0.1);
    expect(fd.alt).toBeGreaterThan(120);
  });

  it('drains battery over time', () => {
    const fd = new FlightDynamics(mockSpec, 0, 0, 100, 0);
    const startBat = fd.battery;
    for (let i = 0; i < 200; i++) fd.update(0.1);
    expect(fd.battery).toBeLessThan(startBat);
  });

  it('applies wind to position', () => {
    const fd = new FlightDynamics(mockSpec, 0, 0, 100, 0);
    fd.windX = 10; fd.windY = 0;
    fd.targetSpeed = 0;
    fd.speed = 0;
    for (let i = 0; i < 50; i++) fd.update(0.1);
    expect(fd.x).toBeGreaterThan(0); // drifted east
  });

  it('clamps altitude to maxAlt', () => {
    const fd = new FlightDynamics(mockSpec, 0, 0, 490, 0);
    fd.targetAlt = 600;
    for (let i = 0; i < 100; i++) fd.update(0.1);
    expect(fd.alt).toBeLessThanOrEqual(500);
  });
});
