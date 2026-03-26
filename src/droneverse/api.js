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

  // Predictive advisory — agents analyze situation and predict outcomes
  async predict(missionState, whatIf = "Đánh giá tình huống hiện tại") {
    const res = await fetch('/api/sim/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ missionState, whatIf }),
    });
    if (!res.ok) throw new Error(`MiroFish predict ${res.status}`);
    return res.json();
  },

  // ReACT tactical report — gathers Zep facts, reasons, writes debrief
  async generateReport(graphId, missionState, requirement = "Báo cáo chiến thuật tổng hợp") {
    const res = await fetch('/api/sim/report/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphId, missionState, requirement }),
    });
    if (!res.ok) throw new Error(`MiroFish report ${res.status}`);
    return res.json();
  },

  // Get raw intelligence from Zep graph
  async getIntelligence(graphId) {
    const res = await fetch(`/api/sim/report/intelligence/${graphId}`);
    if (!res.ok) throw new Error(`MiroFish intel ${res.status}`);
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
