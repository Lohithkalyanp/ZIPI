// Rider app: online status, live GPS, available orders, claim / decline, pickup, delivery with OTP, shifts, earnings.
import { fail, str, num, ACTIVE, DAY, r2, SHIFT_SLOTS, dayKey, startOfDay, localTs } from '../context.js';
import { N, T } from '../../db/repo.js';
import { safeEqual } from '../../services/crypto.js';
import { ledger } from './vendor.js';

// next 7 days of shifts: who is booked, and how many riders past demand says are needed
export async function shiftPlan(c, zoneId, riderId = null) {
  const t = Date.now();
  const demand = (await c.db.q(`SELECT extract(dow FROM ${localTs(N('createdAt'))})::int AS wd, extract(hour FROM ${localTs(N('createdAt'))})::int AS h,
      count(DISTINCT to_char(${localTs(N('createdAt'))}, 'YYYY-MM-DD'))::int AS days, count(*)::int AS n
    FROM orders WHERE ${T('zoneId')} = $1 AND ${T('status')} = 'delivered' AND ${N('createdAt')} >= $2 GROUP BY 1, 2`, [zoneId, t - 14 * DAY])).rows;
  const book = await c.db.find('shifts', { zoneId, day: { $in: Array.from({ length: 7 }, (_, i) => dayKey(t + i * DAY)) } }, { limit: 20000 });
  const names = await c.db.getMany('riders', book.map(b => b.riderId));
  return Array.from({ length: 7 }, (_, i) => {
    const ts = t + i * DAY, day = dayKey(ts), wd = new Date(ts).getDay();
    const rows = demand.filter(r => r.wd === wd), weeks = Math.max(1, ...rows.map(r => r.days)); // same weekdays seen in the last 2 weeks
    return { day, at: ts, slots: Object.entries(SHIFT_SLOTS).map(([slot, [a, b]]) => {
      const orders = rows.filter(r => r.h >= a && r.h < b).reduce((x, r) => x + r.n, 0) / weeks;
      const booked = book.filter(x => x.day === day && x.slot === slot);
      return { slot, expected: Math.round(orders), needed: Math.max(1, Math.ceil(orders / ((b - a) * 2.5))), booked: booked.length,
        riders: booked.map(x => names.get(x.riderId)?.name || 'Rider'), mine: !!riderId && booked.some(x => x.riderId === riderId), over: i === 0 && new Date(t).getHours() >= b };
    }) };
  });
}

export default function rider(route, c) {
  const { db } = c;
  const myRider = async user => { const rd = await c.riderOf(user); if (!rd || rd.status !== 'approved') fail(403, 'Your rider account is not approved yet'); return rd; };
  const riderOrder = async (user, id) => { const rd = await myRider(user), o = await db.get('orders', id); if (!o || o.riderId !== rd.id) fail(404, 'Order not found'); return [rd, o]; };

  route('GET', '/api/rider/me', 'rider', async ({ user }) => {
    const rd = await myRider(user), t0 = startOfDay(Date.now());
    const [today, active] = await Promise.all([db.sum('orders', { riderId: rd.id, status: 'delivered', createdAt: { $gte: t0 } }, ['riderPay']), db.find('orders', { riderId: rd.id, status: { $in: ACTIVE } }, { limit: 10 })]);
    return { rider: c.showRider(rd), active: await c.orderViews(active, user), stats: { tripsToday: today.n, earnedToday: today.riderPay, cashInHand: rd.cashInHand || 0, bonusAt: 18, bonus: 150 } };
  });
  route('PATCH', '/api/rider/me', 'rider', async ({ user, body }) => {
    const rd = await myRider(user), p = {};
    if (body.online !== undefined) { p.online = !!body.online; if (p.online) p.onlineAt = Date.now(); }
    const n = await db.update('riders', rd.id, p);
    if (p.online) {
      c.bus.emit({ type: 'rider', zoneId: n.zoneId, users: [] });
      const waiting = await db.one('orders', { zoneId: n.zoneId, status: { $in: ['accepted', 'ready'] }, riderId: null }, { sort: 'createdAt' });
      if (waiting) c.autoAssign(waiting).catch(() => {});
    }
    return c.showRider(n);
  });
  route('POST', '/api/rider/location', 'rider', async ({ user, body }) => {
    const rd = await myRider(user), ll = c.latLng(body, 'Location'), acc = body.accuracy ? Math.round(num(body.accuracy, 'Accuracy', 0, 100000)) : null;
    const pos = { ...ll, acc, at: Date.now() };
    await db.update('riders', rd.id, { pos });
    const orders = await db.find('orders', { riderId: rd.id, status: { $in: ACTIVE } }, { limit: 5 });
    c.bus.emit({ type: 'rider_pos', id: rd.id, zoneId: rd.zoneId, pos, orders: orders.map(o => o.id), users: orders.map(o => o.customerId) });
    return { ok: true };
  });
  route('GET', '/api/rider/available', 'rider', async ({ user }) => {
    const rd = await myRider(user); if (!rd.online) return [];
    const list = await db.find('orders', { zoneId: rd.zoneId, status: { $in: ['accepted', 'ready'] }, riderId: null }, { sort: 'createdAt', limit: 60 });
    const gids = [...new Set(list.filter(o => o.legId).map(o => o.groupId))], sib = gids.length ? await db.find('orders', { groupId: { $in: gids } }, { limit: 500 }) : [];
    const ready = list.filter(o => !o.legId || !sib.some(x => x.legId === o.legId && ['placed', 'scheduled'].includes(x.status)));
    return c.orderViews(ready.slice(0, 30), user);
  });
  route('POST', '/api/rider/orders/:id/claim', 'rider', async ({ user, params }) => {
    const rd = await myRider(user); if (!rd.online) fail(409, 'Go online to take orders');
    const mine = await db.find('orders', { riderId: rd.id, status: { $in: ACTIVE } }, { limit: 20 }); // a multi-shop trip counts as one delivery
    if (new Set(mine.map(x => x.legId || x.id)).size >= 2) fail(409, 'Finish your current deliveries first');
    const o = await db.get('orders', params.id);
    if (!o || o.zoneId !== rd.zoneId || !['accepted', 'ready'].includes(o.status)) fail(404, 'Order is no longer available');
    // a multi-shop trip is claimed as a whole, only when every shop in it has accepted
    const trip = o.legId ? await db.find('orders', { legId: o.legId }, { limit: 10 }) : [o];
    if (trip.some(x => ['placed', 'scheduled'].includes(x.status))) fail(409, 'Not every shop in this trip has accepted yet');
    const todo = trip.filter(x => ['accepted', 'ready'].includes(x.status));
    const got = await db.tx(async tx => {
      const out = [];
      for (const x of todo) {
        const timeline = [...x.timeline, { status: 'rider', at: Date.now(), note: `${rd.name} is on the way to the shop${todo.length > 1 ? ` (${todo.length} pickups)` : ''}` }];
        const n = await tx.updateIf('orders', x.id, { riderId: null, status: { $in: ['accepted', 'ready'] } }, { riderId: rd.id, claimedAt: Date.now(), timeline }, { by: user.id });
        if (!n) fail(409, 'Another rider took this order'); out.push(n);
      }
      return out;
    });
    for (const n of got) c.emitOrder(n).catch(() => {});
    c.bus.emit({ type: 'order', id: o.id, zoneId: o.zoneId, users: [], ridersZone: true });
    return c.orderView(got.find(x => x.id === o.id) || got[0], user);
  });
  route('POST', '/api/rider/orders/:id/decline', 'rider', async ({ user, params }) => {
    const [rd, o] = await riderOrder(user, params.id);
    const trip = o.legId ? (await db.find('orders', { legId: o.legId }, { limit: 10 })).filter(x => x.riderId === rd.id) : [o];
    if (trip.some(x => x.status === 'picked')) fail(409, 'You already picked up part of this trip');
    let last = null;
    for (const x of trip) {
      const timeline = [...x.timeline, { status: 'rider', at: Date.now(), note: 'Finding another delivery partner' }];
      const n = await db.updateIf('orders', x.id, { riderId: rd.id, status: { $in: ['accepted', 'ready'] } }, { riderId: null, claimedAt: null, autoAssigned: false, declinedBy: [...new Set([...(x.declinedBy || []), rd.id])], timeline }, { by: user.id });
      if (n) { last = n; c.emitOrder(n).catch(() => {}); }
    }
    if (!last) fail(409, 'You already picked up this order');
    c.autoAssign(last).catch(() => {});
    return { ok: true };
  });
  route('POST', '/api/rider/orders/:id/pickup', 'rider', async ({ user, params }) => {
    const [, o] = await riderOrder(user, params.id);
    const n = await c.setStatus(o, 'picked', { pickedAt: Date.now() }, { from: ['ready'], by: user.id }); if (!n) fail(409, 'The shop has not marked this order ready yet');
    return c.orderView(n, user);
  });
  route('POST', '/api/rider/orders/:id/deliver', 'rider', async ({ user, params, body }) => {
    const [rd, o] = await riderOrder(user, params.id); if (o.status !== 'picked') fail(409, 'Pick up the order first');
    if (!safeEqual(str(body.otp, 4), o.otp)) fail(400, 'Wrong OTP. Ask the customer for the 4-digit code in their app.');
    // multi-shop trip: every parcel must be on board, then one OTP completes all of them
    const trip = o.legId ? (await db.find('orders', { legId: o.legId }, { limit: 10 })).filter(x => x.riderId === rd.id && x.status !== 'cancelled' && x.status !== 'rejected' && x.status !== 'delivered') : [o];
    const notYet = trip.find(x => x.status !== 'picked');
    if (notYet) fail(409, `Pick up from ${(await db.get('vendors', notYet.vendorId))?.name || 'the other shop'} first`);
    const s = await c.S();
    const n = await db.tx(async tx => {
      let r = null;
      for (const x of trip) {
        const d = await c.setStatus(x, 'delivered', { deliveredAt: Date.now(), paid: true }, { from: ['picked'], t: tx, by: user.id }); if (!d) fail(409, 'This order was already completed');
        if (x.payment === 'COD') await tx.incr('riders', rd.id, 'cashInHand', x.total);
        if (x.coinsEarn) await c.credit(x.customerId, x.coinsEarn, `Earned on ${x.code}`, x.id, tx);
        if (x.id === o.id) r = d; else c.emitOrder(d).catch(() => {});
      }
      const cu = await tx.get('users', o.customerId), reward = s.referralReward || 0;
      if (cu?.referredBy && !cu.referralPaid && reward && await tx.updateIf('users', cu.id, { referralPaid: { $ne: true } }, { referralPaid: true })) {
        await c.credit(cu.id, reward, 'Welcome reward for joining with a friend\'s code', o.id, tx);
        await c.credit(cu.referredBy, reward, `${(cu.name || 'A friend').split(' ')[0]} placed their first order`, o.id, tx);
      }
      return r;
    });
    c.emitOrder(n).catch(() => {});
    return c.orderView(n, user);
  });
  route('GET', '/api/rider/orders', 'rider', async ({ user, query }) => {
    const rd = await myRider(user), before = +query.before || null;
    return c.orderViews(await db.find('orders', { riderId: rd.id, status: 'delivered', ...(before ? { createdAt: { $lt: before } } : {}) }, { sort: '-createdAt', limit: 50 }), user);
  });
  route('GET', '/api/rider/earnings', 'rider', async ({ user }) => {
    const rd = await myRider(user), wk = Date.now() - 7 * DAY;
    const [L, week, deposits] = await Promise.all([ledger(c, 'rider', rd.id), db.sum('orders', { riderId: rd.id, status: 'delivered', createdAt: { $gte: wk } }, ['riderPay']), db.find('cashlogs', { riderId: rd.id }, { sort: '-at', limit: 10 })]);
    return { ...L, trips: L.orders, week: week.riderPay, weekTrips: week.n, cashInHand: rd.cashInHand || 0, deposits };
  });
  // where to wait for the next order: the rider's spot in the zone's p-center plan
  route('GET', '/api/rider/staging', 'rider', async ({ user }) => {
    const rd = await myRider(user); if (!rd.online) return { spot: null };
    const plan = await c.stagingPlan(rd.zoneId), spot = plan.spots.find(s => s.riderId === rd.id) || null;
    return { spot, radiusKm: plan.radiusKm, riders: plan.riders, shops: plan.shops };
  });
  route('GET', '/api/rider/shifts', 'rider', async ({ user }) => { const rd = await myRider(user); return { slots: SHIFT_SLOTS, days: await shiftPlan(c, rd.zoneId, rd.id) }; });
  route('POST', '/api/rider/shifts', 'rider', async ({ user, body }) => {
    const rd = await myRider(user), day = str(body.day, 10), slot = str(body.slot, 12);
    if (!SHIFT_SLOTS[slot]) fail(400, 'Unknown shift');
    const days = Array.from({ length: 7 }, (_, i) => dayKey(Date.now() + i * DAY)); if (!days.includes(day)) fail(400, 'You can book shifts for the next 7 days');
    if (day === days[0] && new Date().getHours() >= SHIFT_SLOTS[slot][1]) fail(409, 'That shift is already over');
    const id = `${rd.id}:${day}:${slot}`;
    if (body.on === false) await db.remove('shifts', id); else await db.insertMany('shifts', [{ id, riderId: rd.id, zoneId: rd.zoneId, day, slot, at: Date.now() }]);
    c.bus.emit({ type: 'shift', zoneId: rd.zoneId, users: [] });
    return { slots: SHIFT_SLOTS, days: await shiftPlan(c, rd.zoneId, rd.id) };
  });
  void r2;
}
