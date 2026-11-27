// Shared business rules used by every route module. Everything here is async and database-backed.
// Concurrency rules (important at scale):
//  - order status changes are conditional ("only if it is still placed"), so the shop, the customer and background jobs
//    can never both win the same transition;
//  - stock is reserved with an atomic decrement that refuses to go below zero, so popular items cannot oversell;
//  - a rider claims an order with a conditional update, so two riders can never get the same order.
import { log } from '../log.js';
import { config } from '../config.js';
import { encryptFields, maskFields } from '../services/crypto.js';
import { newId } from '../db/repo.js';

export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
export const fail = (s, m, extra) => { throw new HttpError(s, m, extra); };
export const r2 = n => Math.round(n * 100) / 100;
export const r1 = n => Math.round(n * 10) / 10;
export const phoneOf = p => String(p || '').replace(/\D/g, '').slice(-10);
export const validPhone = p => /^[6-9]\d{9}$/.test(p);
export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const need = (b, fields) => { for (const [f, label] of fields) if (b[f] === undefined || b[f] === null || String(b[f]).trim() === '') fail(400, `${label} is required`); };
export const num = (v, label, min = 0, max = 1e9) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) fail(400, `${label} must be between ${min} and ${max}`); return n; };
export const DAY = 86400000;
export const RX = { pan: /^[A-Z]{5}\d{4}[A-Z]$/, gst: /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, ifsc: /^[A-Z]{4}0[A-Z\d]{6}$/, upi: /^[\w.\-]{2,}@[a-zA-Z]{2,}$/, fssai: /^\d{14}$/ };
export const LIVE = ['placed', 'accepted', 'ready', 'picked'];
export const CUST_LIVE = ['scheduled', ...LIVE];
export const ACTIVE = ['accepted', 'ready', 'picked'];
export const KM_LAT = 110.574;
export const kmLng = lat => 111.32 * Math.cos(lat * Math.PI / 180);
export const CITY_CENTER = [22.7196, 75.8577];
export const ZONE_RADIUS_KM = 8;
export const APPS = {
  customer: { role: null, name: 'ZIPI app', path: '/' }, vendor: { role: 'vendor', name: 'Shop console', path: '/shop' },
  rider: { role: 'rider', name: 'Rider app', path: '/rider' }, manager: { role: 'manager', name: 'Zone manager console', path: '/manager' },
  admin: { role: 'admin', name: 'Admin console', path: '/admin' },
};
export const ADMIN_PERMS = { dashboard: 'Dashboard & market insights', access: 'Access control & users', partners: 'Shops, riders & applications', orders: 'Orders & live map',
  support: 'Customer support tickets', reports: 'Reports & data exports', payouts: 'Payouts & rider cash', coupons: 'Coupons', zones: 'Zones', settings: 'Fees & growth settings',
  data: 'Data, storage & recovery', ops: 'System health & issue fixing', audit: 'Audit log' };
export const MANAGER_PERMS = { approve: 'Approve or reject applications', stock: 'Edit shop menus & stock', orders: 'Assign riders & cancel orders', cash: 'Record rider cash deposits',
  onboard: 'Onboard shops & riders', support: 'Handle support tickets in the zone', reports: 'Download zone reports' };
export const MGR_TO_ADMIN = { approve: 'partners', stock: 'partners', onboard: 'partners', orders: 'orders', cash: 'payouts', support: 'support', reports: 'reports' };
export const SHIFT_SLOTS = { morning: [7, 12, 'Morning 7 am to 12 pm'], afternoon: [12, 17, 'Afternoon 12 to 5 pm'], evening: [17, 23, 'Evening 5 to 11 pm'] };
export const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const parseHours = s => String(s || '').split(',').map(p => p.split('-').map(Number)).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b <= 24 && a < b);
// one business timezone for days, hours and reports, in JavaScript and in SQL
export const TZ = process.env.APP_TZ || 'Asia/Kolkata';
export const localTs = expr => `(to_timestamp((${expr}) / 1000) AT TIME ZONE '${TZ.replace(/'/g, '')}')`;
export const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

const SETTINGS_DEFAULTS = { baseFee: 20, perKmFee: 6, freeDeliveryAbove: 399, smallOrderBelow: 99, smallOrderFee: 15, platformFee: 5, riderBase: 20, riderPerKm: 6, acceptMins: 5,
  commission: { restaurant: 18, store: 10 }, surge: { enabled: true, peakHours: '12-14,19-22', peakFee: 10, demandFee: 15, demandRatio: 2.5, rain: false, rainFee: 20, riderShare: 60 },
  loyaltyPct: 2, coinsMaxPct: 20, referralReward: 50, autoAssign: true, scheduleDays: 2, maxAddresses: 20, supportPhone: '+91 90000 00000',
  extraShopFee: 10, riderPerStop: 10 };

export async function makeContext({ db, bus, otp, maps, storage }) {
  const now = () => Date.now();
  const c = { db, bus, otp, maps, storage, now, fail, str, num, need, r1, r2, phoneOf, validPhone, DAY, config };

  /* ---------- caches for small, hot data (settings, zones), refreshed on change across all servers ---------- */
  let settings = null, zones = new Map(), loadedAt = 0;
  async function refresh() {
    const [s, zs] = await Promise.all([db.get('settings', 'main'), db.find('zones', {})]);
    settings = { ...SETTINGS_DEFAULTS, ...(s || {}), surge: { ...SETTINGS_DEFAULTS.surge, ...(s?.surge || {}) } };
    zones = new Map(zs.map(z => [z.id, z])); loadedAt = now();
  }
  await refresh();
  bus.onCache(() => refresh().catch(err => log.error('cache refresh failed', { err })));
  c.S = async () => { if (now() - loadedAt > 30000) await refresh(); return settings; };
  c.zone = id => zones.get(id) || null;
  c.zones = () => [...zones.values()];
  c.invalidate = async () => { await refresh(); bus.cacheChanged(); };
  // short-lived cache for heavy staff dashboards: many people refreshing hit the database once a minute
  const memo = new Map();
  c.memo = async (key, ttl, fn) => { const e = memo.get(key); if (e && Date.now() - e.at < ttl) return e.v; const v = await fn(); memo.set(key, { v, at: Date.now() }); if (memo.size > 500) memo.delete(memo.keys().next().value); return v; };

  /* ---------- people, roles, permissions ---------- */
  const has = (u, role) => !!u && (u.roles || []).includes(role);
  c.has = has;
  c.canUseApp = (u, app) => !!u && !!APPS[app] && (!APPS[app].role || has(u, APPS[app].role)) && !(u.locked || []).includes(app) && !u.deleted;
  c.adminPerms = u => u.perms || ['*'];
  c.isSuper = u => has(u, 'admin') && c.adminPerms(u).includes('*');
  c.permOk = (u, app, r) => {
    if (!r.perm) return true;
    if (app === 'admin') { const p = c.adminPerms(u); return p.includes('*') || p.includes(r.roles === 'admin' || r.roles === 'staff' ? r.perm : MGR_TO_ADMIN[r.perm] || 'partners'); }
    if (app === 'manager') return (u.mperms || Object.keys(MANAGER_PERMS)).includes(r.perm);
    return true;
  };
  c.safeUser = u => u && ({ id: u.id, phone: u.phone, name: u.name, email: u.email || '', roles: u.roles, zoneId: u.zoneId || null, addresses: u.addresses || [], createdAt: u.createdAt,
    favs: u.favs || [], coins: Math.floor(u.coins || 0), refCode: u.refCode || null, defaultAddress: u.defaultAddress || null, consentAt: u.consentAt || null,
    perms: has(u, 'admin') ? c.adminPerms(u) : undefined, mperms: has(u, 'manager') ? (u.mperms || Object.keys(MANAGER_PERMS)) : undefined, locked: u.locked || [] });
  c.vendorOf = u => db.one('vendors', { userId: u.id });
  c.riderOf = u => db.one('riders', { userId: u.id });
  c.isOpen = v => v.status === 'approved' && !!v.online;
  c.zoneScope = ctx => {
    if (has(ctx.user, 'admin') && ctx.app === 'admin') { const z = ctx.query.zone; if (z && z !== 'all' && !zones.has(z)) fail(400, 'Unknown zone'); return z && z !== 'all' ? z : null; }
    if (!ctx.user.zoneId) fail(403, 'No zone assigned to this manager');
    return ctx.user.zoneId;
  };
  c.zf = zone => (zone ? { zoneId: zone } : {});
  c.audit = (user, action, target = '', detail = '', t = db) => t.insert('audit', { by: user?.id || null, byName: user?.name || 'System', role: has(user, 'admin') ? 'admin' : has(user, 'manager') ? 'manager' : 'user', action, target: str(target, 80), detail: str(detail, 300), at: now() });
  c.logEvent = (type, data = {}) => db.insert('events', { type, at: now(), ...data }).catch(() => {});
  c.ensureUser = async (phone, name, t = db) => {
    const ex = await t.one('users', { phone }); if (ex) return ex;
    try { return await t.insert('users', { phone, name: name || '', roles: ['customer'], addresses: [], createdAt: now() }); }
    catch (e) { if (/unique|duplicate/i.test(e.message)) return t.one('users', { phone }); throw e; } // two first logins at once
  };
  c.addRole = (userId, role, extra = {}, t = db) => t.update('users', userId, u => ({ ...u, ...extra, roles: [...new Set([...u.roles, role])] }));
  c.cleanPerms = (list, all, allowStar = false) => { if (!Array.isArray(list)) return null; if (allowStar && list.includes('*')) return ['*']; return [...new Set(list.filter(p => all[p]))]; };

  /* ---------- geo ---------- */
  const center = zoneId => { const z = zones.get(zoneId); return z && z.lat != null ? { lat: z.lat, lng: z.lng } : { lat: CITY_CENTER[0], lng: CITY_CENTER[1] }; };
  c.toLL = (zoneId, loc) => { const k = center(zoneId); return { lat: +(k.lat - (loc?.y || 0) / KM_LAT).toFixed(6), lng: +(k.lng + (loc?.x || 0) / kmLng(k.lat)).toFixed(6) }; };
  c.fromLL = (zoneId, lat, lng) => { const k = center(zoneId); return { x: r2((lng - k.lng) * kmLng(k.lat)), y: r2((k.lat - lat) * KM_LAT) }; };
  // ?lat=&lng= from the app (detected location). Used only for distances, and only within 25 km of a zone centre.
  c.hereOf = q => { const lat = Number(q?.lat), lng = Number(q?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const z = q.zone && c.zone(q.zone); if (z) { const d = c.fromLL(z.id, lat, lng); if (Math.hypot(d.x, d.y) > 25) return null; }
    return { lat, lng }; };
  c.llOf = (zoneId, a) => (a && a.lat != null ? { lat: a.lat, lng: a.lng } : c.toLL(zoneId, a?.loc));
  c.vendorLL = v => (v.lat != null ? { lat: v.lat, lng: v.lng } : c.toLL(v.zoneId, v.loc));
  c.freshPos = rd => (rd?.pos && now() - rd.pos.at < 10 * 60000 ? rd.pos : null);
  c.riderLL = rd => c.freshPos(rd) || (rd.loc ? c.toLL(rd.zoneId, rd.loc) : center(rd.zoneId));
  c.latLng = (b, label) => {
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) fail(400, `${label} is not a valid map position`);
    return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  };
  c.center = center;
  // quick estimate for lists (no network): straight line x 1.3
  c.estKm = (a, b) => r1(maps.haversineKm(a, b) * 1.3);

  /* ---------- coins wallet ---------- */
  c.credit = async (userId, amount, reason, ref = '', t = db) => {
    amount = Math.round(amount); if (!amount || !userId) return true;
    const u = await t.incr('users', userId, 'coins', amount, { min: 0 });
    if (!u) return false; // would go negative
    await t.insert('wallet', { userId, amount, reason: str(reason, 80), ref: str(ref, 40), at: now() });
    return true;
  };
  c.refCodeFor = async u => {
    if (u.refCode) return u;
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 5; i++) {
      const code = 'ZIPI' + Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
      if (!(await db.one('users', { refCode: code }))) return (await db.update('users', u.id, { refCode: code })) || u;
    }
    return u;
  };

  /* ---------- pricing ---------- */
  c.surgeNow = async zoneId => {
    const cfg = (await c.S()).surge; if (!cfg?.enabled) return { fee: 0, reasons: [] };
    let fee = 0; const reasons = [], h = new Date(now()).getHours();
    if (cfg.peakFee && parseHours(cfg.peakHours).some(([a, b]) => h >= a && h < b)) { fee += cfg.peakFee; reasons.push('Peak hours'); }
    if (cfg.rain && cfg.rainFee) { fee += cfg.rainFee; reasons.push('Rain'); }
    if (cfg.demandFee && zoneId) {
      const [waiting, riders] = await Promise.all([db.count('orders', { zoneId, status: { $in: ['placed', 'accepted', 'ready'] }, riderId: null }), db.count('riders', { zoneId, status: 'approved', online: true })]);
      if (waiting >= 3 && waiting / Math.max(1, riders) >= cfg.demandRatio) { fee += cfg.demandFee; reasons.push('High demand'); }
    }
    return { fee: Math.round(fee), reasons };
  };
  c.commissionPct = async v => v.commission ?? (await c.S()).commission[v.type] ?? 15;
  c.itemView = i => ({ id: i.id, vendorId: i.vendorId, name: i.name, desc: i.desc || '', price: i.price, mrp: i.mrp || null, section: i.section || 'Menu',
    veg: i.veg ?? null, unit: i.unit || '', stock: i.stock ?? null, available: !!i.available && (i.stock == null || i.stock > 0), bestseller: !!i.bestseller, art: i.art, image: i.image || '', lowStockAt: i.lowStockAt ?? 5 });
  // shop cards for lists: one grouped query for item counts instead of one per shop
  c.vendorCards = async (vs, fromLL) => {
    if (!vs.length) return [];
    const counts = new Map((await db.q(`SELECT data->>'vendorId' AS v, count(*)::int AS n FROM items WHERE data->>'vendorId' = ANY($1::text[]) AND COALESCE((data->>'available')::boolean,false) AND NOT COALESCE((data->>'hidden')::boolean,false) GROUP BY 1`, [vs.map(v => v.id)])).rows.map(r => [r.v, r.n]));
    return vs.map(v => {
      const ll = c.vendorLL(v), d = fromLL ? c.estKm(ll, fromLL) : 1.5;
      return { id: v.id, name: v.name, type: v.type, tags: v.tags || [], art: v.art, color: v.color, image: v.image || '', rating: v.ratingCount ? r1(v.rating) : null, ratingCount: v.ratingCount || 0,
        offer: v.offer || '', veg: !!v.pureVeg, open: c.isOpen(v), eta: Math.round(v.prepMins + 6 + d * 4), dist: d, costForTwo: v.costForTwo || 0, itemCount: counts.get(v.id) || 0,
        address: v.address, zoneId: v.zoneId, hours: v.hours, ll };
    });
  };
  c.price = async ({ user, vendor, lines, coupon, address, useCoins = false, t = db }) => {
    const s = await c.S();
    if (!Array.isArray(lines) || !lines.length) fail(400, 'Your cart is empty');
    if (lines.length > 60) fail(400, 'Too many different items in one order');
    const items = await t.getMany('items', lines.map(l => l.itemId));
    let subtotal = 0; const out = [];
    for (const l of lines) {
      const it = items.get(String(l.itemId)), qty = Math.floor(num(l.qty, 'Quantity', 1, 50));
      if (!it || it.vendorId !== vendor.id || it.hidden) fail(400, 'An item in your cart is no longer on the menu');
      const okStock = it.stock == null || it.stock >= qty;
      out.push({ itemId: it.id, name: it.name, price: it.price, qty, veg: it.veg ?? null, available: !!it.available && okStock, stockLeft: it.stock });
      subtotal += it.price * qty;
    }
    let d = 1.5, mins = null, road = false;
    if (address) { const rt = await maps.route(c.vendorLL(vendor), c.llOf(address.zoneId || vendor.zoneId, address)); d = rt.km; mins = rt.mins; road = rt.road; }
    const deliveryFee = subtotal >= s.freeDeliveryAbove ? 0 : Math.round(s.baseFee + s.perKmFee * Math.max(0, d - 2));
    const smallOrderFee = subtotal < s.smallOrderBelow ? s.smallOrderFee : 0, platformFee = s.platformFee || 0;
    let discount = 0, couponApplied = null, couponError = null;
    if (coupon) {
      const cp = await t.one('coupons', { code: str(coupon, 20).toUpperCase(), active: true });
      if (!cp) couponError = 'This coupon is not valid';
      else if (cp.expiresAt && cp.expiresAt < now()) couponError = `${cp.code} has expired`;
      else if (subtotal < cp.minOrder) couponError = `Add items worth ₹${Math.ceil(cp.minOrder - subtotal)} more to use ${cp.code}`;
      else if (cp.firstOrderOnly && user && await t.count('orders', { customerId: user.id, status: { $nin: ['cancelled', 'rejected'] } })) couponError = `${cp.code} is for your first order`;
      else if (cp.vendorType && cp.vendorType !== vendor.type) couponError = `${cp.code} works on ${cp.vendorType === 'store' ? 'grocery' : 'food'} orders only`;
      else if (cp.maxUses && await t.count('orders', { coupon: cp.code, status: { $nin: ['cancelled', 'rejected'] } }) >= cp.maxUses) couponError = `${cp.code} has been fully used`;
      else {
        couponApplied = cp.code;
        if (cp.type === 'pct') discount = Math.min(subtotal * cp.value / 100, cp.maxDiscount || Infinity);
        else if (cp.type === 'flat') discount = Math.min(cp.value, subtotal);
        else if (cp.type === 'freedel') discount = deliveryFee;
        discount = Math.round(discount);
      }
    }
    const surge = await c.surgeNow(vendor.zoneId), surgeFee = surge.fee;
    let total = Math.max(0, subtotal + deliveryFee + smallOrderFee + platformFee + surgeFee - discount);
    const fresh = user ? await t.get('users', user.id) : null, coinsAvailable = Math.floor(fresh?.coins || 0);
    const coinsUsed = useCoins ? Math.max(0, Math.min(coinsAvailable, Math.floor(subtotal * (s.coinsMaxPct ?? 20) / 100), Math.floor(total))) : 0;
    total -= coinsUsed;
    const riderPay = Math.round(s.riderBase + s.riderPerKm * d + surgeFee * (s.surge?.riderShare ?? 60) / 100);
    const commission = r2(subtotal * await c.commissionPct(vendor) / 100);
    return { lines: out, subtotal, deliveryFee, smallOrderFee, platformFee, surgeFee, surgeReasons: surge.reasons, discount, couponApplied, couponError, coinsAvailable, coinsUsed,
      coinsEarn: Math.floor(subtotal * (s.loyaltyPct || 0) / 100), total, dist: r1(d), roadDistance: road,
      riderPay, commission, vendorNet: r2(subtotal - commission), eta: Math.round(vendor.prepMins + 3 + (mins ?? d * 4)), allAvailable: out.every(l => l.available) };
  };

  /* ---------- orders ---------- */
  // batched: one query each for shops, riders and customers, whatever the list size
  c.orderViews = async (list, viewer) => {
    if (!list.length) return [];
    const [vs, rs, us] = await Promise.all([db.getMany('vendors', list.map(o => o.vendorId)), db.getMany('riders', list.map(o => o.riderId)), db.getMany('users', list.map(o => o.customerId))]);
    const isStaff = has(viewer, 'admin') || has(viewer, 'manager') || has(viewer, 'support');
    return list.map(o => {
      const v = vs.get(o.vendorId), rd = o.riderId ? rs.get(o.riderId) : null, cu = us.get(o.customerId);
      const out = { ...o };
      out.vendor = v && { id: v.id, name: v.name, phone: v.phone, address: v.address, loc: v.loc, ll: c.vendorLL(v), art: v.art, color: v.color, type: v.type };
      out.rider = rd && { id: rd.id, name: rd.name, phone: rd.phone, vehicle: rd.vehicle, rating: rd.rating };
      out.customer = cu && { name: cu.name || 'Customer', phone: cu.phone };
      const isCustomer = viewer && viewer.id === o.customerId, isRider = rd && viewer && rd.userId === viewer.id;
      out.address = { ...o.address, ll: c.llOf(o.address?.zoneId || o.zoneId, o.address) };
      if (rd && ACTIVE.includes(o.status) && (isCustomer || isStaff || isRider)) out.rider.pos = c.freshPos(rd);
      if (!isCustomer) delete out.otp;
      delete out.idemKey;
      if (!isCustomer && !isStaff && !isRider) { out.customer = cu && { name: (cu.name || 'Customer').split(' ')[0] }; out.address = { area: o.address?.area, label: o.address?.label }; }
      if (isRider && o.status === 'delivered') { out.customer = cu && { name: (cu.name || 'Customer').split(' ')[0] }; } // no contact after delivery
      out.needsRider = ['accepted', 'ready'].includes(o.status) && !o.riderId;
      return out;
    });
  };
  c.orderView = async (o, viewer) => (await c.orderViews([o], viewer))[0];
  c.canSee = async (o, u) => {
    if (!u) return false;
    if (o.customerId === u.id || has(u, 'admin') || has(u, 'support')) return true;
    if (has(u, 'manager') && u.zoneId === o.zoneId) return true;
    const [v, rd] = await Promise.all([db.get('vendors', o.vendorId), o.riderId ? db.get('riders', o.riderId) : null]);
    if (v && v.userId === u.id) return true;
    if (rd && rd.userId === u.id) return true;
    if (has(u, 'rider')) { const me = await c.riderOf(u); if (me && me.zoneId === o.zoneId && !o.riderId && ['accepted', 'ready'].includes(o.status)) return true; }
    return false;
  };
  c.getOrder = async (id, u) => { const o = await db.get('orders', id); if (!o || !(await c.canSee(o, u))) fail(404, 'Order not found'); return o; };
  c.emitOrder = async o => {
    const [v, rd] = await Promise.all([db.get('vendors', o.vendorId), o.riderId ? db.get('riders', o.riderId) : null]);
    bus.emit({ type: 'order', id: o.id, status: o.status, zoneId: o.zoneId, users: [o.customerId, v?.userId, rd?.userId].filter(Boolean), ridersZone: ['accepted', 'ready'].includes(o.status) && !o.riderId });
  };
  // conditional transition: returns null if the order is no longer in one of `from`
  c.setStatus = async (o, status, extra = {}, { from, t = db, by } = {}) => {
    const cur = await t.get('orders', o.id); if (!cur) return null;
    if (from && !from.includes(cur.status)) return null;
    const timeline = [...(cur.timeline || []), { status, at: now(), note: extra.note || undefined }];
    const n = await t.updateIf('orders', o.id, from ? { status: { $in: from } } : {}, { ...extra, status, timeline }, { by });
    if (n && t === db) c.emitOrder(n).catch(() => {});
    return n;
  };
  c.restoreStock = async (o, t = db) => { for (const l of o.items) { const it = await t.get('items', l.itemId); if (it && it.stock != null) await t.incr('items', it.id, 'stock', l.qty); } };
  c.refundOrder = async (o, { stock = true, t = db } = {}) => {
    if (stock) await c.restoreStock(o, t);
    if (o.coinsUsed) await c.credit(o.customerId, o.coinsUsed, `Refund for ${o.code}`, o.id, t);
  };
  // nearest free online rider in the zone; they can decline and it moves on
  c.autoAssign = async o => {
    if (!(await c.S()).autoAssign || !o || o.riderId || !['accepted', 'ready'].includes(o.status)) return null;
    const v = await db.get('vendors', o.vendorId); if (!v) return null;
    const cands = (await db.find('riders', { zoneId: o.zoneId, status: 'approved', online: true }, { limit: 500 })).filter(r => !(o.declinedBy || []).includes(r.id));
    if (!cands.length) return null;
    const busy = new Set((await db.q(`SELECT DISTINCT data->>'riderId' AS r FROM orders WHERE data->>'riderId' = ANY($1::text[]) AND data->>'status' = ANY($2::text[])`, [cands.map(r => r.id), ACTIVE])).rows.map(x => x.r));
    const vll = c.vendorLL(v), free = cands.filter(r => !busy.has(r.id)).map(r => ({ r, km: maps.haversineKm(c.riderLL(r), vll) })).sort((a, b) => a.km - b.km);
    for (const { r, km } of free.slice(0, 5)) {
      const timeline = [...(o.timeline || []), { status: 'rider', at: now(), note: `${r.name} assigned automatically, ${r1(km)} km from the shop` }];
      const n = await db.updateIf('orders', o.id, { riderId: null, status: { $in: ['accepted', 'ready'] } }, { riderId: r.id, claimedAt: now(), autoAssigned: true, timeline });
      if (n) { c.emitOrder(n).catch(() => {}); bus.emit({ type: 'order', id: o.id, zoneId: o.zoneId, users: [r.userId], ridersZone: true }); return n; }
      return null; // someone else assigned it meanwhile
    }
    return null;
  };
  c.nextCode = async (seq, prefix) => prefix + (await db.q(`SELECT nextval('${seq}') AS n`)).rows[0].n;

  /* ---------- partners: sensitive fields are encrypted before saving and masked when shown ---------- */
  c.secureVendor = v => encryptFields('vendors', v);
  c.secureRider = r => encryptFields('riders', r);
  c.showVendor = v => maskFields('vendors', v);
  c.showRider = r => maskFields('riders', r);
  c.newId = newId;
  return c;
}
