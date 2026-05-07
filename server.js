const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

loadEnvFile(path.join(__dirname, '.env'));

const API_KEY     = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const CLAUDE_MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5-20251001';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const PORT        = Number(process.env.PORT || 3000);
const PROJECT_DIR = path.join(__dirname, 'project');
const STATE_FILE  = process.env.STATE_FILE
  ? path.resolve(process.env.STATE_FILE)
  : path.join(__dirname, 'save.json');

// ── Tiny .env loader for local play; hosts can use real env vars ──
function loadEnvFile(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch(e) {
    // No local .env file is fine.
  }
}

// ── Find your local IP so phones on the same WiFi can connect ────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

// ── Optional basic password gate for hosted/private play ──────────
function isAuthorized(req) {
  if (!APP_PASSWORD) return true;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    return password === APP_PASSWORD;
  } catch(e) {
    return false;
  }
}

function askForPassword(res) {
  res.writeHead(401, {
    'Content-Type': 'text/plain',
    'WWW-Authenticate': 'Basic realm="Socials App"',
  });
  res.end('Password required');
}

// ── Claude API proxy ──────────────────────────────────────────────
function callClaude(messages, modelTier) {
  return new Promise((resolve, reject) => {
    const model = modelTier === 'fast' ? CLAUDE_MODEL_FAST : CLAUDE_MODEL;
    const body = JSON.stringify({
      model,
      max_tokens: 1024,
      messages,
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'content-length':    Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const usage = parsed.usage || {};
          console.log('[Claude usage]',
            'in:', usage.input_tokens || 0,
            '| cache_write:', usage.cache_creation_input_tokens || 0,
            '| cache_read:', usage.cache_read_input_tokens || 0,
            '| out:', usage.output_tokens || 0
          );
          resolve(parsed.content?.[0]?.text || '');
        } catch(e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── MIME types ────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.jsx':  'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ── Server ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  if (!isAuthorized(req)) {
    askForPassword(res);
    return;
  }

  // ── Claude proxy ──────────────────────────────────────────────
  if (req.url === '/api/claude' && req.method === 'POST') {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', async () => {
      try {
        if (!API_KEY || API_KEY === 'YOUR_API_KEY_HERE') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No ANTHROPIC_API_KEY environment variable set.' }));
          return;
        }
        const { messages, model } = JSON.parse(raw);
        const text = await callClaude(messages, model);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
      } catch(e) {
        console.error('Claude API error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Load saved game state ─────────────────────────────────────
  if (req.url === '/api/state' && req.method === 'GET') {
    try {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch(e) {
      // No save file yet — return empty object
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
    return;
  }

  // ── Save game state ───────────────────────────────────────────
  if (req.url === '/api/state' && req.method === 'POST') {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      try {
        // Validate JSON before writing
        JSON.parse(raw);
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, raw, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Reset saved game state ────────────────────────────────────
  if (req.url === '/api/state' && req.method === 'DELETE') {
    try {
      fs.rmSync(STATE_FILE, { force: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Static files ──────────────────────────────────────────────
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  pathname = decodeURIComponent(pathname);
  if (pathname === '/') pathname = '/CharacterFeed.html';

  const filePath = path.join(PROJECT_DIR, pathname);

  if (!filePath.startsWith(PROJECT_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${pathname}`);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('');
  console.log('  ✦ Socials App is running!');
  console.log('');
  console.log(`  On this Mac:  http://localhost:${PORT}`);
  if (localIP) {
    console.log(`  On your phone (same WiFi): http://${localIP}:${PORT}`);
  }
  console.log('');
  console.log(`  Your progress saves to: ${STATE_FILE}`);
  if (APP_PASSWORD) console.log('  Password protection is on.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
