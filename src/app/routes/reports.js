// Data extracts for staff. Every report is a CSV streamed in batches of 2000 rows straight from the database,
// so exporting lakhs of rows does not load them into memory. Each export is written to the audit log.
// Admins need the "reports" permission; zone managers need "reports" and only get their own zone.
import { fail, str, DAY, r2, localTs } from '../context.js';
import { N, T } from '../../db/repo.js';

const fmtDate = t => (t ? new Date(t).toLocaleString('en-IN', { timeZone: process.env.APP_TZ || 'Asia/Kolkata', hour12: false }) : '');
const mask = p => (p ? String(p).slice(0, 2) + 'XXXXXX' + String(p).slice(-2) : '');

export const REPORTS = {
  orders: { name: 'Orders', desc: 'Every order with amounts, payment, status, rider and rating', zone: true },
  daily: { name: 'Daily summary', desc: 'Orders, delivered value and money breakdown per day and zone', zone: true },
  vendor_payouts: { name: 'Shop payouts', desc: 'Earned, paid and due for every shop', zone: true },
  rider_earnings: { name: 'Rider earnings', desc: 'Trips, distance, earnings and cash for every rider', zone: true },
  vendor_performance: { name: 'Shop performance', desc: 'Orders, rejections, ratings and prep time per shop', zone: true },
  customers: { name: 'Customers', desc: 'Customers with orders, spend and last order (phones masked)', zone: false },
  feedback: { name: 'Ratings & feedback', desc: 'Every rating, review, NPS score and suggestion', zone: true },
  tickets: { name: 'Support tickets', desc: 'Tickets with category, status, response times and satisfaction', zone: true },
  items: { name: 'Item sales', desc: 'Quantity and revenue per item and shop', zone: true },
};

export default function reports(route, c) {
  const { db } = c;
  // keyset pagination over (createdAt, id): constant speed however deep the export goes
  async function* scan(coll, where, params, timeField = 'createdAt') {
    let lastT = Number.MAX_SAFE_INTEGER, lastId = '';
    for (;;) {
      const r = await db.q(`SELECT data FROM "${coll}" WHERE ${where} AND (${N(timeField)} < $${params.length + 1} OR (${N(timeField)} = $${params.length + 1} AND id < $${params.length + 2}))
        ORDER BY ${N(timeField)} DESC, id DESC LIMIT 2000`, [...params, lastT, lastId || '￿']);
      if (!r.rows.length) return;
      for (const x of r.rows) yield x.data;
      const last = r.rows.at(-1).data; lastT = last[timeField]; lastId = last.id;
      if (r.rows.length < 2000) return;
    }
  }
  async function* rowsOf(q, params) { for (const r of (await db.q(q, params)).rows) yield r; }

  route('GET', '/api/reports', 'staff', ({ app }) => Object.entries(REPORTS).filter(([, r]) => app === 'admin' || r.zone).map(([k, r]) => ({ k, ...r })), { admin: 'reports', manager: 'reports' });
  route('GET', '/api/reports/:type', 'staff', async ctx => {
    const type = ctx.params.type, rep = REPORTS[type]; if (!rep) fail(404, 'Unknown report');
    if (ctx.app === 'manager' && !rep.zone) fail(403, 'This report is only available to head office');
    const zone = ctx.app === 'manager' ? ctx.user.zoneId : (ctx.query.zone && ctx.query.zone !== 'all' ? ctx.query.zone : null);
    if (zone && !c.zone(zone)) fail(400, 'Unknown zone');
    const to = ctx.query.to ? Date.parse(ctx.query.to) + DAY - 1 : Date.now(), from = ctx.query.from ? Date.parse(ctx.query.from) : to - 30 * DAY;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) fail(400, 'Choose a valid date range');
    if (to - from > 366 * DAY) fail(400, 'Choose at most one year at a time');
    const fullPhones = ctx.app === 'admin' && c.adminPerms(ctx.user).some(p => p === '*' || p === 'access');
    const zw = (alias = '') => (zone ? ` AND ${alias}data->>'zoneId' = '${zone}'` : '');
    const range = [from, to], zn = id => c.zone(id)?.name || '';
    await c.audit(ctx.user, 'report downloaded', rep.name, `${new Date(from).toISOString().slice(0, 10)} to ${new Date(to).toISOString().slice(0, 10)}${zone ? ' · ' + zn(zone) : ''}`);
    const stamp = new Date().toISOString().slice(0, 10), filename = `zipi-${type}-${stamp}.csv`;

    if (type === 'orders') {
      const shops = new Map(), riders = new Map(), people = new Map();
      return { csv: { filename, header: ['Order', 'Placed', 'Zone', 'Shop', 'Type', 'Customer', 'Phone', 'Items', 'Item total', 'Delivery fee', 'Other fees', 'Surge', 'Discount', 'Coupon', 'Coins used', 'Total', 'Payment', 'Status', 'Rider', 'Delivered', 'Minutes', 'Rating', 'Cancel reason'],
        rows: (async function* () {
          for await (const o of scan('orders', `${N('createdAt')} BETWEEN $1 AND $2${zw()}`, range)) {
            if (!shops.has(o.vendorId)) shops.set(o.vendorId, (await db.get('vendors', o.vendorId))?.name || '');
            if (o.riderId && !riders.has(o.riderId)) riders.set(o.riderId, (await db.get('riders', o.riderId))?.name || '');
            if (!people.has(o.customerId)) { if (people.size > 50000) people.clear(); const u = await db.get('users', o.customerId); people.set(o.customerId, u ? [u.name || '', u.phone || ''] : ['', '']); }
            const [cName, cPhone] = people.get(o.customerId);
            const del = o.timeline?.find(x => x.status === 'delivered')?.at;
            yield [o.code, fmtDate(o.createdAt), zn(o.zoneId), shops.get(o.vendorId), o.vendorType, cName, fullPhones ? cPhone : mask(cPhone), o.items.reduce((a, l) => a + l.qty, 0), o.subtotal, o.deliveryFee,
              (o.smallOrderFee || 0) + (o.platformFee || 0), o.surgeFee || 0, o.discount || 0, o.coupon || '', o.coinsUsed || 0, o.total, o.payment, o.status, riders.get(o.riderId) || '', fmtDate(del), del ? Math.round((del - o.createdAt) / 60000) : '', o.rating ?? '', o.cancelReason || ''];
          }
        })() } };
    }
    if (type === 'daily') {
      return { csv: { filename, header: ['Day', 'Zone', 'Orders', 'Delivered', 'Cancelled', 'Delivered value', 'Commission', 'Customer fees', 'Discounts & coins', 'Rider pay', 'Contribution'],
        rows: (async function* () {
          for await (const r of rowsOf(`SELECT to_char(${localTs(N('createdAt'))}, 'YYYY-MM-DD') AS d, ${T('zoneId')} AS z, count(*)::int AS n, count(*) FILTER (WHERE ${T('status')}='delivered')::int AS del,
              count(*) FILTER (WHERE ${T('status')} IN ('cancelled','rejected'))::int AS can, COALESCE(sum(${N('total')}) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS gmv,
              COALESCE(sum(${N('commission')}) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS com, COALESCE(sum(${N('deliveryFee')} + COALESCE(${N('smallOrderFee')},0) + COALESCE(${N('platformFee')},0) + COALESCE(${N('surgeFee')},0)) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS fees,
              COALESCE(sum(${N('discount')} + COALESCE(${N('coinsUsed')},0)) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS disc, COALESCE(sum(${N('riderPay')}) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS rp
            FROM orders WHERE ${N('createdAt')} BETWEEN $1 AND $2${zw()} GROUP BY 1, 2 ORDER BY 1 DESC, 2`, range))
            yield [r.d, zn(r.z), r.n, r.del, r.can, r2(r.gmv), r2(r.com), r2(r.fees), r2(r.disc), r2(r.rp), r2(r.com + r.fees - r.disc - r.rp)];
        })() } };
    }
    if (type === 'vendor_payouts' || type === 'rider_earnings') {
      const kind = type === 'vendor_payouts' ? 'vendor' : 'rider', coll = kind === 'vendor' ? 'vendors' : 'riders', who = kind === 'vendor' ? 'vendorId' : 'riderId', f = kind === 'vendor' ? 'vendorNet' : 'riderPay';
      return { csv: { filename, header: kind === 'vendor' ? ['Shop', 'Zone', 'Status', 'Delivered orders (period)', 'Gross (period)', 'Commission (period)', 'Net (period)', 'Earned all time', 'Paid all time', 'Due now', 'UPI'] : ['Rider', 'Zone', 'Status', 'Trips (period)', 'Km (period)', 'Earnings (period)', 'Cash orders (period)', 'Earned all time', 'Paid all time', 'Due now', 'Cash in hand', 'UPI'],
        rows: (async function* () {
          for await (const r of rowsOf(`WITH per AS (SELECT ${T(who)} AS id, count(*)::int AS n, COALESCE(sum(${N('subtotal')}),0)::float8 AS gross, COALESCE(sum(${N('commission')}),0)::float8 AS com, COALESCE(sum(${N(f)}),0)::float8 AS amt,
                COALESCE(sum(${N('dist')}),0)::float8 AS km, count(*) FILTER (WHERE ${T('payment')}='COD')::int AS cod FROM orders WHERE ${T('status')}='delivered' AND ${N('createdAt')} BETWEEN $1 AND $2 GROUP BY 1),
              alltime AS (SELECT ${T(who)} AS id, COALESCE(sum(${N(f)}),0)::float8 AS earned FROM orders WHERE ${T('status')}='delivered' GROUP BY 1),
              paid AS (SELECT ${T('partyId')} AS id, COALESCE(sum(${N('amount')}),0)::float8 AS paid FROM payouts WHERE ${T('partyType')} = '${kind}' GROUP BY 1)
            SELECT x.data, per.*, COALESCE(alltime.earned,0) AS earned, COALESCE(paid.paid,0) AS paid FROM "${coll}" x LEFT JOIN per ON per.id = x.id LEFT JOIN alltime ON alltime.id = x.id LEFT JOIN paid ON paid.id = x.id
            WHERE x.data->>'status' <> 'pending'${zw('x.')} ORDER BY COALESCE(alltime.earned,0) - COALESCE(paid.paid,0) DESC`, range)) {
            const x = r.data;
            yield kind === 'vendor' ? [x.name, zn(x.zoneId), x.status, r.n || 0, r2(r.gross || 0), r2(r.com || 0), r2(r.amt || 0), r2(r.earned), r2(r.paid), r2(r.earned - r.paid), x.upi || '']
              : [x.name, zn(x.zoneId), x.status, r.n || 0, r2(r.km || 0), r2(r.amt || 0), r.cod || 0, r2(r.earned), r2(r.paid), r2(r.earned - r.paid), r2(x.cashInHand || 0), x.upi || ''];
          }
        })() } };
    }
    if (type === 'vendor_performance') {
      return { csv: { filename, header: ['Shop', 'Zone', 'Type', 'Orders', 'Delivered', 'Rejected or missed', 'Lost %', 'Average rating', 'Ratings', 'Average prep minutes', 'Promised prep', 'Delivered value'],
        rows: (async function* () {
          for await (const r of rowsOf(`SELECT v.data AS v, count(o.id)::int AS n, count(o.id) FILTER (WHERE o.data->>'status'='delivered')::int AS del,
              count(o.id) FILTER (WHERE o.data->>'status'='rejected' OR o.data->>'cancelReason' LIKE '%respond%')::int AS lost,
              avg((o.data->>'rating')::numeric)::float8 AS rating, count(o.data->'rating') FILTER (WHERE o.data->'rating' <> 'null'::jsonb)::int AS rated,
              COALESCE(sum((o.data->>'total')::numeric) FILTER (WHERE o.data->>'status'='delivered'),0)::float8 AS gmv,
              avg(((o.data->>'readyAt')::numeric - (o.data->>'acceptedAt')::numeric) / 60000) FILTER (WHERE o.data->'readyAt' IS NOT NULL AND o.data->'acceptedAt' IS NOT NULL)::float8 AS prep
            FROM vendors v LEFT JOIN orders o ON o.data->>'vendorId' = v.id AND (o.data->>'createdAt')::numeric BETWEEN $1 AND $2
            WHERE v.data->>'status' = 'approved'${zw('v.')} GROUP BY v.id, v.data ORDER BY 2 DESC`, range))
            yield [r.v.name, zn(r.v.zoneId), r.v.type, r.n, r.del, r.lost, r.n ? Math.round(1000 * r.lost / r.n) / 10 : 0, r.rating ? Math.round(r.rating * 10) / 10 : '', r.rated, r.prep ? Math.round(r.prep) : '', r.v.prepMins, r2(r.gmv)];
        })() } };
    }
    if (type === 'customers') {
      return { csv: { filename, header: ['Customer ID', 'Name', 'Phone', 'Joined', 'Orders (period)', 'Spent (period)', 'Orders all time', 'Last order', 'Coins', 'Referred'],
        rows: (async function* () {
          for await (const r of rowsOf(`WITH p AS (SELECT ${T('customerId')} AS id, count(*)::int AS n, COALESCE(sum(${N('total')}) FILTER (WHERE ${T('status')}='delivered'),0)::float8 AS spent FROM orders WHERE ${N('createdAt')} BETWEEN $1 AND $2 GROUP BY 1),
              a AS (SELECT ${T('customerId')} AS id, count(*)::int AS n, max(${N('createdAt')})::float8 AS last FROM orders GROUP BY 1)
            SELECT u.data, COALESCE(p.n,0) AS pn, COALESCE(p.spent,0) AS spent, COALESCE(a.n,0) AS an, a.last FROM users u LEFT JOIN p ON p.id = u.id LEFT JOIN a ON a.id = u.id
            WHERE NOT COALESCE((u.data->>'deleted')::boolean,false) ORDER BY COALESCE(p.spent,0) DESC`, range))
            yield [r.data.id, r.data.name, fullPhones ? r.data.phone : mask(r.data.phone), fmtDate(r.data.createdAt), r.pn, r2(r.spent), r.an, fmtDate(r.last), Math.floor(r.data.coins || 0), r.data.referredBy ? 'yes' : ''];
        })() } };
    }
    if (type === 'feedback') {
      return { csv: { filename, header: ['Date', 'Order', 'Zone', 'Shop', 'Food rating', 'Review', 'NPS', 'Suggestion', 'Tags'],
        rows: (async function* () {
          const shops = new Map();
          for await (const o of scan('orders', `${N('createdAt')} BETWEEN $1 AND $2 AND data->'rating' IS NOT NULL AND data->'rating' <> 'null'::jsonb${zw()}`, range)) {
            if (!shops.has(o.vendorId)) shops.set(o.vendorId, (await db.get('vendors', o.vendorId))?.name || '');
            const fb = await db.one('feedback', { orderId: o.id });
            yield [fmtDate(o.ratedAt || o.createdAt), o.code, zn(o.zoneId), shops.get(o.vendorId), o.rating, o.review || '', fb?.nps ?? '', fb?.wish || '', (fb?.tags || []).join('; ')];
          }
        })() } };
    }
    if (type === 'tickets') {
      return { csv: { filename, header: ['Ticket', 'Created', 'Zone', 'From', 'Category', 'Subject', 'Order', 'Priority', 'Status', 'Messages', 'First reply (min)', 'Resolved', 'Resolution (hours)', 'Coins given', 'Satisfaction'],
        rows: (async function* () {
          for await (const t of scan('tickets', `${N('createdAt')} BETWEEN $1 AND $2${zw()}`, range))
            yield [t.code, fmtDate(t.createdAt), zn(t.zoneId), t.app, t.category, t.subject, t.orderCode || '', ['', 'low', 'normal', 'high', 'urgent'][t.priority] || '', t.status, t.messages.length,
              t.firstResponseAt ? Math.round((t.firstResponseAt - t.createdAt) / 60000) : '', fmtDate(t.resolvedAt), t.resolvedAt ? Math.round((t.resolvedAt - t.createdAt) / 360000) / 10 : '', t.compensation || 0, t.csat ?? ''];
        })() } };
    }
    if (type === 'items') {
      return { csv: { filename, header: ['Item', 'Shop', 'Zone', 'Quantity sold', 'Revenue', 'Orders'],
        rows: (async function* () {
          for await (const r of rowsOf(`SELECT l->>'name' AS item, o.data->>'vendorId' AS v, o.data->>'zoneId' AS z, sum((l->>'qty')::int)::int AS qty, sum((l->>'qty')::int * (l->>'price')::numeric)::float8 AS rev, count(DISTINCT o.id)::int AS n
            FROM orders o, jsonb_array_elements(o.data->'items') l WHERE o.data->>'status'='delivered' AND (o.data->>'createdAt')::numeric BETWEEN $1 AND $2${zw('o.')} GROUP BY 1, 2, 3 ORDER BY 5 DESC LIMIT 200000`, range)) {
            yield [r.item, (await db.get('vendors', r.v))?.name || '', zn(r.z), r.qty, r2(r.rev), r.n];
          }
        })() } };
    }
    void str;
  }, { admin: 'reports', manager: 'reports' });
}
