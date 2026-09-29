// killall.email: serves the landing page and the waitlist API
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 4 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  : null;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  // Install scripts, fetched with curl or irm
  '.sh': 'text/plain; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

async function migrate() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id bigserial PRIMARY KEY,
      email text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_key ON waitlist (lower(email))');
}

// Per-IP limit: 5 signups per 10 minutes
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}
setInterval(() => hits.clear(), 60 * 60 * 1000).unref();

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function joinWaitlist(req, res) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) {
    return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
  }

  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Send JSON with an email field.' });
  }

  // Bots fill the hidden field; pretend it worked
  if (data.company) return send(res, 200, { ok: true });

  const email = typeof data.email === 'string' ? data.email.trim() : '';
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return send(res, 400, { error: 'That does not look like an email address.' });
  }
  if (!pool) {
    return send(res, 503, { error: 'The waitlist is not connected yet. Try again later.' });
  }

  try {
    await pool.query(
      'INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT ((lower(email))) DO NOTHING',
      [email]
    );
    // Same answer for new and existing addresses, so the form can't be used to check who signed up
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error('waitlist insert failed', err);
    return send(res, 500, { error: 'Something went wrong on our side. Try again later.' });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let file = decodeURIComponent(url.pathname);
  if (file.endsWith('/')) file += 'index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');

  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, buf, {
      'content-type': TYPES[path.extname(full)] || 'application/octet-stream',
      'cache-control': full.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/waitlist' && req.method === 'POST') {
    joinWaitlist(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong on our side.' });
    });
    return;
  }
  if (req.url === '/health') return send(res, 200, { ok: true, db: Boolean(pool) });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res);
});

migrate()
  .catch((err) => console.error('migration failed', err))
  .finally(() => server.listen(PORT, () => console.log(`killall.email listening on ${PORT}`)));
