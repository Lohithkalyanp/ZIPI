// HTTP layer: static files, JSON API, live events (SSE), uploads, CSV streaming, backups download, health and metrics.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { config, ROOT } from './config.js';
import { log } from './log.js';
import { APPS } from './app/context.js';
import { MIME as FILE_MIME } from './services/storage.js';
import { BACKUP_DIR, BACKUP_RX } from './services/backup.js';

const PUB = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN', 'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" };

/* ---------- tokens: userId.expiry.version.app, HMAC-signed; one app per token ---------- */
const sign = s => crypto.createHmac('sha256', config.secret).update(s).digest('base64url');
export const issueToken = (u, app = 'customer') => { const p = `${u.id}.${Date.now() + 30 * 86400000}.${u.tokenVer || 0}.${app}`; return `${Buffer.from(p).toString('base64url')}.${sign(p)}`; };
function parseToken(tok) {
  if (!tok) return null;
  const [b, sig] = String(tok).split('.'); if (!b || !sig) return null;
  const p = Buffer.from(b, 'base64url').toString(), good = sign(p);
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return null;
  const [id, exp, ver = '0', app = 'customer'] = p.split('.'); if (+exp < Date.now()) return null;
  return { id, ver, app: APPS[app] ? app : 'customer' };
}

export function makeServer(app) {
  const { c, db } = app;
  async function session(tok) {
    const t = parseToken(tok); if (!t) return { user: null, app: 'customer' };
    const u = await db.get('users', t.id);
    return { user: u && String(u.tokenVer || 0) === t.ver ? u : null, app: t.app };
  }

  /* ---------- per-process rate limit (the load balancer spreads traffic; OTP limits are global in the database) ---------- */
  const hits = new Map();
  const limited = (key, max, win) => { const t = Date.now(); let e = hits.get(key); if (!e || e.reset < t) { e = { n: 0, reset: t + win }; hits.set(key, e); } return ++e.n > max; };
  setInterval(() => { const t = Date.now(); for (const [k, e] of hits) if (e.reset < t) hits.delete(k); }, 60000).unref();
  const clientIp = req => { const ra = req.socket.remoteAddress || ''; const local = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1'; const x = req.headers['x-forwarded-for']; return x && (local || config.trustProxy) ? String(x).split(',')[0].trim() : ra; };

  /* ---------- live events ---------- */
  const clients = new Set();
  c.sseCount = () => clients.size;
  app.bus.on(async ev => {
    if (!clients.size) return;
    const msg = `data: ${JSON.stringify({ type: ev.type, id: ev.id, status: ev.status, pos: ev.pos, orders: ev.orders })}\n\n`;
    let riderZones = null;
    for (const cl of clients) {
      const u = cl.user;
      let send = ev.users?.includes(u.id) || (cl.app === 'admin' && u.roles.includes('admin')) || (cl.app === 'manager' && u.roles.includes('manager') && u.zoneId === ev.zoneId);
      if (!send && ev.ridersZone && cl.app === 'rider') { riderZones ||= new Map(); if (!riderZones.has(u.id)) { const r = await db.one('riders', { userId: u.id }); riderZones.set(u.id, r && r.online ? r.zoneId : null); } send = riderZones.get(u.id) === ev.zoneId; }
      if (send) cl.res.write(msg);
    }
  });
  setInterval(() => { for (const cl of clients) cl.res.write(': ping\n\n'); }, 25000).unref();

  /* ---------- static files: cached in memory with ETag and gzip ---------- */
  const cache = new Map();
  async function staticFile(req, res, file, { maxAge = 0 } = {}) {
    let e = cache.get(file);
    try {
      const st = await fs.promises.stat(file); if (!st.isFile()) throw new Error('not file');
      if (!e || e.mtime !== st.mtimeMs) {
        const raw = await fs.promises.readFile(file), type = MIME[path.extname(file)] || 'application/octet-stream';
        e = { raw, gz: /text|javascript|json|svg|manifest/.test(type) && raw.length > 1024 ? zlib.gzipSync(raw) : null, type, mtime: st.mtimeMs, etag: '"' + crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16) + '"' };
        if (raw.length < 2e6) cache.set(file, e);
      }
    } catch { res.writeHead(404, SEC); return res.end('Not found'); }
    const h = { ...SEC, 'Content-Type': e.type, ETag: e.etag, 'Cache-Control': maxAge ? `public, max-age=${maxAge}, immutable` : 'no-cache', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, h); return res.end(); }
    if (e.gz && /gzip/.test(req.headers['accept-encoding'] || '')) { res.writeHead(200, { ...h, 'Content-Encoding': 'gzip', 'Content-Length': e.gz.length }); return res.end(e.gz); }
    res.writeHead(200, { ...h, 'Content-Length': e.raw.length }); res.end(e.raw);
  }
  const safeJoin = (base, p) => { let d; try { d = decodeURIComponent(p); } catch { return null; } const f = path.normalize(path.join(base, d)); return f.startsWith(base + path.sep) || f === base ? f : null; };

  function sendJson(req, res, status, data, extra = {}) {
    const body = Buffer.from(JSON.stringify(data));
    const h = { ...SEC, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra };
    if (req.headers['x-forwarded-proto'] === 'https') h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    if (body.length > 1400 && /gzip/.test(req.headers['accept-encoding'] || '')) { const gz = zlib.gzipSync(body); res.writeHead(status, { ...h, 'Content-Encoding': 'gzip', 'Content-Length': gz.length, Vary: 'Accept-Encoding' }); return res.end(gz); }
    res.writeHead(status, { ...h, 'Content-Length': body.length }); res.end(body);
  }
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  async function streamCsv(res, csv) {
    res.writeHead(200, { ...SEC, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${csv.filename}"`, 'Cache-Control': 'no-store' });
    res.write('﻿' + csv.header.map(csvCell).join(',') + '\r\n');
    let buf = '', n = 0;
    try {
      for await (const row of csv.rows) {
        buf += row.map(csvCell).join(',') + '\r\n';
        if (++n % 500 === 0) { if (!res.write(buf)) await new Promise(r => res.once('drain', r)); buf = ''; }
        if (res.destroyed) return;
      }
      res.end(buf);
    } catch (err) { log.error('csv stream failed', { err }); res.end(buf + '\r\n"Export stopped because of an error. Please try again."\r\n'); }
  }

  /* ---------- metrics (Prometheus text format) ---------- */
  const metrics = { requests: 0, errors: 0, byStatus: {}, latency: [0, 0, 0, 0, 0, 0] }, BUCKETS = [50, 100, 250, 500, 1000, Infinity];
  const observe = (status, ms) => { metrics.requests++; metrics.byStatus[status] = (metrics.byStatus[status] || 0) + 1; if (status >= 500) metrics.errors++; metrics.latency[BUCKETS.findIndex(b => ms <= b)]++; };

  const server = http.createServer(async (req, res) => {
    const t0 = performance.now(), rid = crypto.randomBytes(6).toString('base64url');
    res.setHeader('X-Request-Id', rid);
    let url; try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
    const p = url.pathname, ip = clientIp(req);
    req.setTimeout(30000);

    if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (p === '/readyz') { const ok = await db.q('SELECT 1').then(() => true, () => false); res.writeHead(ok ? 200 : 503, { 'Content-Type': 'text/plain' }); return res.end(ok ? 'ready' : 'database unavailable'); }
    if (p === '/metrics') {
      if (!config.metricsToken || req.headers.authorization !== 'Bearer ' + config.metricsToken) { res.writeHead(404); return res.end(); }
      const pool = c.dbStats?.() || {}, mem = process.memoryUsage();
      let out = `# TYPE zipi_requests_total counter\nzipi_requests_total ${metrics.requests}\nzipi_errors_total ${metrics.errors}\n`;
      for (const [s, n] of Object.entries(metrics.byStatus)) out += `zipi_responses_total{status="${s}"} ${n}\n`;
      let cum = 0; BUCKETS.forEach((b, i) => { cum += metrics.latency[i]; out += `zipi_request_ms_bucket{le="${b === Infinity ? '+Inf' : b}"} ${cum}\n`; });
      out += `zipi_sse_clients ${clients.size}\nzipi_db_pool_total ${pool.total || 0}\nzipi_db_pool_waiting ${pool.waiting || 0}\nzipi_memory_rss_bytes ${mem.rss}\n`;
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }); return res.end(out);
    }

    if (p.startsWith('/api/')) {
      res.on('finish', () => { const ms = Math.round(performance.now() - t0); observe(res.statusCode, ms); if (ms > 1500 || res.statusCode >= 500) log.warn('slow or failed request', { rid, method: req.method, path: p, status: res.statusCode, ms }); else log.debug('request', { method: req.method, path: p, status: res.statusCode, ms }); });
      const kind = p === '/api/auth/otp' ? 'otp' : p === '/api/auth/verify' ? 'verify' : p === '/api/upload' ? 'upload' : null;
      if (p !== '/api/health' && (limited('api|' + ip, 300, 60000) || (kind && req.method === 'POST' && limited(kind + '|' + ip, { otp: 10, verify: 30, upload: 40 }[kind], 600000)) || (p.startsWith('/api/maps/') && limited('maps|' + ip, 60, 600000))))
        return sendJson(req, res, 429, { error: kind === 'otp' ? 'Too many code requests from this network. Try again in 10 minutes.' : 'Too many requests. Please slow down.' }, { 'Retry-After': '60' });

      if (p === '/api/stream') {
        const s = await session(url.searchParams.get('token')); if (!s.user || s.user.blocked || !c.canUseApp(s.user, s.app)) { res.writeHead(401); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.write('retry: 3000\n\n');
        const cl = { res, user: s.user, app: s.app }; clients.add(cl); req.on('close', () => clients.delete(cl)); return;
      }
      const bk = /^\/api\/admin\/storage\/backups\/([\w.-]+)$/.exec(p);
      if (bk && req.method === 'GET') {
        const s = await session((req.headers.authorization || '').replace(/^Bearer /, ''));
        if (!app.can(s.user, s.app, 'data')) return sendJson(req, res, 403, { error: 'You do not have access to backups' });
        if (!BACKUP_RX.test(bk[1]) || !fs.existsSync(path.join(BACKUP_DIR, bk[1]))) return sendJson(req, res, 404, { error: 'Backup not found' });
        await c.audit(s.user, 'backup downloaded', bk[1]);
        res.writeHead(200, { ...SEC, 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${bk[1]}"`, 'Cache-Control': 'no-store' });
        return fs.createReadStream(path.join(BACKUP_DIR, bk[1])).pipe(res);
      }
      const maxBody = p === '/api/upload' ? 4.5e6 : 256e3;
      if (+req.headers['content-length'] > maxBody) return sendJson(req, res, 413, { error: 'Request too large' });
      const chunks = []; let size = 0, aborted = false;
      req.on('data', ch => { size += ch.length; if (size > maxBody && !aborted) { aborted = true; sendJson(req, res, 413, { error: 'Request too large' }); req.destroy(); } else chunks.push(ch); });
      req.on('end', async () => {
        if (aborted) return;
        let body = {};
        if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(req, res, 400, { error: 'Invalid request' }); } }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) body = {};
        let s;
        try { s = await session((req.headers.authorization || '').replace(/^Bearer /, '')); }
        catch (err) { log.error('session lookup failed', { err, rid }); return sendJson(req, res, 503, { error: 'Service is busy. Please try again.', ref: rid }); }
        const out = await app.handle(req.method, p, { body, query: Object.fromEntries(url.searchParams), user: s.user, app: s.app, meta: { ip, ua: req.headers['user-agent'] || '', rid, idem: req.headers['idempotency-key'] || '' } });
        if (out.csv) return streamCsv(res, out.csv);
        sendJson(req, res, out.status, out.data, out.status === 429 && out.data.retryAfter ? { 'Retry-After': String(out.data.retryAfter) } : {});
      });
      return;
    }
    if (p.startsWith('/uploads/')) {
      const name = p.slice(9), f = await c.storage.open(name).catch(() => null);
      if (!f) { res.writeHead(404, SEC); return res.end('Not found'); }
      const type = FILE_MIME[name.split('.').pop()] || 'application/octet-stream';
      res.writeHead(200, { ...SEC, 'Content-Type': type, 'Content-Length': f.size, 'Cache-Control': 'private, max-age=86400', ...(type === 'application/pdf' ? { 'Content-Disposition': 'inline' } : {}) });
      return f.stream ? f.stream.pipe(res) : res.end(f.buffer);
    }
    if (p === '/app.webmanifest') {
      const k = APPS[url.searchParams.get('a')] ? url.searchParams.get('a') : 'customer', a = APPS[k];
      return sendJson(req, res, 200, { name: k === 'customer' ? 'ZIPI' : `ZIPI ${a.name}`, short_name: k === 'customer' ? 'ZIPI' : a.name.split(' ')[0], id: a.path, start_url: a.path, scope: '/',
        display: 'standalone', background_color: '#f5f6f3', theme_color: '#0c3b26', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' });
    }
    if (p === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
    let f = safeJoin(PUB, p === '/' ? 'index.html' : p.slice(1));
    if (!f || !path.extname(f)) f = path.join(PUB, 'index.html');
    return staticFile(req, res, f, { maxAge: p.startsWith('/vendor/leaflet/') ? 2592000 : 0 });
  });
  server.keepAliveTimeout = 65000; server.headersTimeout = 66000; server.requestTimeout = 60000;
  return { server, clients };
}
