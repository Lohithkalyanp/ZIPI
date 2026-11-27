// Customer orders: quote, place (transactional, idempotent), list, track, route line, cancel, rate.
import { fail, str, num, CUST_LIVE, DAY, r1 } from '../context.js';
import { randomDigits } from '../../services/crypto.js';

export default function orders(route, c) {
  const { db } = c;
  const addrFor = (user, id) => { const a = (user.addresses || []).find(x => x.id === id); if (!a) fail(400, 'Choose a delivery address'); return a; };

  route('POST', '/api/orders/quote', 'any', async ({ user, body }) => {
    const v = await db.get('vendors', body.vendorId); if (!v || v.status !== 'approved') fail(404, 'Shop not found');
    const address = body.addressId ? (user.addresses || []).find(a => a.id === body.addressId) : null;
    return { ...(await c.price({ user, vendor: v, lines: body.items, coupon: body.coupon, address, useCoins: !!body.useCoins })), open: c.isOpen(v), zoneOk: !address || address.zoneId === v.zoneId };
  });

  route('POST', '/api/orders', 'any', async ({ user, body, app, meta }) => {
    if (app !== 'customer') fail(403, 'Place orders from the ZIPI app');
    // the same checkout tapped twice (or retried on a bad network) returns the first order instead of creating a second
    const idem = str(body.idempotencyKey || meta.idem, 80);
    if (idem) { const prev = (await db.q('SELECT body FROM idem WHERE k = $1', [`order:${user.id}:${idem}`])).rows[0]; if (prev) return prev.body; }
    const v = await db.get('vendors', body.vendorId); if (!v || v.status !== 'approved') fail(404, 'Shop not found');
    const t = Date.now(), s = await c.S();
    let scheduleAt = null;
    if (body.scheduleAt) scheduleAt = Math.round(num(body.scheduleAt, 'Delivery time', t + 25 * 60000, t + (s.scheduleDays || 2) * DAY + 60000));
    else if (!c.isOpen(v)) fail(409, `${v.name} is closed right now. You can schedule the order for later.`);
    const address = addrFor(user, body.addressId);
    if (address.zoneId !== v.zoneId) fail(409, `${v.name} does not deliver to ${address.area}`);
    if (!['COD', 'UPI'].includes(body.payment)) fail(400, 'Choose a payment method');
    if (await db.count('orders', { customerId: user.id, status: { $in: CUST_LIVE } }) >= 3) fail(429, 'You already have 3 live or scheduled orders');
    const p = await c.price({ user, vendor: v, lines: body.items, coupon: body.coupon, address, useCoins: !!body.useCoins });
    if (p.couponError) fail(400, p.couponError);
    const bad = p.lines.find(l => !l.available); if (bad) fail(409, `${bad.name} just sold out${bad.stockLeft ? `, only ${bad.stockLeft} left` : ''}`);
    const code = await c.nextCode('order_code_seq', 'ZP');
    const status = scheduleAt ? 'scheduled' : 'placed';
    // one transaction: reserve stock atomically (never below zero), spend coins, create the order
    const o = await db.tx(async tx => {
      for (const l of p.lines) {
        const it = await tx.get('items', l.itemId);
        if (it.stock != null && !(await tx.incr('items', it.id, 'stock', -l.qty, { min: 0 }))) fail(409, `${it.name} just sold out`);
      }
      const order = await tx.insert('orders', {
        code, customerId: user.id, vendorId: v.id, zoneId: v.zoneId, vendorType: v.type,
        items: p.lines.map(({ itemId, name, price, qty, veg }) => ({ itemId, name, price, qty, veg })),
        subtotal: p.subtotal, deliveryFee: p.deliveryFee, smallOrderFee: p.smallOrderFee, platformFee: p.platformFee, surgeFee: p.surgeFee, surgeReasons: p.surgeReasons,
        discount: p.discount, coupon: p.couponApplied, coinsUsed: p.coinsUsed, coinsEarn: p.coinsEarn,
        total: p.total, payment: body.payment, paid: body.payment === 'UPI', note: str(body.note, 200), address: { ...address },
        dist: p.dist, eta: p.eta, riderPay: p.riderPay, commission: p.commission, vendorNet: p.vendorNet,
        scheduleAt, releaseAt: scheduleAt ? scheduleAt - (p.eta + 5) * 60000 : null, placedAt: scheduleAt ? null : t,
        otp: randomDigits(4), status, riderId: null, timeline: [{ status, at: t, note: scheduleAt ? 'Scheduled for later' : undefined }], createdAt: t,
      });
      if (p.coinsUsed && !(await c.credit(user.id, -p.coinsUsed, `Used on ${code}`, order.id, tx))) fail(409, 'Your coin balance changed. Please review the bill again.');
      return order;
    });
    c.logEvent('order', { ref: o.id, zoneId: o.zoneId, userId: user.id });
    c.emitOrder(o).catch(() => {});
    const view = await c.orderView(o, user);
    if (idem) await db.q('INSERT INTO idem (k, status, body, at) VALUES ($1, 200, $2::jsonb, $3) ON CONFLICT DO NOTHING', [`order:${user.id}:${idem}`, JSON.stringify(view), Date.now()]);
    return view;
  });

  // newest first, keyset pagination (?before=<createdAt>) so long histories stay fast
  route('GET', '/api/orders/mine', 'any', async ({ user, query }) => {
    const before = +query.before || null;
    const list = await db.find('orders', { customerId: user.id, ...(before ? { createdAt: { $lt: before } } : {}) }, { sort: '-createdAt', limit: Math.min(50, +query.limit || 30) });
    return c.orderViews(list, user);
  });
  route('GET', '/api/orders/:id', 'any', async ({ user, params }) => c.orderView(await c.getOrder(params.id, user), user));
  // road route for the tracking map (cached; straight line if routing is unavailable)
  route('GET', '/api/orders/:id/route', 'any', async ({ user, params }) => {
    const o = await c.getOrder(params.id, user), v = await db.get('vendors', o.vendorId);
    const rt = await c.maps.route(c.vendorLL(v), c.llOf(o.address?.zoneId || o.zoneId, o.address), { geometry: true });
    return { km: rt.km, mins: rt.mins, road: rt.road, coords: rt.coords };
  });
  route('POST', '/api/orders/:id/cancel', 'any', async ({ user, params }) => {
    const o = await c.getOrder(params.id, user); if (o.customerId !== user.id) fail(403, 'Not your order');
    if (!['placed', 'scheduled'].includes(o.status)) fail(409, 'The shop has already started on this order. Use Help to contact support.');
    const n = await db.tx(async tx => {
      const r = await c.setStatus(o, 'cancelled', { cancelReason: 'Cancelled by customer', note: 'Cancelled by you', refund: o.payment === 'UPI' ? o.total : 0 }, { from: ['placed', 'scheduled'], t: tx });
      if (!r) fail(409, 'The shop accepted this order a moment ago. Use Help to contact support.');
      await c.refundOrder(o, { t: tx }); return r;
    });
    c.emitOrder(n).catch(() => {});
    return c.orderView(n, user);
  });
  route('POST', '/api/orders/:id/rate', 'any', async ({ user, params, body }) => {
    const o = await c.getOrder(params.id, user); if (o.customerId !== user.id) fail(403, 'Not your order');
    if (o.status !== 'delivered') fail(409, 'You can rate after delivery');
    const rating = Math.round(num(body.rating, 'Rating', 1, 5));
    const n = await db.updateIf('orders', o.id, { rating: null }, { rating, review: str(body.review, 500), ratedAt: Date.now() }); if (!n) fail(409, 'Already rated');
    await db.update('vendors', o.vendorId, v => ({ ...v, rating: ((v.rating || 0) * (v.ratingCount || 0) + rating) / ((v.ratingCount || 0) + 1), ratingCount: (v.ratingCount || 0) + 1 }));
    if (body.riderRating && o.riderId) { const rr = Math.round(num(body.riderRating, 'Rider rating', 1, 5)); await db.update('riders', o.riderId, x => ({ ...x, rating: r1(((x.rating || 5) * (x.ratingCount || 0) + rr) / ((x.ratingCount || 0) + 1)), ratingCount: (x.ratingCount || 0) + 1 })); }
    if (body.nps !== undefined || body.wish || body.tags) await db.insert('feedback', { orderId: o.id, userId: user.id, zoneId: o.zoneId, vendorId: o.vendorId, rating,
      nps: body.nps === undefined || body.nps === '' || body.nps === null ? null : Math.round(num(body.nps, 'Score', 0, 10)), wish: str(body.wish, 200),
      tags: (Array.isArray(body.tags) ? body.tags : []).map(x => str(x, 30)).slice(0, 8), at: Date.now() });
    return c.orderView(n, user);
  });
}
