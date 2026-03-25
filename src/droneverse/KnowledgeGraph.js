export class KnowledgeGraph {
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
