import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

app.use(express.json({ limit: '1mb' }));

// Serve built frontend
app.use(express.static(join(__dirname, 'dist')));

// Call Anthropic
async function callAnthropic(messages, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Anthropic error');
  return data;
}

// Call OpenAI
async function callOpenAI(messages, maxTokens) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: maxTokens, messages }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'OpenAI error');
  // Normalize to Anthropic response format
  return { content: [{ text: data.choices?.[0]?.message?.content || '' }] };
}

// AI Proxy endpoint — Anthropic first, fallback OpenAI
app.post('/api/ai', async (req, res) => {
  const { messages, max_tokens = 2000 } = req.body;

  // Try Anthropic first
  if (ANTHROPIC_KEY) {
    try {
      const data = await callAnthropic(messages, max_tokens);
      return res.json({ ...data, _provider: 'anthropic' });
    } catch (err) {
      console.error('Anthropic failed:', err.message);
    }
  }

  // Fallback to OpenAI
  if (OPENAI_KEY) {
    try {
      const data = await callOpenAI(messages, max_tokens);
      return res.json({ ...data, _provider: 'openai' });
    } catch (err) {
      console.error('OpenAI failed:', err.message);
    }
  }

  // Both failed or no keys
  if (!ANTHROPIC_KEY && !OPENAI_KEY) {
    return res.status(500).json({ error: 'No API keys configured' });
  }
  res.status(502).json({ error: 'All AI providers unavailable' });
});

// Health check
app.get('/health', (req, res) => res.json({
  status: 'ok',
  providers: { anthropic: !!ANTHROPIC_KEY, openai: !!OPENAI_KEY },
  timestamp: Date.now(),
}));

// SPA fallback
app.get('*', (req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')));

app.listen(PORT, () => {
  console.log(`DroneVerse server on port ${PORT}`);
  console.log(`AI providers: Anthropic=${ANTHROPIC_KEY ? 'YES' : 'NO'}, OpenAI=${OPENAI_KEY ? 'YES' : 'NO'}`);
});
