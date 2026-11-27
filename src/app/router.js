// Routing, authentication checks and permissions for every API call.
//   roles: null (public) | 'any' (logged in) | 'vendor' | 'rider' | 'manager' | 'admin' | 'staff' (admin console or zone manager)
//   perm:  admin permission key (ADMIN_PERMS) or, for manager routes, a MANAGER_PERMS key
// A route may return { csv: { filename, header, rows } } where rows is an async iterable; the HTTP layer streams it.
import { HttpError, fail, APPS, MANAGER_PERMS } from './context.js';
import { log } from '../log.js';

const ROUTE_APPS = { vendor: ['vendor'], rider: ['rider'], manager: ['manager', 'admin'], admin: ['admin'], staff: ['manager', 'admin'] };

export function makeRouter(c) {
  const table = new Map(); // method -> [{parts, ...}]
  function route(method, path, roles, fn, perm = null) {
    if (!table.has(method)) table.set(method, []);
    table.get(method).push({ method, path, parts: path.split('/').filter(Boolean), roles, fn, perm });
  }
  function match(method, path) {
    const parts = path.split('/').filter(Boolean);
    for (const r of table.get(method) || []) {
      if (r.parts.length !== parts.length) continue;
      const params = {}; let ok = true;
      for (let i = 0; i < parts.length; i++) {
        if (r.parts[i][0] === ':') { try { params[r.parts[i].slice(1)] = decodeURIComponent(parts[i]); } catch { ok = false; break; } }
        else if (r.parts[i] !== parts[i]) { ok = false; break; }
      }
      if (ok) return { r, params };
    }
    return null;
  }
  async function handle(method, path, { body = {}, query = {}, user = null, app = 'customer', meta = {} } = {}) {
    if (!APPS[app]) app = 'customer';
    const m = match(method, path);
    if (!m) return { status: 404, data: { error: 'Not found' } };
    const { r, params } = m;
    try {
      if (r.roles) {
        if (!user) fail(401, 'Please log in');
        if (user.blocked) fail(403, 'This account is blocked. Contact support.');
        if (!c.canUseApp(user, app)) fail(401, `Your access to the ${APPS[app].name} was removed. Contact a ZIPI admin.`);
        const apps = ROUTE_APPS[r.roles];
        if (apps && !apps.includes(app)) fail(403, `This can only be done from the ${APPS[apps[0]].name}`);
        if (r.roles === 'staff') { if (!c.has(user, 'admin') && !c.has(user, 'manager')) fail(403, 'You do not have access to this'); }
        else if (r.roles !== 'any' && !c.has(user, r.roles) && !(r.roles === 'manager' && c.has(user, 'admin'))) fail(403, 'You do not have access to this');
        if (r.perm && !c.permOk(user, app, r.roles === 'staff' && app === 'manager' ? { ...r, perm: r.perm.manager } : r.roles === 'staff' ? { ...r, perm: r.perm.admin } : r)) fail(403, 'Your account does not have permission for this. Ask a super admin.');
      }
      const data = await r.fn({ body: body || {}, query: query || {}, user, params, app, meta, c });
      if (data && data.csv) return { status: 200, csv: data.csv };
      return { status: 200, data };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, data: { error: e.message, ...(e.extra || {}) } };
      if (e && e.status && e.message && e.constructor?.name === 'OtpError') return { status: e.status, data: { error: e.message, retryAfter: e.retryAfter } };
      log.error('request failed', { method, path, err: e, rid: meta.rid });
      return { status: 500, data: { error: 'Something went wrong on our side. Please try again.', ref: meta.rid } };
    }
  }
  // used by the HTTP layer for file downloads that bypass JSON
  const can = (user, app, perm) => !!user && !user.blocked && app === 'admin' && c.canUseApp(user, 'admin') && (c.adminPerms(user).includes('*') || c.adminPerms(user).includes(perm));
  return { route, handle, can, routes: () => [...table.values()].flat(), MANAGER_PERMS };
}
