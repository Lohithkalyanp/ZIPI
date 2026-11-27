// Admin console: business dashboard and insights (SQL aggregates), zones, users, settings, coupons, payouts,
// access control, user profiles, shop / rider edits, audit log.
import { fail, str, num, need, phoneOf, validPhone, DAY, r1, r2, APPS, ADMIN_PERMS, MANAGER_PERMS, CITY_CENTER, parseHours, startOfDay, localTs } from '../context.js';
import { N, T } from '../../db/repo.js';

export default function admin(route, c) {
  const { db } = c;
  const moneySql = `count(*)::int AS orders, count(*) FILTER (WHERE ${T('status')}='delivered')::int AS delivered,
    count(*) FILTER (WHERE ${T('status')} IN ('cancelled','rejected'))::int AS cancelled,
    COALESCE(sum(${N('total')}) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS gmv,
    COALESCE(sum(${N('commission')}) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS commission,
    COALESCE(sum(${N('deliveryFee')} + COALESCE(${N('smallOrderFee')},0) + COALESCE(${N('platformFee')},0) + COALESCE(${N('surgeFee')},0)) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS fees,
    COALESCE(sum(${N('discount')} + COALESCE(${N('coinsUsed')},0)) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS discounts,
    COALESCE(sum(${N('riderPay')}) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS "riderPay",
    count(DISTINCT ${T('customerId')}) FILTER (WHERE ${T('status')}='delivered')::int AS customers`;
  const money = r => ({ gmv: r2(r.gmv), commission: r2(r.commission), fees: r2(r.fees), discounts: r2(r.discounts), riderPay: r2(r.riderPay), contribution: r2(r.commission + r.fees - r.discounts - r.riderPay) });

  route('GET', '/api/admin/overview', 'admin', ({ query }) => c.memo('overview:' + (query.days || 14), 60000, () => overview(query)), 'dashboard');
  async function overview(query) {
    const days = Math.round(num(query.days || 14, 'Days', 1, 90)), since = Date.now() - days * DAY, t0 = startOfDay(Date.now());
    const [all, byZone, series, byType, counts] = await Promise.all([
      db.q(`SELECT ${moneySql} FROM orders WHERE ${N('createdAt')} >= $1`, [since]),
      db.q(`SELECT ${T('zoneId')} AS z, ${moneySql} FROM orders WHERE ${N('createdAt')} >= $1 GROUP BY 1`, [since]),
      db.q(`SELECT floor((${N('createdAt')} - $1) / 86400000)::int AS d, count(*)::int AS n, COALESCE(sum(${N('total')}),0)::float8 AS gmv FROM orders WHERE ${T('status')}='delivered' AND ${N('createdAt')} >= $1 GROUP BY 1`, [t0 - (Math.min(days, 30) - 1) * DAY]),
      db.q(`SELECT ${T('vendorType')} AS t, count(*)::int AS n, COALESCE(sum(${N('total')}),0)::float8 AS gmv FROM orders WHERE ${T('status')}='delivered' AND ${N('createdAt')} >= $1 GROUP BY 1`, [since]),
      db.q(`SELECT (SELECT count(*) FROM vendors WHERE ${T('status')}='approved')::int AS vendors, (SELECT count(*) FROM riders WHERE ${T('status')}='approved')::int AS riders,
              (SELECT count(*) FROM vendors WHERE ${T('status')}='pending')::int + (SELECT count(*) FROM riders WHERE ${T('status')}='pending')::int AS pending`),
    ]);
    const zoneCounts = new Map((await db.q(`SELECT z, sum(v)::int AS v, sum(r)::int AS r FROM (SELECT ${T('zoneId')} AS z, count(*) AS v, 0 AS r FROM vendors WHERE ${T('status')}='approved' GROUP BY 1
      UNION ALL SELECT ${T('zoneId')}, 0, count(*) FROM riders WHERE ${T('status')}='approved' GROUP BY 1) x GROUP BY z`)).rows.map(r => [r.z, r]));
    const managers = new Map((await db.find('users', { roles: { $has: 'manager' } }, { limit: 5000 })).map(u => [u.zoneId, u.name]));
    const a = all.rows[0], m = money(a), Z = new Map(byZone.rows.map(r => [r.z, r])), S = new Map(series.rows.map(r => [r.d, r]));
    const nDays = Math.min(days, 30);
    return { days, kpis: { orders: a.orders, delivered: a.delivered, ...m, aov: a.delivered ? r2(m.gmv / a.delivered) : 0, perOrder: a.delivered ? r2(m.contribution / a.delivered) : 0,
        customers: a.customers, cancelRate: a.orders ? r1(100 * a.cancelled / a.orders) : 0, ...counts.rows[0] },
      zones: c.zones().map(z => { const r = Z.get(z.id) || { orders: 0, delivered: 0, cancelled: 0, gmv: 0, commission: 0, fees: 0, discounts: 0, riderPay: 0 };
        return { ...z, orders: r.orders, delivered: r.delivered, ...money(r), vendors: zoneCounts.get(z.id)?.v || 0, riders: zoneCounts.get(z.id)?.r || 0, manager: managers.get(z.id) || null, cancelRate: r.orders ? r1(100 * r.cancelled / r.orders) : 0 }; }),
      series: Array.from({ length: nDays }, (_, i) => ({ day: t0 - (nDays - 1 - i) * DAY, orders: S.get(i)?.n || 0, gmv: r2(S.get(i)?.gmv || 0) })),
      byType: ['restaurant', 'store'].map(t => { const r = byType.rows.find(x => x.t === t); return { type: t, orders: r?.n || 0, gmv: r2(r?.gmv || 0) }; }) };
  }

  route('GET', '/api/admin/insights', 'admin', ({ query }) => c.memo(`insights:${query.days || 30}:${query.zone || 'all'}`, 60000, () => insights(query)), 'dashboard');
  async function insights(query) {
    const days = Math.round(num(query.days || 30, 'Days', 1, 120)), since = Date.now() - days * DAY, zone = query.zone && query.zone !== 'all' ? query.zone : null;
    const zw = zone ? `AND ${T('zoneId')} = $2` : '', P = zone ? [since, zone] : [since];
    const [funnel, searches, misses, waitlist, hours, items, rep, nps, wishes, pays, cps, aov, cats] = await Promise.all([
      db.q(`SELECT ${T('type')} AS t, count(DISTINCT COALESCE(${T('userId')},'anon') || to_char(${localTs(N('at'))}, 'YYYYMMDD'))::int AS n FROM events WHERE ${N('at')} >= $1 ${zw} AND ${T('type')} IN ('app_open','view_vendor','add_cart','checkout') GROUP BY 1`, P),
      db.q(`SELECT ${T('q')} AS k, count(*)::int AS n FROM events WHERE ${T('type')}='search' AND ${N('at')} >= $1 ${zw} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, P),
      db.q(`SELECT ${T('q')} AS k, count(*)::int AS n FROM events WHERE ${T('type')}='search_miss' AND ${N('at')} >= $1 ${zw} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, P),
      db.q(`SELECT ${T('area')} || ', ' || ${T('city')} AS k, count(*)::int AS n FROM waitlist WHERE ${N('at')} >= $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, [since]),
      db.q(`SELECT extract(hour FROM ${localTs(N('createdAt'))})::int AS h, count(*)::int AS n FROM orders WHERE ${T('status')}='delivered' AND ${N('createdAt')} >= $1 ${zw} GROUP BY 1`, P),
      db.q(`SELECT l->>'name' AS k, sum((l->>'qty')::int)::int AS n FROM orders, jsonb_array_elements(data->'items') l WHERE ${T('status')}='delivered' AND ${N('createdAt')} >= $1 ${zw} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, P),
      db.q(`SELECT count(*)::int AS customers, count(*) FILTER (WHERE n >= 2)::int AS repeat FROM (SELECT ${T('customerId')}, count(*) AS n FROM orders WHERE ${T('status')}='delivered' AND ${N('createdAt')} >= $1 ${zw} GROUP BY 1) x`, P),
      db.q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE ${N('nps')} >= 9)::int AS prom, count(*) FILTER (WHERE ${N('nps')} <= 6)::int AS det FROM feedback WHERE ${N('at')} >= $1 ${zw} AND data->'nps' <> 'null'::jsonb AND data ? 'nps'`, P),
      db.find('feedback', { at: { $gte: since }, ...(zone ? { zoneId: zone } : {}), wish: { $ne: '' } }, { sort: '-at', limit: 15 }),
      db.q(`SELECT ${T('payment')} AS k, count(*)::int AS n FROM orders WHERE ${T('status')}='delivered' AND ${N('createdAt')} >= $1 ${zw} GROUP BY 1 ORDER BY 2 DESC`, P),
      db.q(`SELECT ${T('coupon')} AS k, count(*)::int AS n FROM orders WHERE ${T('status')}='delivered' AND ${N('createdAt')} >= $1 ${zw} AND ${T('coupon')} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`, P),
      db.q(`SELECT ${T('vendorType')} AS t, count(*)::int AS n, COALESCE(avg(${N('total')}),0)::float8 AS aov FROM orders WHERE ${T('status')}='delivered' AND ${N('createdAt')} >= $1 ${zw} GROUP BY 1`, P),
      db.q(`SELECT v.data->'tags'->>0 AS k, count(*)::int AS n FROM orders o JOIN vendors v ON v.id = o.data->>'vendorId' WHERE o.data->>'status'='delivered' AND (o.data->>'createdAt')::numeric >= $1 ${zone ? `AND o.data->>'zoneId' = $2` : ''} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, P),
    ]);
    const F = new Map(funnel.rows.map(r => [r.t, r.n])), placed = await db.count('orders', { createdAt: { $gte: since }, ...(zone ? { zoneId: zone } : {}) });
    const H = new Map(hours.rows.map(r => [r.h, r.n])), np = nps.rows[0], rp = rep.rows[0];
    return { days, funnel: [['Opened app', F.get('app_open') || 0], ['Viewed a shop', F.get('view_vendor') || 0], ['Added to cart', F.get('add_cart') || 0], ['Reached checkout', F.get('checkout') || 0], ['Placed order', placed]].map(([k, n]) => ({ k, n })),
      searches: searches.rows, misses: misses.rows, waitlist: waitlist.rows, waitlistTotal: await db.count('waitlist', { at: { $gte: since } }),
      hours: Array.from({ length: 24 }, (_, h) => H.get(h) || 0), topItems: items.rows, categories: cats.rows.filter(r => r.k),
      repeatRate: rp.customers ? r1(100 * rp.repeat / rp.customers) : 0, customers: rp.customers,
      nps: np.n ? Math.round(100 * (np.prom - np.det) / np.n) : null, npsCount: np.n, npsSplit: { promoters: np.prom, passives: np.n - np.prom - np.det, detractors: np.det },
      wishes: wishes.filter(f => f.wish).map(f => ({ wish: f.wish, at: f.at, nps: f.nps })), payments: pays.rows, coupons: cps.rows,
      aovByType: ['restaurant', 'store'].map(t => { const r = aov.rows.find(x => x.t === t); return { type: t, aov: Math.round(r?.aov || 0), n: r?.n || 0 }; }) };
  }

  /* ---------- zones ---------- */
  route('GET', '/api/admin/zones', 'admin', () => c.zones(), 'zones');
  route('POST', '/api/admin/zones', 'admin', async ({ body, user }) => {
    need(body, [['name', 'Zone name'], ['city', 'City']]);
    const ll = body.lat !== undefined && body.lat !== '' ? c.latLng(body, 'Zone centre') : { lat: CITY_CENTER[0], lng: CITY_CENTER[1] };
    const z = await db.insert('zones', { id: 'z-' + c.newId(), name: str(body.name, 40), city: str(body.city, 40), active: body.active === true, ...ll, createdAt: Date.now() });
    await c.audit(user, 'zone created', z.name); await c.invalidate(); return z;
  }, 'zones');
  route('PATCH', '/api/admin/zones/:id', 'admin', async ({ params, body, user }) => {
    const z = await db.get('zones', params.id); if (!z) fail(404, 'Zone not found'); const p = {};
    if (body.active !== undefined) p.active = !!body.active; if (body.name) p.name = str(body.name, 40);
    if (body.lat !== undefined && body.lat !== '') Object.assign(p, c.latLng(body, 'Zone centre'));
    await c.audit(user, 'zone updated', z.name, JSON.stringify(p)); const n = await db.update('zones', z.id, p, { by: user.id }); await c.invalidate(); return n;
  }, 'zones');

  /* ---------- users ---------- */
  route('GET', '/api/admin/users', 'admin', async ({ query }) => {
    const role = str(query.role, 20), q = str(query.q, 40), before = +query.before || null;
    const f = { ...(role ? { roles: { $has: role } } : {}), ...(before ? { createdAt: { $lt: before } } : {}), deleted: { $ne: true } };
    if (q) f.$or = /^\d{3,}$/.test(q) ? [{ phone: { $ilike: `%${q}%` } }] : [{ name: { $ilike: `%${q}%` } }];
    const us = await db.find('users', f, { sort: '-createdAt', limit: 100 });
    const counts = new Map(us.length ? (await db.q(`SELECT ${T('customerId')} AS u, count(*)::int AS n FROM orders WHERE ${T('customerId')} = ANY($1::text[]) GROUP BY 1`, [us.map(u => u.id)])).rows.map(r => [r.u, r.n]) : []);
    return us.map(u => ({ ...c.safeUser(u), addresses: undefined, blocked: !!u.blocked, orders: counts.get(u.id) || 0 }));
  }, 'access');

  /* ---------- settings ---------- */
  route('GET', '/api/admin/settings', 'admin', () => c.S(), 'settings');
  route('PATCH', '/api/admin/settings', 'admin', async ({ body, user }) => {
    const p = {}, s = await c.S(), keys = { baseFee: [0, 200], perKmFee: [0, 50], freeDeliveryAbove: [0, 5000], smallOrderBelow: [0, 1000], smallOrderFee: [0, 100], platformFee: [0, 50], riderBase: [0, 200], riderPerKm: [0, 50], acceptMins: [1, 30],
      loyaltyPct: [0, 20], coinsMaxPct: [0, 100], referralReward: [0, 1000], scheduleDays: [1, 7], maxAddresses: [1, 50] };
    for (const k in keys) if (body[k] !== undefined && body[k] !== '') p[k] = num(body[k], k, ...keys[k]);
    if (body.commission) p.commission = { restaurant: num(body.commission.restaurant, 'Restaurant commission', 0, 40), store: num(body.commission.store, 'Store commission', 0, 40) };
    if (body.autoAssign !== undefined) p.autoAssign = !!body.autoAssign;
    if (body.supportPhone !== undefined) p.supportPhone = str(body.supportPhone, 20);
    if (body.surge) {
      const b = body.surge, cur = s.surge || {}, hours = b.peakHours !== undefined ? str(b.peakHours, 60) : cur.peakHours;
      if (hours && parseHours(hours).length !== hours.split(',').filter(Boolean).length) fail(400, 'Peak hours must look like 12-14,19-22');
      p.surge = { ...cur, enabled: b.enabled !== undefined ? !!b.enabled : cur.enabled, rain: b.rain !== undefined ? !!b.rain : cur.rain, peakHours: hours };
      for (const [k, mn, mx] of [['peakFee', 0, 100], ['demandFee', 0, 100], ['demandRatio', 1, 10], ['rainFee', 0, 100], ['riderShare', 0, 100]]) if (b[k] !== undefined && b[k] !== '') p.surge[k] = num(b[k], k, mn, mx);
    }
    await c.audit(user, 'settings changed', 'Fees & growth', JSON.stringify(p).slice(0, 300));
    const cur = await db.get('settings', 'main');
    const n = cur ? await db.update('settings', 'main', p, { by: user.id }) : await db.insert('settings', { id: 'main', ...s, ...p });
    await c.invalidate(); return n;
  }, 'settings');
  route('GET', '/api/admin/audit', 'admin', async ({ query }) => {
    const q = str(query.q, 40), before = +query.before || null;
    const f = { ...(before ? { at: { $lt: before } } : {}), ...(q ? { $or: [{ action: { $ilike: `%${q}%` } }, { target: { $ilike: `%${q}%` } }, { byName: { $ilike: `%${q}%` } }, { detail: { $ilike: `%${q}%` } }] } : {}) };
    return db.find('audit', f, { sort: '-at', limit: 200 });
  }, 'audit');

  /* ---------- coupons ---------- */
  route('GET', '/api/admin/coupons', 'admin', async () => {
    const cs = await db.find('coupons', {}, { sort: '-createdAt', limit: 500 });
    const uses = new Map(cs.length ? (await db.q(`SELECT ${T('coupon')} AS k, count(*)::int AS n FROM orders WHERE ${T('coupon')} = ANY($1::text[]) AND ${T('status')} = 'delivered' GROUP BY 1`, [cs.map(x => x.code)])).rows.map(r => [r.k, r.n]) : []);
    return cs.map(x => ({ ...x, uses: uses.get(x.code) || 0 }));
  }, 'coupons');
  route('POST', '/api/admin/coupons', 'admin', async ({ body, user }) => {
    need(body, [['code', 'Code'], ['type', 'Type']]);
    const code = str(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, ''); if (code.length < 4) fail(400, 'Code needs at least 4 letters or numbers');
    if (await db.one('coupons', { code })) fail(409, 'That code already exists');
    if (!['pct', 'flat', 'freedel'].includes(body.type)) fail(400, 'Unknown coupon type');
    await c.audit(user, 'coupon created', code);
    return db.insert('coupons', { code, type: body.type, value: body.type === 'freedel' ? 0 : num(body.value, 'Value', 1, body.type === 'pct' ? 100 : 2000), maxDiscount: body.maxDiscount ? num(body.maxDiscount, 'Max discount', 1, 5000) : null,
      minOrder: num(body.minOrder || 0, 'Minimum order', 0, 10000), firstOrderOnly: !!body.firstOrderOnly, vendorType: ['restaurant', 'store'].includes(body.vendorType) ? body.vendorType : null,
      maxUses: body.maxUses ? Math.round(num(body.maxUses, 'Maximum uses', 1, 1e7)) : null, expiresAt: body.expiresAt ? Math.round(num(Date.parse(body.expiresAt) || body.expiresAt, 'Expiry', Date.now(), Date.now() + 400 * DAY)) : null,
      title: str(body.title, 40) || code, desc: str(body.desc, 100), active: true, createdAt: Date.now() });
  }, 'coupons');
  route('PATCH', '/api/admin/coupons/:id', 'admin', async ({ params, body, user }) => {
    const x = await db.get('coupons', params.id); if (!x) fail(404, 'Coupon not found');
    await c.audit(user, body.active ? 'coupon turned on' : 'coupon turned off', x.code); return db.update('coupons', x.id, { active: !!body.active }, { by: user.id });
  }, 'coupons');

  /* ---------- payouts: earned vs paid per shop and rider, computed in the database ---------- */
  async function balances(kind) {
    const coll = kind === 'vendor' ? 'vendors' : 'riders', who = kind === 'vendor' ? 'vendorId' : 'riderId', field = kind === 'vendor' ? 'vendorNet' : 'riderPay';
    const r = await db.q(`WITH e AS (SELECT ${T(who)} AS id, sum(${N(field)})::float8 AS earned FROM orders WHERE ${T('status')}='delivered' AND ${T(who)} IS NOT NULL GROUP BY 1),
        p AS (SELECT ${T('partyId')} AS id, sum(${N('amount')})::float8 AS paid FROM payouts WHERE ${T('partyType')} = $1 GROUP BY 1)
      SELECT x.data, COALESCE(e.earned,0) AS earned, COALESCE(p.paid,0) AS paid FROM e JOIN "${coll}" x ON x.id = e.id LEFT JOIN p ON p.id = e.id
      ORDER BY COALESCE(e.earned,0) - COALESCE(p.paid,0) DESC LIMIT 1000`, [kind]);
    return r.rows.map(({ data: x, earned, paid }) => ({ id: x.id, name: x.name, zoneId: x.zoneId, upi: x.upi, accountNo: c[kind === 'vendor' ? 'showVendor' : 'showRider'](x).accountNo || '', earned: r2(earned), paid: r2(paid), due: r2(earned - paid), cashInHand: x.cashInHand }));
  }
  route('GET', '/api/admin/payouts', 'admin', async () => ({ vendors: await balances('vendor'), riders: await balances('rider'), recent: await db.find('payouts', {}, { sort: '-at', limit: 30 }) }), 'payouts');
  route('POST', '/api/admin/payouts', 'admin', async ({ body, user }) => {
    if (!['vendor', 'rider'].includes(body.partyType)) fail(400, 'Unknown payee');
    const x = await db.get(body.partyType === 'vendor' ? 'vendors' : 'riders', body.partyId); if (!x) fail(404, 'Payee not found');
    const pay = await db.insert('payouts', { partyType: body.partyType, partyId: x.id, name: x.name, amount: r2(num(body.amount, 'Amount', 1, 1e7)), ref: str(body.ref, 60) || 'UPI transfer', by: user.id, at: Date.now() });
    await c.audit(user, 'payout recorded', x.name, `₹${pay.amount} ${pay.ref}`); return pay;
  }, 'payouts');

  /* ---------- access control ---------- */
  const lastLogins = async ids => {
    const m = new Map(); if (!ids.length) return m;
    for (const r of (await db.q(`SELECT ${T('userId')} AS u, ${T('app')} AS a, max(${N('at')})::float8 AS t FROM logins WHERE ${T('userId')} = ANY($1::text[]) GROUP BY 1, 2`, [ids])).rows) { if (!m.has(r.u)) m.set(r.u, {}); m.get(r.u)[r.a] = r.t; }
    return m;
  };
  async function staffRows(us) {
    const ids = us.map(u => u.id), [last, vs, rs] = await Promise.all([lastLogins(ids), db.find('vendors', { userId: { $in: ids } }, { limit: 5000 }), db.find('riders', { userId: { $in: ids } }, { limit: 5000 })]);
    const V = new Map(vs.map(v => [v.userId, v])), R = new Map(rs.map(r => [r.userId, r]));
    return us.map(u => ({ ...c.safeUser(u), addresses: undefined, blocked: !!u.blocked, super: c.isSuper(u), last: last.get(u.id) || {},
      vendor: V.get(u.id) && { id: V.get(u.id).id, name: V.get(u.id).name, status: V.get(u.id).status }, rider: R.get(u.id) && { id: R.get(u.id).id, name: R.get(u.id).name, status: R.get(u.id).status } }));
  }
  const staffRow = async u => (await staffRows([u]))[0];
  c.staffRow = staffRow;
  route('GET', '/api/admin/access', 'admin', async ({ query }) => {
    const filter = query.filter || 'staff', q = str(query.q, 40), t = Date.now();
    const roleF = filter === 'staff' ? { $or: [{ roles: { $has: 'admin' } }, { roles: { $has: 'manager' } }, { roles: { $has: 'support' } }] }
      : filter === 'partners' ? { $or: [{ roles: { $has: 'vendor' } }, { roles: { $has: 'rider' } }] }
      : filter === 'paused' ? { $or: [{ blocked: true }, { locked: { $ne: null } }] } : { $or: [{ roles: { $has: 'admin' } }, { roles: { $has: 'manager' } }, { roles: { $has: 'vendor' } }, { roles: { $has: 'rider' } }] };
    const f = { ...roleF, ...(q ? { $and: [{ $or: [{ name: { $ilike: `%${q}%` } }, { phone: { $ilike: `%${q}%` } }] }] } : {}) };
    let us = await db.find('users', f, { sort: 'name', limit: 300 });
    if (filter === 'paused') us = us.filter(u => u.blocked || (u.locked || []).length);
    const appCounts = await Promise.all(Object.entries(APPS).map(async ([k, a]) => ({ key: k, ...a, users: k === 'customer' ? await db.count('users', { blocked: { $ne: true }, deleted: { $ne: true } }) : await db.count('users', { roles: { $has: a.role }, blocked: { $ne: true } }),
      logins7d: await db.count('logins', { app: k, at: { $gt: t - 7 * DAY } }) })));
    const logins = await db.find('logins', {}, { sort: '-at', limit: 60 }), names = await db.getMany('users', logins.map(l => l.userId));
    return { apps: appCounts, adminPerms: ADMIN_PERMS, managerPerms: MANAGER_PERMS, staff: (await staffRows(us)).sort((a, b) => (b.roles.includes('admin') - a.roles.includes('admin')) || (b.roles.includes('manager') - a.roles.includes('manager')) || (a.name || '').localeCompare(b.name || '')),
      logins: logins.map(l => ({ ...l, name: names.get(l.userId)?.name || names.get(l.userId)?.phone || 'Unknown' })) };
  }, 'access');
  route('POST', '/api/admin/access', 'admin', async ({ body, user }) => {
    need(body, [['phone', 'Mobile number'], ['name', 'Name'], ['role', 'Access']]);
    const phone = phoneOf(body.phone); if (!validPhone(phone)) fail(400, 'Enter a valid mobile number');
    if (!['manager', 'admin'].includes(body.role)) fail(400, 'Choose manager or admin access');
    if (body.role === 'manager' && !c.zone(body.zoneId)) fail(400, 'Choose a zone for the manager');
    if (body.role === 'admin' && !c.isSuper(user)) fail(403, 'Only a super admin can add admins');
    let u = await c.ensureUser(phone, str(body.name, 60)); if (!u.name) u = await db.update('users', u.id, { name: str(body.name, 60) });
    const extra = body.role === 'manager' ? { zoneId: body.zoneId, mperms: c.cleanPerms(body.mperms, MANAGER_PERMS) || Object.keys(MANAGER_PERMS) } : { perms: c.cleanPerms(body.perms, ADMIN_PERMS, true) || ['*'] };
    u = await c.addRole(u.id, body.role, extra);
    await c.audit(user, `${body.role} access granted`, `${u.name} (${phone})`, body.role === 'manager' ? body.zoneId : (extra.perms || []).join(', '));
    return staffRow(u);
  }, 'access');
  route('PATCH', '/api/admin/access/:id', 'admin', async ({ params, body, user }) => {
    const u = await db.get('users', params.id); if (!u) fail(404, 'User not found');
    const self = u.id === user.id, supers = (await db.find('users', { roles: { $has: 'admin' }, blocked: { $ne: true } }, { limit: 1000 })).filter(c.isSuper);
    const p = {}, notes = [];
    if (body.grant) {
      const g = body.grant;
      if (g === 'manager') { if (!c.zone(body.zoneId || u.zoneId)) fail(400, 'Choose a zone'); p.roles = [...new Set([...u.roles, 'manager'])]; p.zoneId = body.zoneId || u.zoneId; p.mperms = u.mperms || Object.keys(MANAGER_PERMS); }
      else if (g === 'admin') { if (!c.isSuper(user)) fail(403, 'Only a super admin can grant admin access'); p.roles = [...new Set([...u.roles, 'admin'])]; p.perms = u.perms || []; }
      else if (g === 'vendor' || g === 'rider') {
        const x = g === 'vendor' ? await c.vendorOf(u) : await c.riderOf(u); if (!x) fail(400, `They have no ${g === 'vendor' ? 'shop' : 'rider'} application. They need to apply first.`);
        await db.update(g === 'vendor' ? 'vendors' : 'riders', x.id, { status: 'approved', reviewedBy: user.id, reviewedAt: Date.now() }, { by: user.id }); p.roles = [...new Set([...u.roles, g])];
      } else fail(400, 'Unknown access');
      notes.push('granted ' + g);
    }
    if (body.revoke) {
      const r = body.revoke;
      if (r === 'admin') { if (self) fail(400, 'You cannot remove your own admin access'); if (c.isSuper(u) && supers.length <= 1) fail(400, 'There must be at least one super admin'); }
      if (!['manager', 'admin', 'vendor', 'rider'].includes(r)) fail(400, 'Unknown access');
      p.roles = (p.roles || u.roles).filter(x => x !== r); if (r === 'manager') p.zoneId = null;
      if (r === 'vendor' || r === 'rider') { const x = r === 'vendor' ? await c.vendorOf(u) : await c.riderOf(u); if (x) await db.update(r === 'vendor' ? 'vendors' : 'riders', x.id, { status: 'suspended', online: false, rejectReason: 'Access removed by ZIPI admin' }, { by: user.id }); }
      p.tokenVer = (u.tokenVer || 0) + 1; notes.push('revoked ' + r);
    }
    if (body.zoneId !== undefined && !body.grant && c.has(u, 'manager')) { if (!c.zone(body.zoneId)) fail(400, 'Unknown zone'); p.zoneId = body.zoneId; notes.push('zone ' + body.zoneId); }
    if (body.perms) {
      if (!c.isSuper(user)) fail(403, 'Only a super admin can change admin permissions');
      const next = c.cleanPerms(body.perms, ADMIN_PERMS, true) || [];
      if (c.isSuper(u) && !next.includes('*') && supers.length <= 1) fail(400, 'There must be at least one super admin');
      p.perms = next; notes.push('admin perms: ' + (next.join(', ') || 'none'));
    }
    if (body.mperms) { p.mperms = c.cleanPerms(body.mperms, MANAGER_PERMS) || []; notes.push('manager perms: ' + (p.mperms.join(', ') || 'none')); }
    if (body.lock || body.unlock) {
      const app = body.lock || body.unlock; if (!APPS[app]) fail(400, 'Unknown app');
      if (self && body.lock === 'admin') fail(400, 'You cannot lock yourself out of the admin console');
      const set = new Set(u.locked || []); body.lock ? set.add(app) : set.delete(app); p.locked = [...set]; notes.push(`${body.lock ? 'paused' : 'resumed'} ${app} app`);
      if (body.lock) p.tokenVer = (u.tokenVer || 0) + 1;
    }
    if (body.blocked !== undefined) { if (self) fail(400, 'You cannot block yourself'); p.blocked = !!body.blocked; if (p.blocked) p.tokenVer = (u.tokenVer || 0) + 1; notes.push(p.blocked ? 'blocked' : 'unblocked'); }
    if (body.signOut) { p.tokenVer = (p.tokenVer ?? u.tokenVer ?? 0) + 1; notes.push('signed out everywhere'); }
    if (body.name !== undefined) { const n = str(body.name, 60); if (!n) fail(400, 'Name is required'); p.name = n; notes.push('renamed'); }
    const n = await db.update('users', u.id, p, { by: user.id });
    await c.audit(user, 'access changed', `${u.name || ''} (${u.phone})`, notes.join('; '));
    return staffRow(n);
  }, 'access');
  route('GET', '/api/admin/users/:id', 'admin', async ({ params }) => {
    const u = await db.get('users', params.id); if (!u) fail(404, 'User not found');
    const [stats, orders, wallet, logins, vendor, rider, tickets, ref] = await Promise.all([
      db.q(`SELECT count(*)::int AS orders, count(*) FILTER (WHERE ${T('status')}='delivered')::int AS delivered, COALESCE(sum(${N('total')}) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS spent,
              count(*) FILTER (WHERE ${T('status')} IN ('cancelled','rejected'))::int AS cancelled FROM orders WHERE ${T('customerId')} = $1`, [u.id]),
      db.find('orders', { customerId: u.id }, { sort: '-createdAt', limit: 15 }), db.find('wallet', { userId: u.id }, { sort: '-at', limit: 20 }), db.find('logins', { userId: u.id }, { sort: '-at', limit: 20 }),
      c.vendorOf(u), c.riderOf(u), db.find('tickets', { userId: u.id }, { sort: '-createdAt', limit: 10 }), u.referredBy ? db.get('users', u.referredBy) : null]);
    const shops = await db.getMany('vendors', orders.map(o => o.vendorId)), st = stats.rows[0];
    return { user: { ...(await staffRow(u)), addresses: u.addresses || [], referredBy: ref?.name || null },
      stats: { ...st, spent: r2(st.spent) }, orders: orders.map(o => ({ id: o.id, code: o.code, status: o.status, total: o.total, at: o.createdAt, vendor: shops.get(o.vendorId)?.name })),
      wallet, logins, tickets: tickets.map(t => ({ id: t.id, code: t.code, subject: t.subject, status: t.status, createdAt: t.createdAt })), vendor: vendor && c.showVendor(vendor), rider: rider && c.showRider(rider) };
  }, 'access');
  // clear login-code limits for a phone (customer stuck on "Daily code limit reached" and verified by support)
  route('POST', '/api/admin/users/:id/unlock-otp', 'admin', async ({ params, user }) => {
    const u = await db.get('users', params.id); if (!u) fail(404, 'User not found');
    const r = await db.q(`DELETE FROM ratelimit WHERE k = ANY($1::text[])`, [[`otp:p10:${u.phone}`, `otp:pday:${u.phone}`]]); await db.remove('otps', u.phone).catch(() => {});
    await c.audit(user, 'login code limit cleared', `${u.name || ''} (${u.phone})`);
    return { ok: true, cleared: r.rowCount || 0 };
  }, 'access');
  route('POST', '/api/admin/users/:id/coins', 'admin', async ({ params, body, user }) => {
    const u = await db.get('users', params.id); if (!u) fail(404, 'User not found');
    const amount = Math.round(num(body.amount, 'Coins', -100000, 100000)); if (!amount) fail(400, 'Enter a number of coins');
    const reason = str(body.reason, 80); if (!reason) fail(400, 'Give a reason the customer will see');
    if (!(await c.credit(u.id, amount, reason, 'admin'))) fail(400, `They only have ${Math.floor(u.coins || 0)} coins`);
    await c.audit(user, amount > 0 ? 'coins added' : 'coins removed', `${u.name || ''} (${u.phone})`, `${amount} · ${reason}`);
    return { coins: Math.floor((await db.get('users', u.id)).coins || 0) };
  }, 'access');
  route('PATCH', '/api/admin/vendors/:id', 'admin', async ({ params, body, user }) => {
    const v = await db.get('vendors', params.id); if (!v) fail(404, 'Shop not found'); const p = {};
    for (const [k, max] of [['name', 80], ['ownerName', 60], ['address', 160], ['landmark', 80], ['hours', 40], ['offer', 40]]) if (body[k] !== undefined) p[k] = str(body[k], max);
    if (p.name === '') fail(400, 'Shop name is required');
    if (body.phone !== undefined) { const ph = phoneOf(body.phone); if (!validPhone(ph)) fail(400, 'Enter a valid shop phone'); p.phone = ph; }
    if (body.tags !== undefined) p.tags = String(body.tags).split(',').map(t => str(t, 30)).filter(Boolean).slice(0, 5);
    if (body.prepMins !== undefined && body.prepMins !== '') p.prepMins = Math.round(num(body.prepMins, 'Preparation time', 3, 90));
    if (body.commission !== undefined) p.commission = body.commission === '' || body.commission === null ? null : num(body.commission, 'Commission', 0, 40);
    if (body.zoneId !== undefined) { if (!c.zone(body.zoneId)) fail(400, 'Unknown zone'); p.zoneId = body.zoneId; }
    if (body.online !== undefined) p.online = !!body.online;
    if (body.lat !== undefined && body.lat !== '') Object.assign(p, c.latLng(body, 'Shop location'));
    await c.audit(user, 'shop edited', v.name, JSON.stringify(p).slice(0, 200));
    const n = await db.update('vendors', v.id, p, { by: user.id });
    if (p.zoneId && p.zoneId !== v.zoneId) await db.q(`UPDATE items SET data = jsonb_set(data, '{zoneId}', to_jsonb($2::text)) WHERE data->>'vendorId' = $1`, [v.id, p.zoneId]);
    return c.showVendor(n);
  }, 'partners');
  route('PATCH', '/api/admin/riders/:id', 'admin', async ({ params, body, user }) => {
    const r = await db.get('riders', params.id); if (!r) fail(404, 'Rider not found'); const p = {};
    if (body.name !== undefined) { p.name = str(body.name, 60); if (!p.name) fail(400, 'Name is required'); }
    if (body.zoneId !== undefined) { if (!c.zone(body.zoneId)) fail(400, 'Unknown zone'); p.zoneId = body.zoneId; }
    if (body.vehicle !== undefined) { if (!['bike', 'scooter', 'ev', 'cycle'].includes(body.vehicle)) fail(400, 'Choose a vehicle'); p.vehicle = body.vehicle; }
    if (body.shift !== undefined) p.shift = str(body.shift, 20);
    if (body.online !== undefined) p.online = !!body.online;
    await c.audit(user, 'rider edited', r.name, JSON.stringify(p)); return c.showRider(await db.update('riders', r.id, p, { by: user.id }));
  }, 'partners');
}
