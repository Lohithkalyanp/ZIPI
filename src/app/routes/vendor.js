// Shop console: live orders, menu & stock, insights, earnings.
import { fail, str, num, LIVE, CUST_LIVE, DAY, r1, r2, startOfDay } from '../context.js';
import { N, T } from '../../db/repo.js';
import { validCategory, categoryOf } from './grocery.js';

export function itemFields(b, partial) {
  const p = {};
  if (!partial || b.name !== undefined) { p.name = str(b.name, 80); if (!p.name) fail(400, 'Item name is required'); }
  if (!partial || b.price !== undefined) p.price = Math.round(num(b.price, 'Price', 1, 100000));
  if (b.mrp !== undefined && b.mrp !== '' && b.mrp !== null) p.mrp = Math.round(num(b.mrp, 'MRP', 1, 100000));
  if (b.section !== undefined) p.section = str(b.section, 40) || 'Menu';
  if (b.desc !== undefined) p.desc = str(b.desc, 200);
  if (b.unit !== undefined) p.unit = str(b.unit, 30);
  if (b.veg !== undefined) p.veg = b.veg === null || b.veg === '' ? null : b.veg === true || b.veg === 'true' || b.veg === 'veg';
  if (b.stock !== undefined) p.stock = b.stock === null || b.stock === '' ? null : Math.round(num(b.stock, 'Stock', 0, 100000));
  if (b.lowStockAt !== undefined) p.lowStockAt = Math.round(num(b.lowStockAt, 'Low stock alert', 0, 1000));
  if (b.available !== undefined) p.available = !!b.available;
  if (b.bestseller !== undefined) p.bestseller = !!b.bestseller;
  if (b.category !== undefined) { if (b.category && !validCategory(b.category)) fail(400, 'Choose a valid category'); p.category = b.category || undefined; }
  if (b.image !== undefined) p.image = /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp)$/.test(b.image) || b.image === '' ? b.image : undefined;
  if (p.mrp && p.price && p.mrp < p.price) fail(400, 'MRP cannot be lower than the price');
  return p;
}
export const newItem = (v, f, by) => { const it = { vendorId: v.id, zoneId: v.zoneId, section: 'Menu', available: true, stock: v.type === 'store' ? 10 : null, lowStockAt: 5, art: v.art, veg: v.type === 'store' ? null : true, ...f, editedBy: by, createdAt: Date.now() };
  if (v.type === 'store') it.category = categoryOf(it); return it; };

export async function ledger(c, kind, id) {
  const field = kind === 'vendor' ? 'vendorNet' : 'riderPay', who = kind === 'vendor' ? 'vendorId' : 'riderId', t0 = startOfDay(Date.now());
  const [tot, pays, daily] = await Promise.all([
    c.db.sum('orders', { [who]: id, status: 'delivered' }, [field, 'subtotal', 'commission', 'dist']),
    c.db.find('payouts', { partyType: kind, partyId: id }, { sort: '-at', limit: 30 }),
    c.db.q(`SELECT floor((${N('createdAt')} - $2) / 86400000)::int AS d, count(*)::int AS n, COALESCE(sum(${N(field)}),0)::float8 AS amt, COALESCE(sum(${N('subtotal')}),0)::float8 AS gross
            FROM orders WHERE ${T(who)} = $1 AND ${T('status')} = 'delivered' AND ${N('createdAt')} >= $2 GROUP BY 1`, [id, t0 - 13 * DAY]),
  ]);
  const paid = (await c.db.sum('payouts', { partyType: kind, partyId: id }, ['amount'])).amount;
  const byDay = new Map(daily.rows.map(r => [r.d, r]));
  const days = Array.from({ length: 14 }, (_, i) => { const r = byDay.get(i); return { day: t0 - (13 - i) * DAY, orders: r?.n || 0, amount: r2(r?.amt || 0), gross: Math.round(r?.gross || 0) }; });
  return { earned: tot[field], paid, due: r2(tot[field] - paid), payouts: pays, days, orders: tot.n, gross: tot.subtotal, commission: tot.commission, km: r1(tot.dist) };
}

export default function vendor(route, c) {
  const { db } = c;
  const myVendor = async user => { const v = await c.vendorOf(user); if (!v || v.status !== 'approved') fail(403, 'Your shop is not approved yet'); return v; };
  const vendorOrder = async (user, id) => { const v = await myVendor(user), o = await db.get('orders', id); if (!o || o.vendorId !== v.id) fail(404, 'Order not found'); return [v, o]; };

  route('GET', '/api/vendor/me', 'vendor', async ({ user }) => {
    const v = await myVendor(user), t0 = startOfDay(Date.now());
    const r = (await db.q(`SELECT count(*)::int AS n,
        count(*) FILTER (WHERE ${T('status')} = 'delivered')::int AS del,
        COALESCE(sum(${N('subtotal')}) FILTER (WHERE ${T('status')} = 'delivered'),0)::float8 AS sales,
        COALESCE(sum(${N('vendorNet')}) FILTER (WHERE ${T('status')} = 'delivered'),0)::float8 AS net,
        count(*) FILTER (WHERE ${T('status')} = ANY($3::text[]))::int AS live,
        count(*) FILTER (WHERE ${T('status')} = 'rejected' OR (${T('status')} = 'cancelled' AND ${T('cancelReason')} LIKE '%respond%'))::int AS lost
      FROM orders WHERE ${T('vendorId')} = $1 AND ${N('createdAt')} >= $2`, [v.id, t0, LIVE])).rows[0];
    const low = (await db.q(`SELECT count(*)::int AS n FROM items WHERE ${T('vendorId')} = $1 AND data->'stock' IS NOT NULL AND data->'stock' <> 'null'::jsonb AND NOT COALESCE((data->>'hidden')::boolean,false) AND ${N('stock')} <= COALESCE(${N('lowStockAt')}, 5)`, [v.id])).rows[0].n;
    return { vendor: c.showVendor(v), commissionPct: await c.commissionPct(v), stats: { ordersToday: r.n, deliveredToday: r.del, salesToday: Math.round(r.sales), netToday: r2(r.net), live: r.live, rejectedToday: r.lost, lowStock: low } };
  });
  route('PATCH', '/api/vendor/me', 'vendor', async ({ user, body }) => {
    const v = await myVendor(user), p = {};
    if (body.online !== undefined) p.online = !!body.online;
    if (body.prepMins !== undefined) p.prepMins = Math.round(num(body.prepMins, 'Preparation time', 3, 90));
    if (body.hours !== undefined) p.hours = str(body.hours, 40);
    if (body.offer !== undefined) p.offer = str(body.offer, 40);
    if (body.image !== undefined) p.image = /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp)$/.test(body.image) ? body.image : '';
    return c.showVendor(await db.update('vendors', v.id, p, { by: user.id }));
  });
  route('GET', '/api/vendor/orders', 'vendor', async ({ user, query }) => {
    const v = await myVendor(user), scope = query.scope || 'live';
    const list = await db.find('orders', { vendorId: v.id, status: scope === 'live' ? { $in: CUST_LIVE } : { $nin: CUST_LIVE } }, { sort: '-createdAt', limit: scope === 'live' ? 200 : 60 });
    return c.orderViews(list, user);
  });
  route('GET', '/api/vendor/analytics', 'vendor', async ({ user, query }) => {
    const v = await myVendor(user), days = Math.round(num(query.days || 30, 'Days', 7, 90)), since = Date.now() - days * DAY;
    const os = await db.find('orders', { vendorId: v.id, createdAt: { $gte: since } }, { limit: 20000 }), del = os.filter(o => o.status === 'delivered');
    const lost = os.filter(o => o.status === 'rejected' || (o.status === 'cancelled' && o.cancelReason?.includes('respond')));
    const T_ = (o, s) => o.timeline?.find(x => x.status === s)?.at;
    const preps = del.map(o => (T_(o, 'ready') - T_(o, 'accepted')) / 60000).filter(n => n > 0 && n < 180);
    const items = new Map(); for (const o of del) for (const l of o.items) { const x = items.get(l.itemId) || { k: l.name, n: 0, rev: 0 }; x.n += l.qty; x.rev += l.qty * l.price; items.set(l.itemId, x); }
    const menu = await db.find('items', { vendorId: v.id, hidden: { $ne: true } }, { limit: 2000 });
    const byCust = new Map(); for (const o of del) byCust.set(o.customerId, (byCust.get(o.customerId) || 0) + 1);
    const rated = del.filter(o => o.rating), wd = Array(7).fill(0); for (const o of del) wd[new Date(o.createdAt).getDay()] += o.subtotal;
    const revenue = del.reduce((a, o) => a + o.subtotal, 0);
    return { days, orders: os.length, delivered: del.length, revenue, net: r2(del.reduce((a, o) => a + o.vendorNet, 0)), aov: del.length ? Math.round(revenue / del.length) : 0,
      lostRate: os.length ? r1(100 * lost.length / os.length) : 0, lost: lost.length, avgPrep: preps.length ? r1(preps.reduce((a, b) => a + b, 0) / preps.length) : null, promisedPrep: v.prepMins,
      customers: byCust.size, repeatRate: byCust.size ? r1(100 * [...byCust.values()].filter(n => n > 1).length / byCust.size) : 0,
      rating: rated.length ? r1(rated.reduce((a, o) => a + o.rating, 0) / rated.length) : null, ratingSplit: [5, 4, 3, 2, 1].map(n => ({ k: n + ' ★', n: rated.filter(o => o.rating === n).length })),
      hours: Array.from({ length: 24 }, (_, h) => del.filter(o => new Date(o.createdAt).getHours() === h).length), weekdays: wd.map(Math.round),
      topItems: [...items.values()].sort((a, b) => b.rev - a.rev).slice(0, 8), notSelling: menu.filter(i => !items.has(i.id)).map(i => i.name).slice(0, 12),
      reviews: del.filter(o => o.review).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map(o => ({ rating: o.rating, review: o.review, at: o.createdAt })) };
  });
  route('POST', '/api/vendor/orders/:id/accept', 'vendor', async ({ user, params, body }) => {
    const [v, o] = await vendorOrder(user, params.id);
    const prep = body.prepMins ? Math.round(num(body.prepMins, 'Preparation time', 3, 90)) : v.prepMins;
    const n = await c.setStatus(o, 'accepted', { prepMins: prep, acceptedAt: Date.now() }, { from: ['placed'], by: user.id });
    if (!n) fail(409, 'This order is no longer waiting (it may have been cancelled)');
    return c.orderView((await c.autoAssign(n)) || n, user);
  });
  route('POST', '/api/vendor/orders/:id/reject', 'vendor', async ({ user, params, body }) => {
    const [, o] = await vendorOrder(user, params.id);
    const n = await db.tx(async tx => {
      const r = await c.setStatus(o, 'rejected', { cancelReason: str(body.reason, 120) || 'Shop could not take the order', note: str(body.reason, 120), refund: o.payment === 'UPI' ? o.total : 0 }, { from: ['placed'], t: tx, by: user.id });
      if (!r) fail(409, 'This order is no longer waiting');
      await c.refundOrder(o, { t: tx }); return r;
    });
    c.emitOrder(n).catch(() => {});
    return c.orderView(n, user);
  });
  route('POST', '/api/vendor/orders/:id/ready', 'vendor', async ({ user, params }) => {
    const [, o] = await vendorOrder(user, params.id);
    const n = await c.setStatus(o, 'ready', { readyAt: Date.now() }, { from: ['accepted'], by: user.id }); if (!n) fail(409, 'Accept the order first');
    return c.orderView(n, user);
  });
  route('GET', '/api/vendor/items', 'vendor', async ({ user }) => (await db.find('items', { vendorId: (await myVendor(user)).id, hidden: { $ne: true } }, { limit: 2000 })).map(c.itemView));
  route('POST', '/api/vendor/items', 'vendor', async ({ user, body }) => {
    const v = await myVendor(user);
    if (await db.count('items', { vendorId: v.id, hidden: { $ne: true } }) >= 2000) fail(400, 'A shop can list up to 2000 items');
    return c.itemView(await db.insert('items', newItem(v, itemFields(body, false), user.id)));
  });
  route('PATCH', '/api/vendor/items/:id', 'vendor', async ({ user, params, body }) => {
    const v = await myVendor(user), it = await db.get('items', params.id); if (!it || it.vendorId !== v.id) fail(404, 'Item not found');
    return c.itemView(await db.update('items', it.id, { ...itemFields(body, true), editedBy: user.id, editedAt: Date.now() }, { by: user.id }));
  });
  route('DELETE', '/api/vendor/items/:id', 'vendor', async ({ user, params }) => {
    const v = await myVendor(user), it = await db.get('items', params.id); if (!it || it.vendorId !== v.id) fail(404, 'Item not found');
    await db.update('items', it.id, { hidden: true, available: false }, { by: user.id }); return { ok: true };
  });
  route('GET', '/api/vendor/earnings', 'vendor', async ({ user }) => {
    const v = await myVendor(user), L = await ledger(c, 'vendor', v.id);
    const recent = await db.find('orders', { vendorId: v.id, status: 'delivered' }, { sort: '-createdAt', limit: 25 });
    return { ...L, commissionPct: await c.commissionPct(v), recent: recent.map(o => ({ id: o.id, code: o.code, at: o.createdAt, subtotal: o.subtotal, commission: o.commission, net: o.vendorNet })) };
  });
}
