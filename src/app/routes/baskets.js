// Multi-shop grocery baskets. The customer checks out once; behind the scenes there is one order per shop (each shop accepts
// and packs its own part) and a delivery plan that decides how many delivery partners are needed and which shops each visits.
// One delivery fee, one platform fee, one coupon and one OTP for the whole basket. Fees are split across the shop orders in
// proportion to their value so every order's money adds up for accounting.
import { fail, str, num, CUST_LIVE, r2 } from '../context.js';
import { planBasket, unitKg, BASKET } from '../basket.js';
import { randomDigits } from '../../services/crypto.js';

export default function baskets(route, c) {
  const { db } = c;
  const roadKm = (a, b) => c.maps.haversineKm(a, b) * 1.3;

  async function build(user, body, { forOrder = false } = {}) {
    const s = await c.S();
    if (!Array.isArray(body.items) || !body.items.length) fail(400, 'Your cart is empty');
    if (body.items.length > 120) fail(400, 'Too many different items in one order');
    const items = await db.getMany('items', body.items.map(l => l.itemId));
    const byShop = new Map();
    for (const l of body.items) {
      const it = items.get(String(l.itemId)); if (!it || it.hidden) fail(400, 'An item in your cart is no longer available');
      if (!byShop.has(it.vendorId)) byShop.set(it.vendorId, []);
      byShop.get(it.vendorId).push({ itemId: it.id, qty: l.qty });
    }
    if (byShop.size > BASKET.MAX_SHOPS) fail(400, `One order can include up to ${BASKET.MAX_SHOPS} shops`);
    const shops = await db.getMany('vendors', [...byShop.keys()]);
    const address = body.addressId ? (user.addresses || []).find(a => a.id === body.addressId) : null;
    if (forOrder && !address) fail(400, 'Choose a delivery address');
    const parts = [];
    for (const [vid, lines] of byShop) {
      const v = shops.get(vid); if (!v || v.status !== 'approved') fail(404, 'A shop in your cart is no longer on ZIPI');
      if (v.type !== 'store' && byShop.size > 1) fail(400, 'Food comes from one restaurant per order. Multi-shop orders are for groceries.');
      if (address && address.zoneId !== v.zoneId) fail(409, `${v.name} does not deliver to ${address.area}`);
      const p = await c.price({ user, vendor: v, lines, coupon: null, address: null });
      const kg = p.lines.reduce((a, l) => a + unitKg({ ...items.get(l.itemId), vendorType: v.type }) * l.qty, 0);
      parts.push({ v, p, kg, count: p.lines.reduce((a, l) => a + l.qty, 0) });
    }
    const drop = address ? c.llOf(address.zoneId, address) : c.center(parts[0].v.zoneId);
    const plan = planBasket(parts.map(x => ({ id: x.v.id, name: x.v.name, ll: c.vendorLL(x.v), prepMins: x.v.prepMins, kg: x.kg, items: x.count })), drop, roadKm);
    // basket-level money
    const subtotal = parts.reduce((a, x) => a + x.p.subtotal, 0);
    const longest = Math.max(...plan.legs.map(l => l.km));
    const free = subtotal >= s.freeDeliveryAbove;
    const deliveryFee = free ? 0 : Math.round(s.baseFee + s.perKmFee * Math.max(0, longest - 2) + (s.extraShopFee || 0) * (parts.length - 1));
    const smallOrderFee = subtotal < s.smallOrderBelow ? s.smallOrderFee : 0, platformFee = s.platformFee || 0;
    const surge = await c.surgeNow(parts[0].v.zoneId);
    let discount = 0, couponApplied = null, couponError = null;
    if (body.coupon) {
      const cp = await db.one('coupons', { code: str(body.coupon, 20).toUpperCase(), active: true });
      if (!cp) couponError = 'This coupon is not valid';
      else if (cp.expiresAt && cp.expiresAt < Date.now()) couponError = `${cp.code} has expired`;
      else if (subtotal < cp.minOrder) couponError = `Add items worth ₹${Math.ceil(cp.minOrder - subtotal)} more to use ${cp.code}`;
      else if (cp.vendorType === 'restaurant') couponError = `${cp.code} works on food orders only`;
      else if (cp.firstOrderOnly && await db.count('orders', { customerId: user.id, status: { $nin: ['cancelled', 'rejected'] } })) couponError = `${cp.code} is for your first order`;
      else { couponApplied = cp.code; discount = Math.round(cp.type === 'pct' ? Math.min(subtotal * cp.value / 100, cp.maxDiscount || Infinity) : cp.type === 'flat' ? Math.min(cp.value, subtotal) : deliveryFee); }
    }
    let total = Math.max(0, subtotal + deliveryFee + smallOrderFee + platformFee + surge.fee - discount);
    const coinsAvailable = Math.floor((await db.get('users', user.id))?.coins || 0);
    const coinsUsed = body.useCoins ? Math.max(0, Math.min(coinsAvailable, Math.floor(subtotal * (s.coinsMaxPct ?? 20) / 100), Math.floor(total))) : 0;
    total -= coinsUsed;
    return { s, parts, plan, address, subtotal, deliveryFee, smallOrderFee, platformFee, surgeFee: surge.fee, surgeReasons: surge.reasons, discount, couponApplied, couponError, coinsAvailable, coinsUsed, total,
      coinsEarn: Math.floor(subtotal * (s.loyaltyPct || 0) / 100), allAvailable: parts.every(x => x.p.allAvailable), allOpen: parts.every(x => c.isOpen(x.v)) };
  }
  const summary = b => ({ shops: b.parts.map(x => ({ vendor: { id: x.v.id, name: x.v.name, art: x.v.art, color: x.v.color, image: x.v.image || '', open: c.isOpen(x.v) }, lines: x.p.lines, subtotal: x.p.subtotal, kg: Math.round(x.kg * 10) / 10 })),
    plan: { riders: b.plan.riders, etaMins: b.plan.etaMins, why: b.plan.why, oneRiderMins: b.plan.oneRiderMins, legs: b.plan.legs.map(l => ({ shops: l.shopIds.map(id => b.parts.find(x => x.v.id === id).v.name), km: l.km, mins: l.mins, kg: l.kg, reason: l.reason })) },
    subtotal: b.subtotal, deliveryFee: b.deliveryFee, smallOrderFee: b.smallOrderFee, platformFee: b.platformFee, surgeFee: b.surgeFee, surgeReasons: b.surgeReasons, discount: b.discount, couponApplied: b.couponApplied, couponError: b.couponError,
    coinsAvailable: b.coinsAvailable, coinsUsed: b.coinsUsed, coinsEarn: b.coinsEarn, total: b.total, allAvailable: b.allAvailable, allOpen: b.allOpen });

  route('POST', '/api/baskets/quote', 'any', async ({ user, body }) => summary(await build(user, body)));

  route('POST', '/api/baskets', 'any', async ({ user, body, app, meta }) => {
    if (app !== 'customer') fail(403, 'Place orders from the ZIPI app');
    const idem = str(body.idempotencyKey || meta.idem, 80);
    if (idem) { const prev = (await db.q('SELECT body FROM idem WHERE k = $1', [`basket:${user.id}:${idem}`])).rows[0]; if (prev) return prev.body; }
    if (!['COD', 'UPI'].includes(body.payment)) fail(400, 'Choose a payment method');
    const b = await build(user, body, { forOrder: true });
    if (b.couponError) fail(400, b.couponError);
    const closed = b.parts.find(x => !c.isOpen(x.v)); if (closed) fail(409, `${closed.v.name} is closed right now. Remove its items to order from the other shops.`);
    for (const x of b.parts) { const bad = x.p.lines.find(l => !l.available); if (bad) fail(409, `${bad.name} at ${x.v.name} just sold out${bad.stockLeft ? `, only ${bad.stockLeft} left` : ''}`); }
    if (await db.count('orders', { customerId: user.id, status: { $in: CUST_LIVE } }) + b.parts.length > 8) fail(429, 'You have many orders in progress. Please wait for some to arrive.');
    const t = Date.now(), code = await c.nextCode('basket_code_seq', 'ZB'), otp = randomDigits(4), basketId = c.newId('bk');
    // split money across shops in proportion to their value; the last shop takes rounding so totals match exactly
    const keys = ['deliveryFee', 'smallOrderFee', 'platformFee', 'surgeFee', 'discount', 'coinsUsed', 'coinsEarn'];
    const shares = b.parts.map(x => x.p.subtotal / b.subtotal), alloc = b.parts.map(() => ({}));
    for (const k of keys) { let left = b[k]; b.parts.forEach((_, i) => { const v = i === b.parts.length - 1 ? left : Math.round(b[k] * shares[i]); alloc[i][k] = v; left -= v; }); }
    const codes = []; for (let i = 0; i < b.parts.length; i++) codes.push(await c.nextCode('order_code_seq', 'ZP')); // outside the transaction
    const legOf = new Map(); b.plan.legs.forEach((l, li) => l.shopIds.forEach((id, si) => legOf.set(id, { li, first: si === 0, leg: l })));
    const res = await db.tx(async tx => {
      const ids = [];
      for (const [i, x] of b.parts.entries()) {
        for (const l of x.p.lines) { const it = await tx.get('items', l.itemId); if (it.stock != null && !(await tx.incr('items', it.id, 'stock', -l.qty, { min: 0 }))) fail(409, `${it.name} at ${x.v.name} just sold out`); }
        const a = alloc[i], L = legOf.get(x.v.id), stops = L.leg.shopIds.length;
        const riderPay = L.first ? Math.round(b.s.riderBase + b.s.riderPerKm * L.leg.km + (b.s.riderPerStop || 0) * (stops - 1) + b.surgeFee * (b.s.surge?.riderShare ?? 60) / 100 / b.plan.legs.length) : 0;
        const orderTotal = Math.max(0, x.p.subtotal + a.deliveryFee + a.smallOrderFee + a.platformFee + a.surgeFee - a.discount - a.coinsUsed);
        const o = await tx.insert('orders', {
          code: codes[i], customerId: user.id, vendorId: x.v.id, zoneId: x.v.zoneId, vendorType: x.v.type,
          items: x.p.lines.map(({ itemId, name, price, qty, veg }) => ({ itemId, name, price, qty, veg })),
          subtotal: x.p.subtotal, deliveryFee: a.deliveryFee, smallOrderFee: a.smallOrderFee, platformFee: a.platformFee, surgeFee: a.surgeFee, surgeReasons: b.surgeReasons,
          discount: a.discount, coupon: b.couponApplied, coinsUsed: a.coinsUsed, coinsEarn: a.coinsEarn, total: orderTotal, payment: body.payment, paid: body.payment === 'UPI',
          note: str(body.notes?.[x.v.id] ?? body.note, 200), address: { ...b.address }, dist: L.leg.km, eta: b.plan.etaMins, riderPay, commission: x.p.commission, vendorNet: x.p.vendorNet,
          groupId: basketId, groupCode: code, groupSize: b.parts.length, legId: `${basketId}:${L.li}`, legStops: L.leg.shopIds, legKg: L.leg.kg,
          placedAt: t, otp, status: 'placed', riderId: null, timeline: [{ status: 'placed', at: t, note: b.parts.length > 1 ? `Part of ${code} (${b.parts.length} shops)` : undefined }], createdAt: t,
        });
        ids.push(o.id);
      }
      if (b.coinsUsed && !(await c.credit(user.id, -b.coinsUsed, `Used on ${code}`, basketId, tx))) fail(409, 'Your coin balance changed. Please review the bill again.');
      return tx.insert('baskets', { id: basketId, code, customerId: user.id, zoneId: b.parts[0].v.zoneId, orderIds: ids, plan: summary(b).plan, otp,
        subtotal: b.subtotal, deliveryFee: b.deliveryFee, smallOrderFee: b.smallOrderFee, platformFee: b.platformFee, surgeFee: b.surgeFee, discount: b.discount, coupon: b.couponApplied,
        coinsUsed: b.coinsUsed, total: b.total, payment: body.payment, createdAt: t });
    });
    for (const id of res.orderIds) { const o = await db.get('orders', id); c.emitOrder(o).catch(() => {}); }
    c.logEvent('order', { ref: res.id, zoneId: res.zoneId, userId: user.id });
    const view = await basketView(res, user);
    if (idem) await db.q('INSERT INTO idem (k, status, body, at) VALUES ($1, 200, $2::jsonb, $3) ON CONFLICT DO NOTHING', [`basket:${user.id}:${idem}`, JSON.stringify(view), Date.now()]);
    return view;
  });

  async function basketView(bk, viewer) {
    const orders = await db.find('orders', { groupId: bk.id }, { sort: 'createdAt', limit: 20 });
    const views = await c.orderViews(orders, viewer);
    const live = views.filter(o => CUST_LIVE.includes(o.status));
    const status = !live.length ? (views.some(o => o.status === 'delivered') ? 'delivered' : 'cancelled') : live.every(o => o.status === 'picked') ? 'picked' : live.some(o => o.status !== 'placed') ? 'accepted' : 'placed';
    return { ...bk, otp: viewer?.id === bk.customerId ? bk.otp : undefined, status, orders: views };
  }
  c.basketView = basketView;
  route('GET', '/api/baskets/:id', 'any', async ({ user, params }) => {
    const bk = await db.get('baskets', params.id); if (!bk || (bk.customerId !== user.id && !c.has(user, 'admin') && !c.has(user, 'manager') && !c.has(user, 'support'))) fail(404, 'Order not found');
    return basketView(bk, user);
  });
  route('POST', '/api/baskets/:id/cancel', 'any', async ({ user, params }) => {
    const bk = await db.get('baskets', params.id); if (!bk || bk.customerId !== user.id) fail(404, 'Order not found');
    let cancelled = 0, started = [];
    for (const id of bk.orderIds) {
      const o = await db.get('orders', id); if (!o || !CUST_LIVE.includes(o.status)) continue;
      const n = await db.tx(async tx => { const r = await c.setStatus(o, 'cancelled', { cancelReason: 'Cancelled by customer', note: 'Cancelled by you', refund: o.payment === 'UPI' ? o.total : 0 }, { from: ['placed', 'scheduled'], t: tx }); if (r) await c.refundOrder(o, { t: tx }); return r; });
      if (n) { cancelled++; c.emitOrder(n).catch(() => {}); } else started.push((await db.get('vendors', o.vendorId))?.name || 'a shop');
    }
    if (!cancelled && started.length) fail(409, 'The shops have already started packing. Use Help to contact support.');
    return { ...(await basketView(bk, user)), message: started.length ? `Cancelled. ${started.join(', ')} had already started packing, so that part will still come.` : 'Cancelled' };
  });
  void num; void r2;
}
