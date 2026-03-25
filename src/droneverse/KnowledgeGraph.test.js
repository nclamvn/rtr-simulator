import { describe, it, expect } from 'vitest';
import { KnowledgeGraph } from './KnowledgeGraph.js';

describe('KnowledgeGraph', () => {
  it('adds and queries nodes', () => {
    const kg = new KnowledgeGraph();
    kg.addNode('d1', 'drone', 'HERA-01', { x: 0, y: 0 });
    kg.addNode('d2', 'drone', 'HERA-02', { x: 10, y: 10 });
    const drones = kg.query('drone');
    expect(drones).toHaveLength(2);
    expect(drones[0].id).toBe('d1');
  });

  it('adds and finds edges', () => {
    const kg = new KnowledgeGraph();
    kg.addNode('d1', 'drone', 'D1');
    kg.addNode('t1', 'threat', 'SAM');
    kg.addEdge('d1', 't1', 'detected');
    const neighbors = kg.getNeighbors('d1', 'detected');
    expect(neighbors).toContain('t1');
  });

  it('removes edges by relation', () => {
    const kg = new KnowledgeGraph();
    kg.addEdge('a', 'b', 'proximity');
    kg.addEdge('a', 'c', 'proximity');
    kg.addEdge('a', 'd', 'detected');
    kg.removeEdges('proximity');
    expect(kg.edges).toHaveLength(1);
    expect(kg.edges[0].relation).toBe('detected');
  });

  it('updates node data', () => {
    const kg = new KnowledgeGraph();
    kg.addNode('d1', 'drone', 'D1', { battery: 100 });
    kg.updateNode('d1', { battery: 50 });
    expect(kg.nodes.get('d1').data.battery).toBe(50);
  });

  it('adds events with FIFO limit', () => {
    const kg = new KnowledgeGraph();
    for (let i = 0; i < 105; i++) kg.addEvent(`Event ${i}`);
    const events = kg.query('event');
    expect(events.length).toBeLessThanOrEqual(100);
  });

  it('generates summary', () => {
    const kg = new KnowledgeGraph();
    kg.addNode('d1', 'drone', 'D1');
    kg.addNode('t1', 'threat', 'SAM');
    kg.addEdge('d1', 't1', 'detected');
    const summary = kg.toSummary();
    expect(summary.nodeCount).toBe(2);
    expect(summary.edgeCount).toBe(1);
    expect(summary.types.drone).toBe(1);
  });
});
