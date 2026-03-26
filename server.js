import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MIROFISH_URL = process.env.MIROFISH_URL || 'http://localhost:5001';

// Security headers
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Rate limiting — 100 AI requests per 15 minutes per IP
const aiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Rate limit exceeded — try again later' } });

app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path !== '/health') console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// Serve built frontend
app.use(express.static(join(__dirname, 'dist')));

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

async function callOpenAI(messages, maxTokens) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: maxTokens, messages }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'OpenAI error');
  return { content: [{ text: data.choices?.[0]?.message?.content || '' }] };
}

// AI Proxy — rate limited + input validated
app.post('/api/ai', aiLimiter, async (req, res) => {
  const { messages, max_tokens = 2000 } = req.body;

  // Input validation
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }
  if (typeof max_tokens !== 'number' || max_tokens < 1 || max_tokens > 4000) {
    return res.status(400).json({ error: 'max_tokens must be 1-4000' });
  }
  for (const m of messages) {
    if (!m.role || !m.content || typeof m.content !== 'string') {
      return res.status(400).json({ error: 'Each message must have role and content string' });
    }
  }

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

  if (!ANTHROPIC_KEY && !OPENAI_KEY) {
    return res.status(500).json({ error: 'No API keys configured' });
  }
  res.status(502).json({ error: 'All AI providers unavailable' });
});

// MiroFish Swarm Intelligence proxy
app.all('/api/sim/*', async (req, res) => {
  const path = req.path.replace('/api/sim', '');
  try {
    const response = await fetch(`${MIROFISH_URL}/api${path}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      ...(req.method !== 'GET' && { body: JSON.stringify(req.body) }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('MiroFish proxy error:', err.message);
    res.status(502).json({ error: 'MiroFish backend unavailable', detail: err.message });
  }
});

app.get('/health', async (req, res) => {
  let mirofishOk = false;
  try { const r = await fetch(`${MIROFISH_URL}/api/health`); mirofishOk = r.ok; } catch {}
  res.json({
    status: 'ok',
    providers: { anthropic: !!ANTHROPIC_KEY, openai: !!OPENAI_KEY, mirofish: mirofishOk },
    mirofish_url: MIROFISH_URL,
    timestamp: Date.now(),
  });
});

app.get('*', (req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')));

app.listen(PORT, () => {
  console.log(`DroneVerse server on port ${PORT}`);
  console.log(`AI providers: Anthropic=${ANTHROPIC_KEY ? 'YES' : 'NO'}, OpenAI=${OPENAI_KEY ? 'YES' : 'NO'}`);
});
