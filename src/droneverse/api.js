// AI LLM proxy (Anthropic + OpenAI fallback)
export async function callAI(messages, maxTokens = 2000) {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.content?.[0]?.text || null;
}

// MiroFish Swarm Intelligence API
export const mirofish = {
  // Build knowledge graph from mission data
  async buildGraph(missionText, graphName = "DroneVerse Mission") {
    const res = await fetch('/api/sim/graph/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: missionText, graph_name: graphName }),
    });
    if (!res.ok) throw new Error(`MiroFish graph ${res.status}`);
    return res.json();
  },

  // Get graph status
  async getGraphStatus(taskId) {
    const res = await fetch(`/api/sim/graph/status/${taskId}`);
    if (!res.ok) throw new Error(`MiroFish status ${res.status}`);
    return res.json();
  },

  // Run predictive simulation
  async simulate(graphId, config) {
    const res = await fetch('/api/sim/simulation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph_id: graphId, ...config }),
    });
    if (!res.ok) throw new Error(`MiroFish sim ${res.status}`);
    return res.json();
  },

  // Generate ReACT analysis report
  async generateReport(graphId, requirement) {
    const res = await fetch('/api/sim/report/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph_id: graphId, requirement }),
    });
    if (!res.ok) throw new Error(`MiroFish report ${res.status}`);
    return res.json();
  },

  // Query agent memory
  async queryMemory(graphId, query) {
    const res = await fetch('/api/sim/graph/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph_id: graphId, query }),
    });
    if (!res.ok) throw new Error(`MiroFish memory ${res.status}`);
    return res.json();
  },

  // Check MiroFish backend health
  async health() {
    try {
      const res = await fetch('/api/sim/health');
      return res.ok;
    } catch { return false; }
  },
};
