// API client. Server only (the in-browser demo mode was removed for production).
// Reads are retried once on a network blip; writes are never retried automatically (orders use an idempotency key instead).
export class ApiError extends Error { constructor(m, s, data) { super(m); this.status = s; this.data = data; } }
let token = null, es = null, retry = 0;
const listeners = new Set();
const fire = e => listeners.forEach(f => { try { f(e); } catch (x) { console.error(x); } });

function connect() {
  if (es) { es.close(); es = null; }
  if (!token || typeof EventSource === 'undefined') return;
  es = new EventSource('/api/stream?token=' + encodeURIComponent(token));
  es.onopen = () => { retry = 0; };
  es.onmessage = m => { try { fire(JSON.parse(m.data)); } catch { } };
  es.onerror = () => { if (es.readyState === 2) { es = null; setTimeout(connect, Math.min(30000, 2000 * 2 ** retry++)); } };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const api = {
  mode: 'server',
  async init() { /* nothing to probe any more; kept for callers */ },
  setToken(t) { token = t; connect(); },
  get token() { return token; },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  resetDemo() {},
  async call(method, path, body, { headers = {} } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
      } catch {
        if (method === 'GET' && attempt < 1) { await sleep(800); continue; }
        throw new ApiError(navigator.onLine === false ? 'You are offline. Check your internet connection.' : 'Could not reach ZIPI. Please try again.', 0);
      }
      if ((res.status === 502 || res.status === 503 || res.status === 504) && method === 'GET' && attempt < 1) { await sleep(1000); continue; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(data.error || 'Request failed', res.status, data);
      return data;
    }
  },
  get(path, q) { const qs = q ? '?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')) : ''; return this.call('GET', path + qs); },
  post(path, b = {}, opts) { return this.call('POST', path, b, opts); },
  patch(path, b = {}) { return this.call('PATCH', path, b); },
  del(path) { return this.call('DELETE', path); },
  // file downloads (CSV reports, backups) with the login token
  async download(path, q, fallbackName) {
    const qs = q ? '?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v)) : '';
    const r = await fetch(path + qs, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!r.ok) throw new ApiError((await r.json().catch(() => ({}))).error || 'Download failed', r.status);
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || fallbackName;
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return name;
  },
};
