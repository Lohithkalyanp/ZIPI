// Public catalogue: zones, config, shop lists (paginated), shop menus, search, analytics events, waitlist, uploads.
import { fail, str, need, phoneOf, validPhone } from '../context.js';

const EVENT_TYPES = ['app_open', 'view_vendor', 'add_cart', 'checkout'];
function sniff(buf) {
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

export default function catalog(route, c) {
  const { db } = c;
  const fromLL = ctx => {
    const a = ctx.user && ctx.query.address && (ctx.user.addresses || []).find(x => x.id === ctx.query.address);
    return a ? c.llOf(a.zoneId, a) : ctx.query.zone ? c.center(ctx.query.zone) : null;
  };

  route('GET', '/api/health', null, () => ({ ok: true, zipi: true }));
  route('GET', '/api/zones', null, () => c.zones().sort((a, b) => (b.active - a.active) || (a.createdAt - b.createdAt)));
  route('GET', '/api/config', null, async ({ query }) => {
    const s = await c.S(), coupons = await db.find('coupons', { active: true }, { limit: 50 });
    return { commission: s.commission, freeDeliveryAbove: s.freeDeliveryAbove, baseFee: s.baseFee, platformFee: s.platformFee, smallOrderBelow: s.smallOrderBelow, smallOrderFee: s.smallOrderFee,
      devMode: !!c.config.devOtp, loyaltyPct: s.loyaltyPct || 0, coinsMaxPct: s.coinsMaxPct ?? 20, referralReward: s.referralReward || 0, scheduleDays: s.scheduleDays || 2, maxAddresses: s.maxAddresses || 20,
      supportPhone: s.supportPhone, surge: await c.surgeNow(str(query.zone, 40) || null),
      coupons: coupons.filter(x => !x.expiresAt || x.expiresAt > Date.now()).map(x => ({ code: x.code, title: x.title, desc: x.desc, minOrder: x.minOrder, vendorType: x.vendorType || null })) };
  });
  // shops in a zone: open ones first, then by rating; paginated so huge zones stay fast
  route('GET', '/api/vendors', null, async ctx => {
    const { zone, type } = ctx.query; if (!zone) fail(400, 'zone is required');
    const limit = Math.min(100, Math.max(1, +ctx.query.limit || 60)), offset = Math.max(0, +ctx.query.offset || 0);
    const vs = await db.find('vendors', { zoneId: zone, status: 'approved', ...(type ? { type } : {}) }, { sort: ['-online', '-rating', 'id'], limit, offset });
    return c.vendorCards(vs, fromLL(ctx));
  });
  route('GET', '/api/vendors/:id', null, async ctx => {
    const v = await db.get('vendors', ctx.params.id); if (!v || v.status !== 'approved') fail(404, 'Shop not found');
    const [card] = await c.vendorCards([v], fromLL(ctx));
    return { vendor: card, items: (await db.find('items', { vendorId: v.id, hidden: { $ne: true } }, { limit: 2000 })).map(c.itemView) };
  });
  route('GET', '/api/search', null, async ctx => {
    const q = str(ctx.query.q, 60).toLowerCase(), zone = ctx.query.zone;
    if (q.length < 2 || !zone) return { vendors: [], items: [] };
    const like = '%' + q.replace(/[%_\\]/g, m => '\\' + m) + '%';
    const [vs, its] = await Promise.all([
      db.find('vendors', { zoneId: zone, status: 'approved', $or: [{ name: { $ilike: like } }, { tags: { $has: q.charAt(0).toUpperCase() + q.slice(1) } }] }, { limit: 12 }),
      db.find('items', { zoneId: zone, hidden: { $ne: true }, $or: [{ name: { $ilike: like } }, { section: { $ilike: like } }] }, { limit: 40 })]);
    const shopMap = await db.getMany('vendors', its.map(i => i.vendorId));
    const shops = [...shopMap.values()].filter(v => v.status === 'approved');
    const cards = new Map((await c.vendorCards([...new Map([...vs, ...shops].map(v => [v.id, v])).values()], fromLL(ctx))).map(x => [x.id, x]));
    const vendors = vs.map(v => cards.get(v.id)), items = its.filter(i => cards.has(i.vendorId)).slice(0, 30).map(i => ({ ...c.itemView(i), vendor: cards.get(i.vendorId) }));
    if (ctx.query.log !== '0') c.logEvent(vendors.length || items.length ? 'search' : 'search_miss', { q, zoneId: zone, userId: ctx.user?.id });
    return { vendors, items };
  });
  route('POST', '/api/events', null, async ({ body, user }) => {
    if (!EVENT_TYPES.includes(body.type)) fail(400, 'Unknown event');
    c.logEvent(body.type, { ref: str(body.ref, 40), zoneId: str(body.zoneId, 40), userId: user?.id }); return { ok: true };
  });
  route('POST', '/api/waitlist', null, async ({ body, user }) => {
    need(body, [['phone', 'Mobile number'], ['area', 'Area']]);
    const phone = phoneOf(body.phone); if (!validPhone(phone)) fail(400, 'Enter a valid mobile number');
    await db.insert('waitlist', { phone, area: str(body.area, 60), city: str(body.city, 40) || 'Indore', want: str(body.want, 120), userId: user?.id, at: Date.now() });
    return { ok: true };
  });
  route('POST', '/api/upload', 'any', async ({ body }) => {
    const d = String(body.dataUrl || '');
    const m = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/s.exec(d);
    if (!m) fail(400, 'Upload a JPG, PNG, WEBP or PDF file');
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 3.2e6) fail(400, 'File is larger than 3 MB');
    const declared = m[1].replace('image/jpg', 'image/jpeg');
    if (sniff(buf) !== declared) fail(400, 'That file does not look like a real image or PDF');
    return { url: (await c.storage.save(declared, buf)).url };
  });
}
