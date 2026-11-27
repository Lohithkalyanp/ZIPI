// Tables, indexes and migrations. Run on every start (idempotent) and with `node scripts/zipi.js migrate`.
// Each index matches the exact expressions the repository generates, so queries stay fast at lakhs of rows.
import { T, N, B } from './repo.js';
import { log } from '../log.js';

export const COLLECTIONS = ['users', 'vendors', 'items', 'riders', 'orders', 'coupons', 'zones', 'settings', 'payouts', 'wallet', 'events', 'feedback',
  'waitlist', 'otps', 'logins', 'audit', 'shifts', 'cashlogs', 'tickets', 'baskets'];

const IDX = {
  users: [`${T('phone')}`, `${T('refCode')}`, `${T('referredBy')}`, `${N('createdAt')} DESC`, `${T('zoneId')}`, { gin: `(data->'roles')` }, { trgm: T('name') }],
  vendors: [`${T('userId')}`, `${T('zoneId')}, ${T('status')}`, `${T('status')}, ${N('createdAt')} DESC`, { trgm: T('name') }],
  items: [`${T('vendorId')}`, `${T('zoneId')}`, { trgm: T('name') }, `${T('zoneId')}, ${T('category')}`],
  riders: [`${T('userId')}`, `${T('zoneId')}, ${T('status')}, ${B('online')}`, `${T('status')}`],
  orders: [`${T('customerId')}, ${N('createdAt')} DESC`, `${T('vendorId')}, ${N('createdAt')} DESC`, `${T('riderId')}, ${T('status')}`,
    `${T('zoneId')}, ${T('status')}`, `${T('zoneId')}, ${N('createdAt')} DESC`, `${T('status')}, ${N('createdAt')}`, `${N('createdAt')} DESC`, `${T('code')}`, `${T('coupon')}`],
  coupons: [`${T('code')}`],
  payouts: [`${T('partyType')}, ${T('partyId')}`, `${N('at')} DESC`],
  wallet: [`${T('userId')}, ${N('at')} DESC`],
  events: [`${T('type')}, ${N('at')}`, `${N('at')}`],
  feedback: [`${N('at')}`, `${T('zoneId')}, ${N('at')}`],
  waitlist: [`${N('at')}`],
  logins: [`${T('userId')}, ${N('at')} DESC`, `${N('at')} DESC`],
  audit: [`${N('at')} DESC`],
  shifts: [`${T('zoneId')}, ${T('day')}`, `${T('riderId')}, ${T('day')}`],
  cashlogs: [`${T('riderId')}, ${N('at')} DESC`],
  baskets: [`${T('customerId')}, ${N('createdAt')} DESC`, `${T('code')}`],
  tickets: [`${T('userId')}, ${N('createdAt')} DESC`, `${T('status')}, ${N('lastMessageAt')} DESC`, `${T('zoneId')}, ${T('status')}`, `${T('assignedTo')}, ${T('status')}`, `${T('orderId')}`, `${T('code')}`],
};

// numbered migrations for anything beyond tables and indexes; each runs exactly once
const MIGRATIONS = [
  ['001-sequences', `CREATE SEQUENCE IF NOT EXISTS order_code_seq START 1001; CREATE SEQUENCE IF NOT EXISTS ticket_code_seq START 1001;`],
  ['002-baskets', `CREATE SEQUENCE IF NOT EXISTS basket_code_seq START 1001; CREATE INDEX IF NOT EXISTS orders_group ON orders ((data->>'groupId'))`],
];

export async function migrate(conn) {
  const q = (t, p) => conn.query(t, p);
  try { await q('CREATE EXTENSION IF NOT EXISTS pg_trgm'); } catch (err) { log.warn('pg_trgm extension not available, text search will be slower', { err: err.message }); }
  const trgm = !!(await q(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)).rows.length;
  await q(`CREATE TABLE IF NOT EXISTS meta (k text PRIMARY KEY, v jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS history (hid bigserial PRIMARY KEY, coll text NOT NULL, doc_id text NOT NULL, op text NOT NULL, data jsonb NOT NULL, by text, at bigint NOT NULL)`);
  await q(`CREATE INDEX IF NOT EXISTS history_doc ON history (coll, doc_id, at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS history_at ON history (at)`);
  await q(`CREATE INDEX IF NOT EXISTS history_deleted ON history (coll, at DESC) WHERE op = 'delete'`);
  await q(`CREATE TABLE IF NOT EXISTS ratelimit (k text PRIMARY KEY, n int NOT NULL, reset_at bigint NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS idem (k text PRIMARY KEY, status int NOT NULL, body jsonb NOT NULL, at bigint NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS geo_cache (k text PRIMARY KEY, v jsonb NOT NULL, at bigint NOT NULL)`);
  for (const c of COLLECTIONS) {
    await q(`CREATE TABLE IF NOT EXISTS "${c}" (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    let i = 0;
    for (const ix of IDX[c] || []) {
      const name = `${c}_ix${++i}`;
      if (typeof ix === 'string') await q(`CREATE INDEX IF NOT EXISTS ${name} ON "${c}" (${ix})`);
      else if (ix.gin) await q(`CREATE INDEX IF NOT EXISTS ${name} ON "${c}" USING gin (${ix.gin})`);
      else if (ix.trgm && trgm) await q(`CREATE INDEX IF NOT EXISTS ${name} ON "${c}" USING gin (${ix.trgm} gin_trgm_ops)`);
    }
  }
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (${T('phone')})`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS orders_code_unique ON orders (${T('code')})`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_unique ON coupons (${T('code')})`);
  const done = new Set((await q(`SELECT k FROM meta WHERE k LIKE 'migration:%'`)).rows.map(r => r.k.slice(10)));
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) await q(stmt);
    await q(`INSERT INTO meta (k, v) VALUES ($1, 'true'::jsonb) ON CONFLICT DO NOTHING`, ['migration:' + name]);
    log.info('migration applied', { name });
  }
}
