// Login, session, profile, address book and the customer's own data (privacy: export and delete).
import { fail, str, need, num, phoneOf, validPhone, APPS, r2, ZONE_RADIUS_KM } from '../context.js';

const appOf = b => (APPS[b.app] ? b.app : 'customer');
const TERMS_VERSION = '2026-11';

export default function account(route, c) {
  const { db } = c;
  const noAccess = (app, phone) => fail(403, `+91 ${phone} is not registered for the ${APPS[app].name}. ${app === 'vendor' || app === 'rider' ? 'Apply in the ZIPI app under "Partner with us", then log in here once approved.' : 'Ask a ZIPI admin to give you access.'}`);

  async function me(u, app = 'customer') {
    u = await c.refCodeFor(u);
    const [v, rd] = await Promise.all([c.vendorOf(u), c.riderOf(u)]);
    return { user: c.safeUser(u), vendor: v && c.showVendor(v), rider: rd && c.showRider(rd), zone: u.zoneId ? c.zone(u.zoneId) : null, app };
  }
  c.me = me;

  route('POST', '/api/auth/otp', null, async ({ body, meta }) => {
    const phone = phoneOf(body.phone), app = appOf(body);
    if (!validPhone(phone)) fail(400, 'Enter a valid 10-digit Indian mobile number');
    if (app !== 'customer') { const u = await db.one('users', { phone }); if (!c.canUseApp(u, app) || u.blocked) noAccess(app, phone); }
    const r = await c.otp.send(phone, meta.ip);
    return { sent: true, ttl: r.ttl, resendIn: r.resendIn, devOtp: r.code };
  });
  route('POST', '/api/auth/verify', null, async ({ body, meta }) => {
    const phone = phoneOf(body.phone), app = appOf(body);
    if (!validPhone(phone)) fail(400, 'Enter a valid mobile number');
    await c.otp.verify(phone, str(body.code, 10));
    if (app !== 'customer' && !c.canUseApp(await db.one('users', { phone }), app)) noAccess(app, phone);
    const existing = await db.one('users', { phone });
    let u = existing || await c.ensureUser(phone, str(body.name, 60));
    if (u.blocked) fail(403, 'This account is blocked. Contact support.');
    if (u.deleted) fail(403, 'This account was deleted. Contact support to restore it.');
    const patch = {};
    if (body.name && !u.name) patch.name = str(body.name, 60);
    if (!existing && body.ref) { const by = await db.one('users', { refCode: str(body.ref, 20).toUpperCase() }); if (by && by.id !== u.id) patch.referredBy = by.id; }
    if (!u.consentAt && app === 'customer') { patch.consentAt = Date.now(); patch.consentVersion = TERMS_VERSION; }
    if (Object.keys(patch).length) u = await db.update('users', u.id, patch);
    await db.insert('logins', { userId: u.id, app, at: Date.now(), ip: str(meta.ip, 60), ua: str(meta.ua, 160) });
    return { token: c.issueToken(u, app), ...(await me(u, app)), isNew: !existing };
  });
  route('POST', '/api/auth/logout-all', 'any', async ({ user }) => { await db.incr('users', user.id, 'tokenVer', 1); return { ok: true }; });

  route('GET', '/api/me', 'any', ({ user, app }) => me(user, app));
  route('PATCH', '/api/me', 'any', async ({ user, body, app }) => {
    const p = {};
    if (body.name !== undefined) { p.name = str(body.name, 60); if (!p.name) fail(400, 'Name is required'); }
    if (body.email !== undefined) { p.email = str(body.email, 100); if (p.email && !/^\S+@\S+\.\S+$/.test(p.email)) fail(400, 'Enter a valid email'); }
    return me(await db.update('users', user.id, p), app);
  });
  route('POST', '/api/me/favourites', 'any', async ({ user, body }) => {
    const v = await db.get('vendors', body.vendorId); if (!v) fail(404, 'Shop not found');
    return me(await db.update('users', user.id, u => { const f = new Set(u.favs || []); body.on === false || (body.on === undefined && f.has(v.id)) ? f.delete(v.id) : f.add(v.id); return { ...u, favs: [...f].slice(-200) }; }));
  });
  route('GET', '/api/me/wallet', 'any', async ({ user }) => {
    const u = await c.refCodeFor(await db.get('users', user.id)), s = await c.S();
    const [joined, rewarded, ledger] = await Promise.all([db.count('users', { referredBy: u.id }), db.count('users', { referredBy: u.id, referralPaid: true }), db.find('wallet', { userId: u.id }, { sort: '-at', limit: 50 })]);
    return { coins: Math.floor(u.coins || 0), refCode: u.refCode, referralReward: s.referralReward || 0, loyaltyPct: s.loyaltyPct || 0, coinsMaxPct: s.coinsMaxPct ?? 20, referrals: { joined, rewarded }, ledger };
  });

  /* ---------- address book: many addresses, edit, default, rider notes, ordering for someone else ---------- */
  async function addressFrom(body, prev = {}) {
    need({ ...prev, ...body }, [['line', 'House / flat and street'], ['area', 'Area'], ['zoneId', 'Delivery zone']]);
    const zoneId = body.zoneId ?? prev.zoneId, z = c.zone(zoneId); if (!z) fail(400, 'Unknown zone');
    if (!z.active) fail(400, `ZIPI is not delivering in ${z.name} yet`);
    let loc = prev.zoneId === zoneId ? prev.loc : null, ll = prev.lat != null && prev.zoneId === zoneId ? { lat: prev.lat, lng: prev.lng } : {};
    if (body.lat !== undefined && body.lat !== '' && body.lng !== undefined && body.lng !== '') {
      ll = c.latLng(body, 'Address pin'); loc = c.fromLL(z.id, ll.lat, ll.lng);
      if (Math.hypot(loc.x, loc.y) > ZONE_RADIUS_KM) fail(400, `That pin is outside ${z.name}. Move it closer or pick another zone.`);
    }
    if (!loc) loc = { x: 0, y: 0 };
    const rp = body.receiverPhone !== undefined ? phoneOf(body.receiverPhone) : prev.receiverPhone || '';
    if (rp && !validPhone(rp)) fail(400, 'Enter a valid phone number for the person receiving the order');
    const pick = (k, max) => str(body[k] !== undefined ? body[k] : prev[k], max);
    return { label: pick('label', 24) || 'Home', line: pick('line', 140), building: pick('building', 80), floor: pick('floor', 20), area: pick('area', 80), landmark: pick('landmark', 80),
      city: pick('city', 40) || z.city, pincode: pick('pincode', 6).replace(/\D/g, ''), instructions: pick('instructions', 160), receiverName: pick('receiverName', 60), receiverPhone: rp,
      zoneId: z.id, loc, ...ll };
  }
  route('POST', '/api/me/addresses', 'any', async ({ user, body, app }) => {
    const s = await c.S(), a = { id: c.newId('a'), ...(await addressFrom(body)), createdAt: Date.now() };
    const u = await db.update('users', user.id, u => {
      if ((u.addresses || []).length >= (s.maxAddresses || 20)) fail(400, `You can save up to ${s.maxAddresses || 20} addresses. Delete one first.`);
      const addresses = [...(u.addresses || []), a];
      return { ...u, addresses, defaultAddress: body.makeDefault || !u.defaultAddress ? a.id : u.defaultAddress };
    });
    return { address: a, ...(await me(u, app)) };
  });
  route('PATCH', '/api/me/addresses/:id', 'any', async ({ user, params, body, app }) => {
    const cur = (user.addresses || []).find(a => a.id === params.id); if (!cur) fail(404, 'Address not found');
    const next = { ...cur, ...(await addressFrom(body, cur)), updatedAt: Date.now() };
    const u = await db.update('users', user.id, u => ({ ...u, addresses: (u.addresses || []).map(a => (a.id === cur.id ? next : a)), defaultAddress: body.makeDefault ? cur.id : u.defaultAddress }));
    return { address: next, ...(await me(u, app)) };
  });
  route('POST', '/api/me/addresses/:id/default', 'any', async ({ user, params, app }) => {
    if (!(user.addresses || []).some(a => a.id === params.id)) fail(404, 'Address not found');
    return me(await db.update('users', user.id, { defaultAddress: params.id }), app);
  });
  route('DELETE', '/api/me/addresses/:id', 'any', async ({ user, params, app }) => me(await db.update('users', user.id, u => {
    const addresses = (u.addresses || []).filter(a => a.id !== params.id);
    return { ...u, addresses, defaultAddress: u.defaultAddress === params.id ? addresses[0]?.id || null : u.defaultAddress };
  }), app));

  /* ---------- privacy (DPDP Act): a copy of my data, and deleting my account ---------- */
  route('GET', '/api/me/export', 'any', async ({ user }) => {
    const [orders, wallet, tickets, feedback, logins] = await Promise.all([db.find('orders', { customerId: user.id }, { sort: '-createdAt', limit: 5000 }), db.find('wallet', { userId: user.id }, { sort: '-at', limit: 5000 }),
      db.find('tickets', { userId: user.id }, { sort: '-createdAt', limit: 1000 }), db.find('feedback', { userId: user.id }, { limit: 1000 }), db.find('logins', { userId: user.id }, { sort: '-at', limit: 500 })]);
    const u = await db.get('users', user.id);
    return { exportedAt: new Date().toISOString(), profile: { name: u.name, phone: u.phone, email: u.email || '', createdAt: u.createdAt, consentAt: u.consentAt || null, coins: u.coins || 0 },
      addresses: u.addresses || [], favourites: u.favs || [], orders: orders.map(o => ({ code: o.code, at: o.createdAt, status: o.status, items: o.items, total: o.total, payment: o.payment, address: o.address, rating: o.rating ?? null, review: o.review || '' })),
      coins: wallet, supportTickets: tickets.map(t => ({ code: t.code, category: t.category, status: t.status, createdAt: t.createdAt, messages: t.messages.filter(m => !m.internal).map(m => ({ from: m.from, text: m.text, at: m.at })) })),
      feedback, logins: logins.map(l => ({ app: l.app, at: l.at })) };
  });
  route('POST', '/api/me/delete', 'any', async ({ user, body, app }) => {
    if (app !== 'customer') fail(400, 'Delete your account from the ZIPI app');
    if (str(body.confirm, 10).toUpperCase() !== 'DELETE') fail(400, 'Type DELETE to confirm');
    if (user.roles.some(r => r !== 'customer')) fail(409, 'This number is also used for a shop, rider or staff account. Contact support to close those first.');
    if (await db.count('orders', { customerId: user.id, status: { $in: ['scheduled', 'placed', 'accepted', 'ready', 'picked'] } })) fail(409, 'You have an order in progress. Try again after it is delivered.');
    // orders stay for tax and accounting records, but nothing in them identifies the person any more
    const anon = 'deleted-' + c.newId();
    await db.update('users', user.id, { name: 'Deleted user', phone: anon, email: '', addresses: [], favs: [], refCode: null, deleted: true, deletedAt: Date.now(), tokenVer: (user.tokenVer || 0) + 1 });
    await db.q(`UPDATE orders SET data = data || jsonb_build_object('address', jsonb_build_object('label', 'Deleted', 'area', data->'address'->>'area', 'zoneId', data->'address'->>'zoneId'), 'note', '') WHERE data->>'customerId' = $1`, [user.id]);
    await c.audit(user, 'account deleted by user', user.id, 'Personal data removed; orders kept without personal details');
    return { ok: true };
  });

  // public: visitors pick a location before logging in (rate-limited per network in http.js)
  route('GET', '/api/maps/search', null, async ({ query }) => {
    const z = query.zone && c.zone(query.zone);
    return c.maps.search(str(query.q, 120), z ? { lat: z.lat, lng: z.lng } : null);
  });
  route('GET', '/api/maps/reverse', null, async ({ query }) => {
    const ll = c.latLng(query, 'Location'); return (await c.maps.reverse(ll.lat, ll.lng)) || {};
  });
  void r2; void num;
}
