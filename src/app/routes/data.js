// Data & storage, record recovery, backups, uploaded files, and system health with one-click fixes for stuck data.
import fs from 'node:fs';
import path from 'node:path';
import { fail, str, num, CUST_LIVE, ACTIVE, DAY } from '../context.js';
import { N, T, TRACKED } from '../../db/repo.js';
import { COLLECTIONS } from '../../db/schema.js';
import { backupAll, listBackups, BACKUP_DIR } from '../../services/backup.js';
import { maskFields } from '../../services/crypto.js';

const SPACES = [
  ['customer', 'Customer app', ['users', 'wallet', 'feedback', 'waitlist', 'tickets']],
  ['vendor', 'Shop console', ['vendors', 'items']],
  ['rider', 'Rider app', ['riders', 'shifts', 'cashlogs']],
  ['ops', 'Orders & money', ['orders', 'payouts', 'coupons']],
  ['config', 'Zones & settings', ['zones', 'settings']],
  ['system', 'Security & analytics', ['audit', 'logins', 'events', 'otps']],
];
const redact = (coll, d) => {
  if (!d) return d;
  if (coll === 'otps') return { ...d, hash: '••••••' };
  if (coll === 'users') return { ...d, tokenVer: undefined };
  if (coll === 'orders') return { ...d, otp: '••••' };
  return maskFields(coll, d);
};

export default function data(route, c) {
  const { db } = c;
  const startedAt = Date.now();

  route('GET', '/api/admin/storage', 'admin', async () => {
    const sizes = new Map((await db.q(`SELECT relname AS t, n_live_tup::bigint AS n, pg_total_relation_size(relid)::bigint AS b FROM pg_stat_user_tables`).catch(() => ({ rows: [] }))).rows.map(r => [r.t, r]));
    const spaces = await Promise.all(SPACES.map(async ([key, name, cs]) => {
      const colls = await Promise.all(cs.map(async coll => ({ name: coll, count: sizes.has(coll) && sizes.get(coll).n > 50000 ? sizes.get(coll).n : await db.count(coll), bytes: Number(sizes.get(coll)?.b || 0) })));
      return { key, name, colls, count: colls.reduce((a, x) => a + x.count, 0), bytes: colls.reduce((a, x) => a + x.bytes, 0) };
    }));
    const dbBytes = Number((await db.q('SELECT pg_database_size(current_database())::bigint AS b').catch(() => ({ rows: [{ b: 0 }] }))).rows[0].b);
    const backups = listBackups(), uploads = await c.storage.list().catch(() => []);
    const hist = (await db.q('SELECT count(*)::int AS n, pg_total_relation_size(\'history\')::bigint AS b FROM history').catch(() => ({ rows: [{ n: 0, b: 0 }] }))).rows[0];
    return { spaces, backups, uploads: uploads.length, history: { count: hist.n, bytes: Number(hist.b) },
      stats: { dbBytes, uploadsBytes: uploads.reduce((a, f) => a + f.bytes, 0), uploads: uploads.length, backupsBytes: backups.reduce((a, b) => a + b.bytes, 0), dataDir: c.config.databaseUrl ? 'PostgreSQL' : 'embedded database', storage: c.storage.driver } };
  }, 'data');
  route('GET', '/api/admin/storage/:coll', 'admin', async ({ params, query, user }) => {
    const coll = params.coll; if (!COLLECTIONS.includes(coll)) fail(404, 'No such data');
    const q = str(query.q, 60), page = Math.max(0, Math.round(num(query.page || 0, 'Page', 0, 1e6))), all = query.all === '1';
    const where = q ? `data::text ILIKE $1` : 'TRUE', params_ = q ? [`%${q}%`] : [];
    const total = q ? (await db.q(`SELECT count(*)::int AS n FROM (SELECT 1 FROM "${coll}" WHERE ${where} LIMIT 10001) x`, params_)).rows[0].n : await db.count(coll);
    const limit = all ? 50000 : 50;
    const r = await db.q(`SELECT data FROM "${coll}" WHERE ${where} ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${all ? 0 : page * 50}`, params_);
    if (all) await c.audit(user, 'data exported', coll, `${r.rows.length} records${q ? ` matching "${q}"` : ''}`);
    return { coll, total, page, tracked: TRACKED.has(coll), rows: r.rows.map(x => redact(coll, x.data)) };
  }, 'data');

  /* ---------- recovery: every change to important records is kept; any version can be restored ---------- */
  route('GET', '/api/admin/recovery/history/:coll/:id', 'admin', async ({ params }) => {
    if (!TRACKED.has(params.coll)) fail(400, 'Changes to this data are not versioned');
    const r = await db.q(`SELECT hid, op, data, by, at FROM history WHERE coll = $1 AND doc_id = $2 ORDER BY at DESC LIMIT 100`, [params.coll, params.id]);
    const who = await db.getMany('users', r.rows.map(x => x.by));
    return { current: redact(params.coll, await db.get(params.coll, params.id)), versions: r.rows.map(x => ({ hid: Number(x.hid), op: x.op, at: Number(x.at), byName: who.get(x.by)?.name || (x.by ? 'Unknown' : 'System'), data: redact(params.coll, x.data) })) };
  }, 'data');
  route('GET', '/api/admin/recovery/deleted', 'admin', async ({ query }) => {
    const coll = query.coll && TRACKED.has(query.coll) ? query.coll : null;
    const r = await db.q(`SELECT h.hid, h.coll, h.doc_id, h.data, h.by, h.at FROM history h WHERE h.op = 'delete' ${coll ? 'AND h.coll = $1' : ''}
      AND NOT EXISTS (SELECT 1 FROM history h2 WHERE h2.coll = h.coll AND h2.doc_id = h.doc_id AND h2.op = 'restore' AND h2.at > h.at) ORDER BY h.at DESC LIMIT 200`, coll ? [coll] : []);
    const who = await db.getMany('users', r.rows.map(x => x.by));
    return r.rows.map(x => ({ hid: Number(x.hid), coll: x.coll, id: x.doc_id, at: Number(x.at), byName: who.get(x.by)?.name || 'System', label: x.data.name || x.data.code || x.data.label || x.doc_id, data: redact(x.coll, x.data) }));
  }, 'data');
  route('POST', '/api/admin/recovery/restore', 'admin', async ({ body, user }) => {
    const hid = Math.round(num(body.hid, 'Version', 1, 1e15));
    const h = (await db.q('SELECT hid, coll, doc_id, op, data FROM history WHERE hid = $1', [hid])).rows[0]; if (!h) fail(404, 'Version not found');
    const restored = await db.tx(async tx => {
      const cur = await tx.get(h.coll, h.doc_id);
      if (cur) await tx.q(`INSERT INTO history (coll, doc_id, op, data, by, at) VALUES ($1, $2, 'update', $3::jsonb, $4, $5)`, [h.coll, h.doc_id, JSON.stringify(cur), user.id, Date.now()]);
      await tx.insertMany(h.coll, [h.data], { upsert: true });
      await tx.q(`INSERT INTO history (coll, doc_id, op, data, by, at) VALUES ($1, $2, 'restore', $3::jsonb, $4, $5)`, [h.coll, h.doc_id, JSON.stringify(h.data), user.id, Date.now()]);
      return tx.get(h.coll, h.doc_id);
    });
    await c.audit(user, 'record restored', `${h.coll}/${h.doc_id}`, `from version ${hid} (${h.op})`);
    if (['settings', 'zones'].includes(h.coll)) await c.invalidate();
    return { ok: true, record: redact(h.coll, restored) };
  }, 'data');

  /* ---------- backups ---------- */
  route('POST', '/api/admin/storage/backup', 'admin', async ({ user }) => {
    const b = await backupAll(db, { manual: true });
    await c.audit(user, 'backup created', b.name, `${Object.values(b.counts).reduce((a, x) => a + x, 0)} records`);
    return { backup: b, backups: listBackups() };
  }, 'data');

  /* ---------- uploaded files ---------- */
  async function uploadRefs() {
    const refs = new Map();
    const r = await db.q(`SELECT 'vendors' AS c, data->>'name' AS n, data->>'image' AS u FROM vendors WHERE data->>'image' LIKE '/uploads/%'
      UNION ALL SELECT 'vendors', v.data->>'name' || ': ' || (d->>'label'), d->>'url' FROM vendors v, jsonb_array_elements(COALESCE(v.data->'docs','[]'::jsonb)) d
      UNION ALL SELECT 'riders', r.data->>'name' || ': ' || (d->>'label'), d->>'url' FROM riders r, jsonb_array_elements(COALESCE(r.data->'docs','[]'::jsonb)) d
      UNION ALL SELECT 'items', 'Item: ' || (data->>'name'), data->>'image' FROM items WHERE data->>'image' LIKE '/uploads/%'
      UNION ALL SELECT 'tickets', 'Ticket ' || (t.data->>'code'), a #>> '{}' FROM tickets t, jsonb_array_elements(t.data->'messages') m, jsonb_array_elements(COALESCE(m->'attachments','[]'::jsonb)) a`);
    for (const x of r.rows) if (x.u?.startsWith('/uploads/')) refs.set(x.u.slice(9), x.n);
    return refs;
  }
  route('GET', '/api/admin/uploads', 'admin', async () => { const refs = await uploadRefs(); return (await c.storage.list()).map(f => ({ ...f, usedBy: refs.get(f.name) || null })).sort((a, b) => b.at - a.at).slice(0, 2000); }, 'data');
  route('DELETE', '/api/admin/uploads/:name', 'admin', async ({ params, user }) => {
    if ((await uploadRefs()).has(params.name)) fail(409, 'This file is still used. Remove it from the shop, rider or ticket first.');
    if (!(await c.storage.remove(params.name))) fail(404, 'File not found');
    await c.audit(user, 'upload deleted', params.name); return { ok: true };
  }, 'data');

  /* ---------- system health and issue fixing ---------- */
  const CHECKS = {
    placed_too_long: { title: 'Orders waiting for the shop too long', fix: 'Cancel and refund', sev: 'high',
      find: async s => db.find('orders', { status: 'placed', placedAt: { $lt: Date.now() - (s.acceptMins + 3) * 60000 } }, { limit: 200 }) },
    no_rider: { title: 'Accepted orders with no rider for 15+ minutes', fix: 'Try auto-assign again', sev: 'high',
      find: async () => db.find('orders', { status: { $in: ['accepted', 'ready'] }, riderId: null, acceptedAt: { $lt: Date.now() - 15 * 60000 } }, { limit: 200 }) },
    picked_too_long: { title: 'Picked up 2+ hours ago but not delivered', fix: 'Mark delivered (rider confirmed by phone)', sev: 'high',
      find: async () => (await db.find('orders', { status: 'picked' }, { limit: 500 })).filter(o => o.pickedAt && Date.now() - o.pickedAt > 2 * 3600000) },
    scheduled_missed: { title: 'Scheduled orders that were not sent to the shop', fix: 'Send to the shop now', sev: 'high',
      find: async () => db.find('orders', { status: 'scheduled', releaseAt: { $lt: Date.now() - 10 * 60000 } }, { limit: 200 }) },
    negative_stock: { title: 'Items with negative stock', fix: 'Set stock to 0', sev: 'medium',
      find: async () => db.find('items', { stock: { $lt: 0 } }, { limit: 200 }) },
    offline_with_orders: { title: 'Offline riders holding live orders', fix: 'Unassign so another rider can take it', sev: 'medium',
      find: async () => { const os = await db.find('orders', { status: { $in: ['accepted', 'ready'] }, riderId: { $ne: null } }, { limit: 1000 }); const rs = await db.getMany('riders', os.map(o => o.riderId)); return os.filter(o => rs.get(o.riderId) && !rs.get(o.riderId).online); } },
    negative_cash: { title: 'Riders with negative cash balance', fix: 'Set cash in hand to 0', sev: 'medium',
      find: async () => db.find('riders', { cashInHand: { $lt: 0 } }, { limit: 200 }) },
    coins_mismatch: { title: 'Customers whose coin balance differs from their coin history', fix: 'Recalculate balance from history', sev: 'low',
      find: async () => (await db.q(`SELECT u.data FROM users u JOIN (SELECT data->>'userId' AS id, sum((data->>'amount')::numeric) AS s FROM wallet GROUP BY 1) w ON w.id = u.id
        WHERE abs(COALESCE((u.data->>'coins')::numeric,0) - GREATEST(w.s,0)) >= 1 LIMIT 200`)).rows.map(r => r.data) },
    old_open_tickets: { title: 'Support tickets with no reply for 24+ hours', fix: 'Open the ticket', sev: 'medium',
      find: async () => db.find('tickets', { status: 'open', lastMessageAt: { $lt: Date.now() - DAY } }, { sort: 'lastMessageAt', limit: 200 }) },
  };
  const label = x => x.code || x.name || x.id;
  route('GET', '/api/admin/ops', 'admin', async () => {
    const s = await c.S(), t = Date.now();
    const results = await Promise.all(Object.entries(CHECKS).map(async ([k, ch]) => { const list = await ch.find(s); return { key: k, title: ch.title, fix: ch.fix, sev: ch.sev, count: list.length, items: list.slice(0, 25).map(x => ({ id: x.id, label: label(x), detail: x.status || (x.stock != null ? `stock ${x.stock}` : x.cashInHand != null ? `₹${x.cashInHand}` : x.coins != null ? `${Math.floor(x.coins)} coins` : '') })) }; }));
    const [dbOk, live, lastHour] = await Promise.all([db.q('SELECT 1').then(() => true, () => false), db.count('orders', { status: { $in: CUST_LIVE } }), db.count('orders', { createdAt: { $gte: t - 3600000 } })]);
    const job = (await db.q(`SELECT v FROM meta WHERE k = 'jobs:last'`)).rows[0]?.v;
    return { system: { db: dbOk, dbKind: c.config.databaseUrl ? 'PostgreSQL' : 'embedded', pool: c.dbStats?.(), uptimeSec: Math.round((t - startedAt) / 1000), pid: process.pid, memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      sseClients: c.sseCount?.() || 0, liveOrders: live, ordersLastHour: lastHour, lastJobRun: job?.at || null, jobOk: job ? t - job.at < 120000 : false, smsProvider: c.otp.providers().join(' → ') || 'not configured (dev codes)', storage: c.storage.driver, version: '3.0.0' },
      checks: results };
  }, 'ops');
  route('POST', '/api/admin/ops/fix', 'admin', async ({ body, user }) => {
    const ch = CHECKS[body.check]; if (!ch) fail(400, 'Unknown check');
    const s = await c.S(), ids = body.id ? [body.id] : (await ch.find(s)).map(x => x.id);
    let fixed = 0;
    for (const id of ids.slice(0, 500)) {
      try {
        if (body.check === 'placed_too_long' || body.check === 'scheduled_missed') {
          const o = await db.get('orders', id); if (!o) continue;
          if (body.check === 'scheduled_missed') { if (await c.setStatus(o, 'placed', { placedAt: Date.now(), note: 'Sent to the shop (fixed by ZIPI)' }, { from: ['scheduled'], by: user.id })) fixed++; continue; }
          const n = await db.tx(async tx => { const r = await c.setStatus(o, 'cancelled', { cancelReason: 'Shop did not respond in time', note: 'Cancelled by ZIPI support', refund: o.payment === 'UPI' ? o.total : 0 }, { from: ['placed'], t: tx, by: user.id }); if (r) await c.refundOrder(o, { t: tx }); return r; });
          if (n) { fixed++; c.emitOrder(n).catch(() => {}); }
        } else if (body.check === 'no_rider') { const o = await db.get('orders', id); if (o && await c.autoAssign(o)) fixed++; }
        else if (body.check === 'picked_too_long') {
          const o = await db.get('orders', id); if (!o) continue;
          const n = await db.tx(async tx => { const r = await c.setStatus(o, 'delivered', { deliveredAt: Date.now(), paid: true, note: 'Marked delivered by ZIPI support' }, { from: ['picked'], t: tx, by: user.id }); if (r && o.payment === 'COD') await tx.incr('riders', o.riderId, 'cashInHand', o.total); return r; });
          if (n) { fixed++; c.emitOrder(n).catch(() => {}); }
        } else if (body.check === 'negative_stock') { if (await db.updateIf('items', id, { stock: { $lt: 0 } }, { stock: 0 }, { by: user.id })) fixed++; }
        else if (body.check === 'offline_with_orders') { const o = await db.get('orders', id); if (o && await db.updateIf('orders', id, { riderId: o.riderId, status: { $in: ['accepted', 'ready'] } }, { riderId: null, autoAssigned: false, timeline: [...o.timeline, { status: 'rider', at: Date.now(), note: 'Rider went offline. Finding another.' }] }, { by: user.id })) { fixed++; c.autoAssign({ ...o, riderId: null }).catch(() => {}); } }
        else if (body.check === 'negative_cash') { if (await db.updateIf('riders', id, { cashInHand: { $lt: 0 } }, { cashInHand: 0 }, { by: user.id })) fixed++; }
        else if (body.check === 'coins_mismatch') { const s2 = (await db.q(`SELECT COALESCE(sum((data->>'amount')::numeric),0)::float8 AS s FROM wallet WHERE data->>'userId' = $1`, [id])).rows[0].s; await db.update('users', id, { coins: Math.max(0, Math.floor(s2)) }, { by: user.id }); fixed++; }
      } catch { /* one bad record must not stop the rest */ }
    }
    await c.audit(user, 'issue fixed', ch.title, `${fixed} of ${ids.length}${body.id ? ' · ' + body.id : ''}`);
    return { fixed, total: ids.length };
  }, 'ops');
  void ACTIVE; void N; void T; void fs; void path; void BACKUP_DIR;
}
