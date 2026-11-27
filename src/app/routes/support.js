// Customer feedback and support tickets.
// Customers (and shops / riders) raise a ticket about an order or anything else, with photos; staff reply, add internal notes,
// assign, compensate with coins, and resolve. Customers rate the help they got. Zone managers see their zone's tickets.
import { fail, str, num } from '../context.js';

export const CATEGORIES = {
  missing: ['Missing item', 'high'], wrong: ['Wrong item', 'high'], quality: ['Food or product quality', 'normal'], late: ['Late delivery', 'normal'], damaged: ['Damaged or spilled', 'high'],
  payment: ['Payment or refund', 'high'], rider: ['Delivery partner behaviour', 'high'], safety: ['Safety concern', 'urgent'], app: ['App problem', 'normal'], account: ['Account or login', 'normal'],
  suggestion: ['Suggestion or feedback', 'low'], partner: ['Shop or rider account', 'normal'], other: ['Something else', 'normal'],
};
const PRIORITY = { urgent: 4, high: 3, normal: 2, low: 1 };
const STATUSES = ['open', 'pending', 'resolved', 'closed'];

export default function support(route, c) {
  const { db } = c;
  const attachments = a => (Array.isArray(a) ? a : []).filter(u => typeof u === 'string' && /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp|pdf)$/.test(u)).slice(0, 4);
  const forCustomer = t => ({ ...t, messages: t.messages.filter(m => !m.internal), assignedTo: undefined, internalTags: undefined });

  route('GET', '/api/support/categories', null, () => Object.entries(CATEGORIES).map(([k, [label]]) => ({ k, label })));
  route('POST', '/api/support/tickets', 'any', async ({ user, body, app }) => {
    const cat = CATEGORIES[body.category] ? body.category : 'other', text = str(body.text, 2000);
    if (text.length < 5) fail(400, 'Tell us a little more so we can help');
    if (await db.count('tickets', { userId: user.id, status: { $in: ['open', 'pending'] } }) >= 10) fail(429, 'You have many open requests. We will reply to those first.');
    let order = null;
    if (body.orderId) { order = await c.getOrder(body.orderId, user); if (order.customerId !== user.id && app === 'customer') fail(403, 'Not your order'); }
    const t0 = Date.now(), code = await c.nextCode('ticket_code_seq', 'T');
    const pr = order?.status === 'picked' && cat === 'safety' ? 'urgent' : CATEGORIES[cat][1];
    const t = await db.insert('tickets', { code, userId: user.id, userName: user.name || 'Customer', app, category: cat, subject: str(body.subject, 100) || CATEGORIES[cat][0] + (order ? ` · ${order.code}` : ''),
      orderId: order?.id || null, orderCode: order?.code || null, vendorId: order?.vendorId || null, zoneId: order?.zoneId || user.addresses?.[0]?.zoneId || user.zoneId || null,
      priority: PRIORITY[pr], status: 'open', assignedTo: null, createdAt: t0, lastMessageAt: t0, lastFrom: 'customer',
      messages: [{ id: c.newId('m'), from: 'customer', by: user.id, byName: user.name || 'Customer', text, attachments: attachments(body.attachments), at: t0 }] });
    c.bus.emit({ type: 'ticket', id: t.id, zoneId: t.zoneId, users: [] });
    return forCustomer(t);
  });
  route('GET', '/api/support/tickets', 'any', async ({ user }) => (await db.find('tickets', { userId: user.id }, { sort: '-createdAt', limit: 50 })).map(forCustomer));
  const mine = async (user, id) => { const t = await db.get('tickets', id); if (!t || t.userId !== user.id) fail(404, 'Request not found'); return t; };
  route('GET', '/api/support/tickets/:id', 'any', async ({ user, params }) => forCustomer(await mine(user, params.id)));
  route('POST', '/api/support/tickets/:id/reply', 'any', async ({ user, params, body }) => {
    const t = await mine(user, params.id), text = str(body.text, 2000); if (!text && !attachments(body.attachments).length) fail(400, 'Write a message');
    if (t.status === 'closed') fail(409, 'This request is closed. Start a new one if you still need help.');
    const msg = { id: c.newId('m'), from: 'customer', by: user.id, byName: user.name || 'Customer', text, attachments: attachments(body.attachments), at: Date.now() };
    const n = await db.update('tickets', t.id, x => ({ ...x, messages: [...x.messages, msg].slice(-200), status: 'open', lastMessageAt: msg.at, lastFrom: 'customer' }));
    c.bus.emit({ type: 'ticket', id: t.id, zoneId: t.zoneId, users: t.assignedTo ? [t.assignedTo] : [] });
    return forCustomer(n);
  });
  route('POST', '/api/support/tickets/:id/rate', 'any', async ({ user, params, body }) => {
    const t = await mine(user, params.id); if (!['resolved', 'closed'].includes(t.status)) fail(409, 'You can rate once we have resolved this');
    return forCustomer(await db.update('tickets', t.id, { csat: Math.round(num(body.rating, 'Rating', 1, 5)), csatNote: str(body.note, 300), status: 'closed', closedAt: Date.now() }));
  });

  /* ---------- staff side (admin console with "support" permission, zone managers with "support") ---------- */
  const scope = ctx => (ctx.app === 'admin' ? (ctx.query.zone && ctx.query.zone !== 'all' ? ctx.query.zone : null) : ctx.user.zoneId || fail(403, 'No zone assigned'));
  const staffTicket = async ctx => { const zone = scope(ctx), t = await db.get('tickets', ctx.params.id); if (!t || (zone && t.zoneId !== zone)) fail(404, 'Ticket not found'); return t; };
  const P = { admin: 'support', manager: 'support' };
  route('GET', '/api/staff/tickets', 'staff', async ctx => {
    const zone = scope(ctx), st = ctx.query.status || 'active', q = str(ctx.query.q, 40), before = +ctx.query.before || null;
    const f = { ...(zone ? { zoneId: zone } : {}), ...(st === 'active' ? { status: { $in: ['open', 'pending'] } } : st === 'all' ? {} : { status: st }),
      ...(ctx.query.mine === '1' ? { assignedTo: ctx.user.id } : ctx.query.unassigned === '1' ? { assignedTo: null } : {}), ...(before ? { lastMessageAt: { $lt: before } } : {}),
      ...(q ? { $or: [{ code: q.toUpperCase() }, { orderCode: q.toUpperCase() }, { userName: { $ilike: `%${q}%` } }, { subject: { $ilike: `%${q}%` } }] } : {}) };
    const [list, counts] = await Promise.all([db.find('tickets', f, { sort: ['-priority', '-lastMessageAt'], limit: 100 }),
      db.q(`SELECT data->>'status' AS s, count(*)::int AS n FROM tickets ${zone ? `WHERE data->>'zoneId' = $1` : ''} GROUP BY 1`, zone ? [zone] : [])]);
    const staff = await db.getMany('users', list.map(t => t.assignedTo));
    return { tickets: list.map(t => ({ ...t, messages: undefined, lastMessage: t.messages.filter(m => !m.internal).at(-1)?.text?.slice(0, 140) || '', assignedName: staff.get(t.assignedTo)?.name || null, count: t.messages.length })),
      counts: Object.fromEntries(counts.rows.map(r => [r.s, r.n])), categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, [l]]) => [k, l])) };
  }, P);
  route('GET', '/api/staff/tickets/:id', 'staff', async ctx => {
    const t = await staffTicket(ctx);
    const [u, order, history] = await Promise.all([db.get('users', t.userId), t.orderId ? db.get('orders', t.orderId) : null, db.find('tickets', { userId: t.userId }, { sort: '-createdAt', limit: 6 })]);
    const assignee = t.assignedTo ? await db.get('users', t.assignedTo) : null;
    return { ticket: { ...t, assignedName: assignee?.name || null }, customer: u && { id: u.id, name: u.name, phone: u.phone, coins: Math.floor(u.coins || 0), createdAt: u.createdAt, orders: await db.count('orders', { customerId: u.id }) },
      order: order && await c.orderView(order, ctx.user), previous: history.filter(x => x.id !== t.id).map(x => ({ id: x.id, code: x.code, subject: x.subject, status: x.status, createdAt: x.createdAt })),
      categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, [l]]) => [k, l])) };
  }, P);
  route('POST', '/api/staff/tickets/:id/reply', 'staff', async ctx => {
    const t = await staffTicket(ctx), text = str(ctx.body.text, 3000); if (!text) fail(400, 'Write a reply');
    const internal = !!ctx.body.internal, msg = { id: c.newId('m'), from: 'staff', by: ctx.user.id, byName: ctx.user.name || 'ZIPI support', text, internal, attachments: attachments(ctx.body.attachments), at: Date.now() };
    const n = await db.update('tickets', t.id, x => ({ ...x, messages: [...x.messages, msg].slice(-200), assignedTo: x.assignedTo || ctx.user.id, firstResponseAt: x.firstResponseAt || (internal ? null : msg.at),
      status: internal ? x.status : (ctx.body.status && STATUSES.includes(ctx.body.status) ? ctx.body.status : 'pending'), lastMessageAt: internal ? x.lastMessageAt : msg.at, lastFrom: internal ? x.lastFrom : 'staff',
      resolvedAt: ctx.body.status === 'resolved' ? msg.at : x.resolvedAt }), { by: ctx.user.id });
    if (!internal) c.bus.emit({ type: 'ticket', id: t.id, zoneId: t.zoneId, users: [t.userId] });
    return n;
  }, P);
  route('PATCH', '/api/staff/tickets/:id', 'staff', async ctx => {
    const t = await staffTicket(ctx), p = {}, b = ctx.body;
    if (b.status) { if (!STATUSES.includes(b.status)) fail(400, 'Unknown status'); p.status = b.status; if (b.status === 'resolved') p.resolvedAt = Date.now(); }
    if (b.assignedTo !== undefined) { if (b.assignedTo && b.assignedTo !== 'me') { const s = await db.get('users', b.assignedTo); if (!s || !(c.has(s, 'admin') || c.has(s, 'manager'))) fail(400, 'Assign to a staff member'); } p.assignedTo = b.assignedTo === 'me' ? ctx.user.id : b.assignedTo || null; }
    if (b.priority) { if (!PRIORITY[b.priority]) fail(400, 'Unknown priority'); p.priority = PRIORITY[b.priority]; }
    if (b.category) { if (!CATEGORIES[b.category]) fail(400, 'Unknown category'); p.category = b.category; }
    const n = await db.update('tickets', t.id, p, { by: ctx.user.id });
    if (p.status === 'resolved') c.bus.emit({ type: 'ticket', id: t.id, zoneId: t.zoneId, users: [t.userId] });
    return n;
  }, P);
  // goodwill: coins to the customer, written into the ticket and the audit log
  route('POST', '/api/staff/tickets/:id/compensate', 'staff', async ctx => {
    const t = await staffTicket(ctx), coins = Math.round(num(ctx.body.coins, 'Coins', 1, 2000)), note = str(ctx.body.note, 120) || `Sorry about ${t.orderCode || 'this'}`;
    if (!(await c.credit(t.userId, coins, note, t.code))) fail(400, 'Could not add coins');
    const msg = { id: c.newId('m'), from: 'staff', by: ctx.user.id, byName: ctx.user.name, text: `We've added ${coins} ZIPI coins to your wallet. ${note}`, at: Date.now() };
    const n = await db.update('tickets', t.id, x => ({ ...x, messages: [...x.messages, msg], compensation: (x.compensation || 0) + coins, status: 'resolved', resolvedAt: msg.at, lastMessageAt: msg.at, lastFrom: 'staff' }), { by: ctx.user.id });
    await c.audit(ctx.user, 'ticket compensation', t.code, `${coins} coins · ${note}`);
    c.bus.emit({ type: 'ticket', id: t.id, zoneId: t.zoneId, users: [t.userId] });
    return n;
  }, P);
}
