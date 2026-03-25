import { describe, it, expect } from 'vitest';
import { SwarmController } from './SwarmController.js';

describe('SwarmController', () => {
  it('adds drones with correct spec', () => {
    const sc = new SwarmController();
    sc.addDrone('D-1', 'HERA-S', 0, 0, 100, 0);
    expect(sc.drones).toHaveLength(1);
    expect(sc.drones[0].id).toBe('D-1');
    expect(sc.drones[0].spec.iff).toBe('FRIENDLY');
    expect(sc.drones[0].memory).toBeDefined();
    expect(sc.drones[0].memory.personality.aggression).toBeGreaterThanOrEqual(0);
  });

  it('adds hostile drones', () => {
    const sc = new SwarmController();
    sc.addDrone('B-1', 'BOGEY', 100, 100, 200, 180);
    expect(sc.drones[0].spec.iff).toBe('HOSTILE');
  });

  it('assigns waypoints', () => {
    const sc = new SwarmController();
    sc.assignWaypoints([{ x: 100, y: 200, alt: 150 }]);
    expect(sc.waypoints).toHaveLength(1);
  });

  it('updates drone positions (drone moves from start)', () => {
    const sc = new SwarmController();
    sc.addDrone('D-1', 'HERA-S', 0, 0, 100, 0);
    sc.assignWaypoints([{ x: 0, y: 200, alt: 100 }]);
    for (let i = 0; i < 50; i++) sc.update(0.2);
    const dist = Math.hypot(sc.drones[0].fd.x, sc.drones[0].fd.y);
    expect(dist).toBeGreaterThan(5); // drone has moved from origin
  });

  it('VEGA-X eliminates nearby BOGEY', () => {
    const sc = new SwarmController();
    sc.addDrone('V-1', 'VEGA-X', 0, 0, 100, 0);
    sc.addDrone('B-1', 'BOGEY', 5, 5, 100, 180);
    let eliminated = false;
    sc.onEliminate = () => { eliminated = true; };
    sc.update(0.1);
    expect(sc.drones[1].status).toBe('ELIMINATED');
    expect(eliminated).toBe(true);
  });

  it('tracks trail history', () => {
    const sc = new SwarmController();
    sc.addDrone('D-1', 'HERA-S', 0, 0, 100, 0);
    for (let i = 0; i < 10; i++) sc.update(0.2);
    expect(sc.drones[0].trail.length).toBeGreaterThan(0);
  });

  it('updates agent memory', () => {
    const sc = new SwarmController();
    sc.addDrone('D-1', 'HERA-S', 0, 0, 100, 0);
    for (let i = 0; i < 20; i++) sc.update(0.2);
    expect(sc.drones[0].memory.distanceTraveled).toBeGreaterThan(0);
    expect(sc.drones[0].memory.sectorsVisited.size).toBeGreaterThan(0);
  });
});
