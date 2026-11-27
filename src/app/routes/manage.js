// Zone manager console (the admin console uses the same routes with ?zone=).
import { fail, str, num, phoneOf, validPhone, LIVE, CUST_LIVE, ACTIVE, DAY, r2, ZONE_RADIUS_KM, SHIFT_SLOTS, startOfDay } from '../context.js';
import { N, T } from '../../db/repo.js';
import { revealFields } from '../../services/crypto.js';
import { itemFields, newItem } from './vendor.js';
import { shiftPlan } from './rider.js';

export default function manage(route, c) {
  const { db } = c;
  const zq = (zone, extra = '') => (zone ? `${T('zoneId')} = '${zone.replace(/'/g, '')}'${extra}` : `TRUE${extra}`);

  route('GET', '/api/manage/overview', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), t0 = startOfDay(Date.now()), Z = c.zf(zone);
    const [today, live, vendors, riders, low] = await Promise.all([
      db.q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE ${T('status')}='delivered')::int AS del, COALESCE(sum(${N('total')}) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS gmv,
              count(*) FILTER (WHERE ${T('status')} IN ('cancelled','rejected'))::int AS cancelled FROM orders WHERE ${zq(zone)} AND ${N('createdAt')} >= $1`, [t0]),
      db.find('orders', { ...Z, status: { $in: LIVE } }, { sort: 'createdAt', limit: 500 }),
      db.q(`SELECT count(*) FILTER (WHERE ${T('status')}='approved')::int AS live, count(*) FILTER (WHERE ${T('status')}='approved' AND COALESCE((data->>'online')::boolean,false))::int AS online,
              count(*) FILTER (WHERE ${T('status')}='pending')::int AS pending FROM vendors WHERE ${zq(zone)}`),
      db.q(`SELECT count(*) FILTER (WHERE ${T('status')}='approved')::int AS active, count(*) FILTER (WHERE ${T('status')}='approved' AND COALESCE((data->>'online')::boolean,false))::int AS online,
              count(*) FILTER (WHERE ${T('status')}='pending')::int AS pending, COALESCE(sum(${N('cashInHand')}),0)::float8 AS cash FROM riders WHERE ${zq(zone)}`),
      db.find('items', { ...Z, hidden: { $ne: true }, stock: { $lte: 5 } }, { sort: 'stock', limit: 200 }),
    ]);
    const lowItems = low.filter(i => i.stock != null && i.stock <= (i.lowStockAt ?? 5)), shopNames = await db.getMany('vendors', lowItems.slice(0, 12).map(i => i.vendorId));
    const td = today.rows[0], vs = vendors.rows[0], rs = riders.rows[0];
    return { zone: zone ? c.zone(zone) : null,
      kpis: { ordersToday: td.n, delivered: td.del, gmv: Math.round(td.gmv), live: live.length, needsRider: live.filter(o => ['accepted', 'ready'].includes(o.status) && !o.riderId).length,
        vendorsLive: vs.live, vendorsOnline: vs.online, ridersActive: rs.active, ridersOnline: rs.online, pendingVendors: vs.pending, pendingRiders: rs.pending, lowStock: lowItems.length,
        cancelledToday: td.cancelled, cashWithRiders: r2(rs.cash), openTickets: await db.count('tickets', { ...Z, status: { $in: ['open', 'pending'] } }) },
      lowStock: lowItems.slice(0, 12).map(i => ({ ...c.itemView(i), vendorName: shopNames.get(i.vendorId)?.name })),
      live: await c.orderViews(live.slice(0, 12), ctx.user) };
  });
  route('GET', '/api/manage/applications', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), status = ctx.query.status || 'pending', f = { ...c.zf(zone), ...(status === 'all' ? {} : { status }) };
    const [vs, rs] = await Promise.all([db.find('vendors', f, { sort: '-createdAt', limit: 200 }), db.find('riders', f, { sort: '-createdAt', limit: 200 })]);
    return { vendors: vs.map(c.showVendor), riders: rs.map(c.showRider) };
  });
  // full ID / bank details for checking an application: only on request, and every view is logged
  route('GET', '/api/manage/kyc/:kind/:id', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), coll = ctx.params.kind === 'vendor' ? 'vendors' : ctx.params.kind === 'rider' ? 'riders' : fail(400, 'Unknown');
    const x = await db.get(coll, ctx.params.id); if (!x || (zone && x.zoneId !== zone)) fail(404, 'Not found');
    await c.audit(ctx.user, 'viewed ID and bank details', x.name, coll);
    return revealFields(coll, x);
  }, 'approve');
  async function review(kind, ctx) {
    const zone = c.zoneScope(ctx), coll = kind === 'vendor' ? 'vendors' : 'riders', x = await db.get(coll, ctx.params.id);
    if (!x || (zone && x.zoneId !== zone)) fail(404, 'Application not found');
    const a = ctx.body.action; if (!['approve', 'reject', 'suspend', 'reinstate'].includes(a)) fail(400, 'Unknown action');
    const p = { reviewedBy: ctx.user.id, reviewedAt: Date.now() };
    if (a === 'approve' || a === 'reinstate') { p.status = 'approved'; p.rejectReason = ''; await c.addRole(x.userId, kind); if (kind === 'vendor' && a === 'approve') p.online = false; }
    if (a === 'reject') { const reason = str(ctx.body.reason, 200); if (!reason) fail(400, 'Give a reason so the applicant can fix it'); p.status = 'rejected'; p.rejectReason = reason; }
    if (a === 'suspend') { p.status = 'suspended'; p.online = false; p.rejectReason = str(ctx.body.reason, 200); }
    if (kind === 'vendor' && ctx.body.commission !== undefined && ctx.body.commission !== '') p.commission = num(ctx.body.commission, 'Commission', 0, 40);
    const n = await db.update(coll, x.id, p, { by: ctx.user.id });
    c.bus.emit({ type: 'application', zoneId: n.zoneId, users: [n.userId] });
    await c.audit(ctx.user, `${kind} ${a}`, x.name, p.rejectReason || (p.commission != null ? `Commission ${p.commission}%` : ''));
    return kind === 'vendor' ? c.showVendor(n) : c.showRider(n);
  }
  route('POST', '/api/manage/vendors/:id/review', 'manager', ctx => review('vendor', ctx), 'approve');
  route('POST', '/api/manage/riders/:id/review', 'manager', ctx => review('rider', ctx), 'approve');

  route('GET', '/api/manage/map', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), Z = c.zf(zone);
    const [live, riders, shops] = await Promise.all([db.find('orders', { ...Z, status: { $in: LIVE } }, { limit: 1000 }), db.find('riders', { ...Z, status: 'approved', online: true }, { limit: 2000 }), db.find('vendors', { ...Z, status: 'approved' }, { limit: 3000 })]);
    const shopById = new Map(shops.map(v => [v.id, v]));
    return { zones: c.zones().filter(z => z.active && (!zone || z.id === zone)).map(z => ({ id: z.id, name: z.name, lat: z.lat, lng: z.lng, radiusKm: ZONE_RADIUS_KM })),
      riders: riders.map(r => { const p = c.freshPos(r); return { id: r.id, name: r.name, phone: r.phone, vehicle: r.vehicle, zoneId: r.zoneId, live: !!p, ll: p ? { lat: p.lat, lng: p.lng } : c.toLL(r.zoneId, r.loc || { x: ((r.id.charCodeAt(r.id.length - 1) % 9) - 4) / 5, y: ((r.id.charCodeAt(r.id.length - 2) % 9) - 4) / 5 }), active: live.filter(o => o.riderId === r.id).map(o => o.code) }; }),
      shops: shops.map(v => ({ id: v.id, name: v.name, open: c.isOpen(v), type: v.type, color: v.color, ll: c.vendorLL(v) })),
      orders: live.map(o => ({ id: o.id, code: o.code, status: o.status, needsRider: !o.riderId && ['accepted', 'ready'].includes(o.status), vendorLL: shopById.get(o.vendorId) ? c.vendorLL(shopById.get(o.vendorId)) : c.center(o.zoneId), dropLL: c.llOf(o.address?.zoneId || o.zoneId, o.address) })) };
  });
  // p-center plans: where free riders should wait, and how many riders keep every shop within a distance
  route('GET', '/api/manage/staging', 'manager', async ctx => {
    const zone = c.zoneScope(ctx) || c.zones().find(z => z.active)?.id; return c.stagingPlan(zone, { fresh: ctx.query.fresh === '1' });
  });
  route('GET', '/api/manage/coverage', 'manager', async ctx => {
    const zone = c.zoneScope(ctx) || c.zones().find(z => z.active)?.id; return { zone: c.zone(zone), ...(await c.coveragePlan(zone, Math.min(30, +ctx.query.max || 15))) };
  });
  route('GET', '/api/manage/shifts', 'manager', async ctx => {
    const zone = c.zoneScope(ctx) || c.zones().find(z => z.active)?.id;
    return { zone: c.zone(zone), slots: SHIFT_SLOTS, days: await shiftPlan(c, zone) };
  });
  // shops with stock and 7-day order stats in three grouped queries, not one query per shop
  route('GET', '/api/manage/vendors', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), q = str(ctx.query.q, 60), limit = Math.min(500, +ctx.query.limit || 300);
    const vs = await db.find('vendors', { ...c.zf(zone), status: { $ne: 'pending' }, ...(q ? { name: { $ilike: `%${q}%` } } : {}) }, { sort: 'name', limit });
    if (!vs.length) return [];
    const ids = vs.map(v => v.id);
    const [itemStats, orderStats, cards] = await Promise.all([
      db.q(`SELECT ${T('vendorId')} AS v, count(*)::int AS items, count(*) FILTER (WHERE data->'stock' <> 'null'::jsonb AND ${N('stock')} <= COALESCE(${N('lowStockAt')},5))::int AS low,
              count(*) FILTER (WHERE NOT COALESCE((data->>'available')::boolean,false) OR ${N('stock')} = 0)::int AS out FROM items WHERE ${T('vendorId')} = ANY($1::text[]) AND NOT COALESCE((data->>'hidden')::boolean,false) GROUP BY 1`, [ids]),
      db.q(`SELECT ${T('vendorId')} AS v, count(*)::int AS n, count(*) FILTER (WHERE ${T('status')}='rejected' OR ${T('cancelReason')} LIKE '%respond%')::int AS rej FROM orders WHERE ${T('vendorId')} = ANY($1::text[]) AND ${N('createdAt')} > $2 GROUP BY 1`, [ids, Date.now() - 7 * DAY]),
      c.vendorCards(vs, null)]);
    const I = new Map(itemStats.rows.map(r => [r.v, r])), O = new Map(orderStats.rows.map(r => [r.v, r])), s = await c.S();
    return vs.map((v, i) => ({ ...cards[i], status: v.status, online: v.online, ownerName: v.ownerName, phone: v.phone, items: I.get(v.id)?.items || 0, lowStock: I.get(v.id)?.low || 0,
      outOfStock: I.get(v.id)?.out || 0, orders7d: O.get(v.id)?.n || 0, rejected7d: O.get(v.id)?.rej || 0, commissionPct: v.commission ?? s.commission[v.type] }));
  });
  const zoneVendor = async ctx => { const zone = c.zoneScope(ctx), v = await db.get('vendors', ctx.params.id); if (!v || (zone && v.zoneId !== zone)) fail(404, 'Shop not found'); return v; };
  route('GET', '/api/manage/vendors/:id', 'manager', async ctx => { const v = await zoneVendor(ctx); return { vendor: c.showVendor(v), items: (await db.find('items', { vendorId: v.id, hidden: { $ne: true } }, { limit: 2000 })).map(c.itemView) }; });
  route('PATCH', '/api/manage/vendors/:id', 'manager', async ctx => {
    const v = await zoneVendor(ctx), p = {};
    if (ctx.body.online !== undefined) p.online = !!ctx.body.online; if (ctx.body.offer !== undefined) p.offer = str(ctx.body.offer, 40);
    if (ctx.body.prepMins !== undefined) p.prepMins = Math.round(num(ctx.body.prepMins, 'Preparation time', 3, 90));
    await c.audit(ctx.user, 'shop updated', v.name, JSON.stringify(p)); return c.showVendor(await db.update('vendors', v.id, p, { by: ctx.user.id }));
  }, 'stock');
  route('POST', '/api/manage/vendors/:id/items', 'manager', async ctx => {
    const v = await zoneVendor(ctx), it = await db.insert('items', newItem(v, itemFields(ctx.body, false), ctx.user.id));
    await c.audit(ctx.user, 'item added', `${v.name}: ${it.name}`); return c.itemView(it);
  }, 'stock');
  route('PATCH', '/api/manage/items/:id', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), it = await db.get('items', ctx.params.id), v = it && await db.get('vendors', it.vendorId);
    if (!it || !v || (zone && v.zoneId !== zone)) fail(404, 'Item not found');
    const f = itemFields(ctx.body, true); await c.audit(ctx.user, 'item edited', `${v.name}: ${it.name}`, JSON.stringify(f).slice(0, 200));
    return c.itemView(await db.update('items', it.id, { ...f, editedBy: ctx.user.id, editedAt: Date.now() }, { by: ctx.user.id }));
  }, 'stock');
  route('GET', '/api/manage/riders', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), t0 = startOfDay(Date.now());
    const rs = await db.find('riders', { ...c.zf(zone), status: { $ne: 'pending' } }, { sort: ['-online', 'name'], limit: 2000 });
    if (!rs.length) return [];
    const st = new Map((await db.q(`SELECT ${T('riderId')} AS r, count(*) FILTER (WHERE ${T('status')}='delivered')::int AS trips,
        count(*) FILTER (WHERE ${T('status')}='delivered' AND ${N('createdAt')} >= $2)::int AS today, count(*) FILTER (WHERE ${T('status')} = ANY($3::text[]))::int AS active
      FROM orders WHERE ${T('riderId')} = ANY($1::text[]) GROUP BY 1`, [rs.map(r => r.id), t0, ACTIVE])).rows.map(r => [r.r, r]));
    return rs.map(r => ({ ...c.showRider(r), docs: undefined, tripsToday: st.get(r.id)?.today || 0, trips: st.get(r.id)?.trips || 0, active: st.get(r.id)?.active || 0 }));
  });
  route('POST', '/api/manage/riders/:id/cash', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), r = await db.get('riders', ctx.params.id); if (!r || (zone && r.zoneId !== zone)) fail(404, 'Rider not found');
    const amount = r2(num(ctx.body.amount, 'Amount', 1, r.cashInHand || 0));
    const n = await db.tx(async tx => {
      const u = await tx.incr('riders', r.id, 'cashInHand', -amount, { min: 0 }); if (!u) fail(409, 'The rider\'s cash balance changed. Refresh and try again.');
      await tx.insert('cashlogs', { riderId: r.id, zoneId: r.zoneId, amount, by: ctx.user.id, byName: ctx.user.name, ref: str(ctx.body.ref, 60), at: Date.now() });
      await c.audit(ctx.user, 'cash deposit recorded', r.name, `₹${amount} ${str(ctx.body.ref, 60)}`, tx); return u;
    });
    return c.showRider(n);
  }, 'cash');
  route('GET', '/api/manage/orders', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), st = ctx.query.status || 'live', q = str(ctx.query.q, 20).toUpperCase(), before = +ctx.query.before || null;
    const f = { ...c.zf(zone), ...(st === 'all' ? {} : { status: st === 'live' ? { $in: CUST_LIVE } : st }), ...(q ? { code: q.startsWith('ZP') ? q : 'ZP' + q } : {}), ...(before ? { createdAt: { $lt: before } } : {}) };
    return c.orderViews(await db.find('orders', f, { sort: '-createdAt', limit: 100 }), ctx.user);
  });
  route('POST', '/api/manage/orders/:id/assign', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), o = await db.get('orders', ctx.params.id); if (!o || (zone && o.zoneId !== zone)) fail(404, 'Order not found');
    if (!['accepted', 'ready'].includes(o.status)) fail(409, 'Only accepted or ready orders can be assigned');
    const rd = await db.get('riders', ctx.body.riderId); if (!rd || rd.status !== 'approved' || rd.zoneId !== o.zoneId) fail(400, 'Choose an approved rider in this zone');
    const timeline = [...o.timeline, { status: 'rider', at: Date.now(), note: `${rd.name} assigned by ZIPI` }];
    const n = await db.updateIf('orders', o.id, { status: { $in: ['accepted', 'ready'] } }, { riderId: rd.id, claimedAt: Date.now(), autoAssigned: false, timeline }, { by: ctx.user.id });
    if (!n) fail(409, 'The order moved on meanwhile. Refresh.');
    await c.audit(ctx.user, 'rider assigned', o.code, rd.name); c.emitOrder(n).catch(() => {}); return c.orderView(n, ctx.user);
  }, 'orders');
  route('POST', '/api/manage/orders/:id/cancel', 'manager', async ctx => {
    const zone = c.zoneScope(ctx), o = await db.get('orders', ctx.params.id); if (!o || (zone && o.zoneId !== zone)) fail(404, 'Order not found');
    const reason = str(ctx.body.reason, 120); if (!reason) fail(400, 'Give a reason');
    const n = await db.tx(async tx => {
      const r = await c.setStatus(o, 'cancelled', { cancelReason: reason, note: `Cancelled by ZIPI: ${reason}`, refund: o.payment === 'UPI' || o.status === 'delivered' ? o.total : 0 }, { from: CUST_LIVE, t: tx, by: ctx.user.id });
      if (!r) fail(409, 'Order is already closed');
      await c.refundOrder(o, { stock: o.status !== 'picked', t: tx }); await c.audit(ctx.user, 'order cancelled', o.code, reason, tx); return r;
    });
    c.emitOrder(n).catch(() => {});
    return c.orderView(n, ctx.user);
  }, 'orders');
  route('POST', '/api/manage/onboard/vendor', 'manager', async ctx => {
    const zone = c.zoneScope(ctx) || ctx.body.zoneId, phone = phoneOf(ctx.body.ownerPhone);
    if (!validPhone(phone)) fail(400, 'Enter the owner\'s 10-digit mobile number');
    const f = c.partner.vendorFields({ ...ctx.body, zoneId: zone });
    const u = await c.ensureUser(phone, str(ctx.body.ownerName, 60));
    const ex = await c.vendorOf(u); if (ex && ex.status !== 'rejected') fail(409, `This number already has a shop: ${ex.name} (${ex.status})`);
    if (ex) await db.remove('vendors', ex.id, { by: ctx.user.id });
    const v = await c.partner.newVendor(u, f, { status: 'approved', onboardedBy: ctx.user.id, reviewedBy: ctx.user.id, reviewedAt: Date.now(), commission: ctx.body.commission ? num(ctx.body.commission, 'Commission', 0, 40) : null });
    await c.addRole(u.id, 'vendor'); await c.audit(ctx.user, 'shop onboarded', v.name); return { vendor: c.showVendor(v) };
  }, 'onboard');
  route('POST', '/api/manage/onboard/rider', 'manager', async ctx => {
    const zone = c.zoneScope(ctx) || ctx.body.zoneId, phone = phoneOf(ctx.body.phone);
    if (!validPhone(phone)) fail(400, 'Enter the rider\'s 10-digit mobile number');
    const f = c.partner.riderFields({ ...ctx.body, zoneId: zone });
    const u = await c.ensureUser(phone, str(ctx.body.name, 60));
    const ex = await c.riderOf(u); if (ex && ex.status !== 'rejected') fail(409, `This number is already a rider (${ex.status})`);
    if (ex) await db.remove('riders', ex.id, { by: ctx.user.id });
    const rd = await c.partner.newRider(u, f, { status: 'approved', onboardedBy: ctx.user.id, reviewedBy: ctx.user.id, reviewedAt: Date.now() });
    await c.addRole(u.id, 'rider'); await c.audit(ctx.user, 'rider onboarded', rd.name); return { rider: c.showRider(rd) };
  }, 'onboard');
}
