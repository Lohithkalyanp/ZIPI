// Document repository on PostgreSQL. Every collection is a table (id text, data jsonb).
// Queries use a small filter language that compiles to SQL whose expressions match the indexes in schema.js:
//   { status: 'placed' }                 equality (text, number, boolean, null)
//   { status: { $in: ['a','b'] } }        $in / $nin
//   { createdAt: { $gte: t, $lt: u } }    numeric ranges
//   { riderId: { $ne: null } }            $ne
//   { roles: { $has: 'admin' } }          array contains (GIN index)
//   { name: { $ilike: '%biry%' } }        text search (trigram index)
//   { $or: [ {...}, {...} ] }
// Writes to tracked collections keep the previous version in `history`, which powers record recovery.
import crypto from 'node:crypto';

export const newId = (p = '') => p + Date.now().toString(36).slice(-6) + crypto.randomBytes(4).toString('hex').slice(0, 7);

// fields compared and sorted as numbers
export const NUMERIC = new Set(['createdAt', 'updatedAt', 'at', 'releaseAt', 'scheduleAt', 'placedAt', 'acceptedAt', 'deliveredAt', 'exp', 'total', 'subtotal', 'rating',
  'ratingCount', 'stock', 'amount', 'cashInHand', 'coins', 'price', 'nps', 'priority', 'lastMessageAt', 'resolvedAt']);
// collections whose changes are versioned for recovery (high-volume logs are not)
export const TRACKED = new Set(['users', 'vendors', 'items', 'riders', 'orders', 'coupons', 'zones', 'settings', 'payouts', 'tickets', 'shifts', 'cashlogs', 'baskets']);
const SAFE = /^[a-z_][a-z0-9_]*$/;

const path = f => f.split('.');
const jsonExpr = f => (f.includes('.') ? `data #> '{${path(f).join(',')}}'` : `data->'${f}'`);
export const T = f => (f.includes('.') ? `(data #>> '{${path(f).join(',')}}')` : `(data->>'${f}')`);
export const N = f => `(${T(f)}::numeric)`;
export const B = f => `COALESCE(${T(f)}::boolean, false)`;
const checkField = f => { if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(f)) throw new Error('bad field ' + f); return f; };
const checkColl = c => { if (!SAFE.test(c)) throw new Error('bad collection ' + c); return `"${c}"`; };

export function compile(filter = {}, params = []) {
  const parts = [];
  const p = v => { params.push(v); return `$${params.length}`; };
  for (const [key, val] of Object.entries(filter)) {
    if (val === undefined) continue;
    if (key === '$or' || key === '$and') {
      const subs = val.map(f => compile(f, params)).filter(s => s !== 'TRUE');
      if (subs.length) parts.push(`(${subs.join(key === '$or' ? ' OR ' : ' AND ')})`);
      continue;
    }
    const f = checkField(key);
    if (val === null) { parts.push(`(${jsonExpr(f)} IS NULL OR ${jsonExpr(f)} = 'null'::jsonb)`); continue; }
    if (typeof val !== 'object' || Array.isArray(val)) { parts.push(eq(f, val, p)); continue; }
    for (const [op, v] of Object.entries(val)) {
      if (v === undefined) continue;
      if (op === '$in' || op === '$nin') {
        if (!v.length) { parts.push(op === '$in' ? 'FALSE' : 'TRUE'); continue; }
        const nums = v.every(x => typeof x === 'number');
        parts.push(`${op === '$nin' ? 'NOT ' : ''}${nums ? N(f) : T(f)} = ANY(${p(v)}::${nums ? 'numeric' : 'text'}[])`);
      } else if (op === '$ne') {
        parts.push(v === null ? `(${jsonExpr(f)} IS NOT NULL AND ${jsonExpr(f)} <> 'null'::jsonb)` : typeof v === 'boolean' ? `${B(f)} <> ${p(v)}` : typeof v === 'number' ? `${N(f)} IS DISTINCT FROM ${p(v)}` : `${T(f)} IS DISTINCT FROM ${p(String(v))}`);
      } else if (['$gt', '$gte', '$lt', '$lte'].includes(op)) {
        parts.push(`${N(f)} ${{ $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[op]} ${p(v)}`);
      } else if (op === '$has') parts.push(`${jsonExpr(f)} @> ${p(JSON.stringify([v]))}::jsonb`);
      else if (op === '$exists') parts.push(v ? `(${jsonExpr(f)} IS NOT NULL AND ${jsonExpr(f)} <> 'null'::jsonb)` : `(${jsonExpr(f)} IS NULL OR ${jsonExpr(f)} = 'null'::jsonb)`);
      else if (op === '$ilike') parts.push(`${T(f)} ILIKE ${p(v)}`);
      else throw new Error('unknown operator ' + op);
    }
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}
function eq(f, v, p) {
  if (typeof v === 'boolean') return `${B(f)} = ${p(v)}`;
  if (typeof v === 'number') return `${N(f)} = ${p(v)}`;
  return `${T(f)} = ${p(String(v))}`;
}
function orderBy(sort) {
  if (!sort) return '';
  const list = (Array.isArray(sort) ? sort : [sort]).map(s => {
    const desc = s.startsWith('-'), f = checkField(desc ? s.slice(1) : s);
    return `${f === 'id' ? 'id' : NUMERIC.has(f) ? N(f) : T(f)} ${desc ? 'DESC' : 'ASC'} NULLS LAST`;
  });
  return ` ORDER BY ${list.join(', ')}`;
}

export function makeRepo(conn, { inTx = false, actor = null } = {}) {
  const q = (text, params) => conn.query(text, params);
  const rows = r => r.rows.map(x => x.data);
  const repo = {
    q, inTx,
    async get(coll, id) { if (id == null) return null; const r = await q(`SELECT data FROM ${checkColl(coll)} WHERE id = $1`, [String(id)]); return r.rows[0]?.data ?? null; },
    async getMany(coll, ids) {
      const u = [...new Set(ids.filter(Boolean).map(String))]; if (!u.length) return new Map();
      const r = await q(`SELECT data FROM ${checkColl(coll)} WHERE id = ANY($1::text[])`, [u]);
      return new Map(r.rows.map(x => [x.data.id, x.data]));
    },
    async find(coll, filter = {}, { sort, limit, offset } = {}) {
      const params = [], where = compile(filter, params);
      let sql = `SELECT data FROM ${checkColl(coll)} WHERE ${where}${orderBy(sort)}`;
      if (limit) sql += ` LIMIT ${Math.max(1, Math.min(10000, limit | 0))}`;
      if (offset) sql += ` OFFSET ${Math.max(0, offset | 0)}`;
      return rows(await q(sql, params));
    },
    async one(coll, filter, opts = {}) { return (await repo.find(coll, filter, { ...opts, limit: 1 }))[0] ?? null; },
    async count(coll, filter = {}) { const params = []; const r = await q(`SELECT count(*)::int AS n FROM ${checkColl(coll)} WHERE ${compile(filter, params)}`, params); return r.rows[0].n; },
    async sum(coll, filter, fields) {
      const params = [], where = compile(filter, params);
      const sel = fields.map((f, i) => `COALESCE(sum(${N(checkField(f))}), 0)::float8 AS s${i}`).join(', ');
      const r = await q(`SELECT count(*)::int AS n, ${sel} FROM ${checkColl(coll)} WHERE ${where}`, params);
      const out = { n: r.rows[0].n }; fields.forEach((f, i) => { out[f] = Math.round(r.rows[0]['s' + i] * 100) / 100; }); return out;
    },
    async insert(coll, doc) {
      const d = { ...doc }; if (!d.id) d.id = newId(); d.id = String(d.id);
      const r = await q(`INSERT INTO ${checkColl(coll)} (id, data) VALUES ($1, $2::jsonb) RETURNING data`, [d.id, JSON.stringify(d)]);
      return r.rows[0].data;
    },
    async insertMany(coll, docs, { upsert = false } = {}) {
      for (let i = 0; i < docs.length; i += 500) {
        const chunk = docs.slice(i, i + 500).map(d => ({ ...d, id: String(d.id || newId()) }));
        await q(`INSERT INTO ${checkColl(coll)} (id, data) SELECT x->>'id', x FROM jsonb_array_elements($1::jsonb) AS x ${upsert ? 'ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()' : 'ON CONFLICT (id) DO NOTHING'}`, [JSON.stringify(chunk)]);
      }
    },
    // patch object = shallow merge done by the database (safe under concurrency); function = read-modify-write in a transaction
    async update(coll, id, patch, opts = {}) {
      if (typeof patch === 'function') {
        if (!inTx) return withTx(conn, actor, t => t.update(coll, id, patch, opts));
        const r = await q(`SELECT data FROM ${checkColl(coll)} WHERE id = $1 FOR UPDATE`, [String(id)]);
        const cur = r.rows[0]?.data; if (!cur) return null;
        const next = { ...patch(structuredClone(cur)), id: cur.id };
        await keep(coll, cur, 'update', opts.by);
        const w = await q(`UPDATE ${checkColl(coll)} SET data = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING data`, [cur.id, JSON.stringify(next)]);
        return w.rows[0]?.data ?? null;
      }
      return repo.updateIf(coll, id, {}, patch, opts);
    },
    // atomic conditional update: only applies when the filter still matches (e.g. "rider is still unassigned")
    async updateIf(coll, id, filter, patch, opts = {}) {
      const params = [String(id), JSON.stringify(clean(patch))], where = compile(filter, params);
      const tracked = TRACKED.has(coll);
      const sql = tracked
        ? `WITH old AS (SELECT data FROM ${checkColl(coll)} WHERE id = $1 AND ${where} FOR UPDATE),
             upd AS (UPDATE ${checkColl(coll)} t SET data = t.data || $2::jsonb, updated_at = now() FROM old WHERE t.id = $1 RETURNING t.data),
             h AS (INSERT INTO history (coll, doc_id, op, data, by, at) SELECT '${coll}', $1, 'update', old.data, $${params.length + 1}::text, $${params.length + 2}::bigint FROM old WHERE EXISTS (SELECT 1 FROM upd))
           SELECT data FROM upd`
        : `UPDATE ${checkColl(coll)} SET data = data || $2::jsonb, updated_at = now() WHERE id = $1 AND ${where} RETURNING data`;
      if (tracked) params.push(opts.by || actor || null, Date.now());
      const r = await q(sql, params);
      return r.rows[0]?.data ?? null;
    },
    // atomic numeric change with a floor, e.g. stock - 2 only if stock stays >= 0. Returns null when it would go below.
    async incr(coll, id, field, delta, { min = null, by } = {}) {
      const f = checkField(field), cond = min == null ? '' : ` AND COALESCE(${N(f)}, 0) + $2 >= ${Number(min)}`;
      const r = await q(`UPDATE ${checkColl(coll)} SET data = jsonb_set(data, '{${f}}', to_jsonb(round((COALESCE(${N(f)}, 0) + $2)::numeric, 2))), updated_at = now() WHERE id = $1${cond} RETURNING data`, [String(id), delta]);
      return r.rows[0]?.data ?? null;
    },
    async remove(coll, id, opts = {}) {
      const r = await q(`DELETE FROM ${checkColl(coll)} WHERE id = $1 RETURNING data`, [String(id)]);
      const old = r.rows[0]?.data; if (old) await keep(coll, old, 'delete', opts.by);
      return old ?? null;
    },
    async removeWhere(coll, filter) { const params = []; const r = await q(`DELETE FROM ${checkColl(coll)} WHERE ${compile(filter, params)}`, params); return r.rowCount ?? r.affectedRows ?? 0; },
    tx: fn => (inTx ? fn(repo) : withTx(conn, actor, fn)),
    as: who => makeRepo(conn, { inTx, actor: who }),
  };
  async function keep(coll, data, op, by) {
    if (!TRACKED.has(coll)) return;
    await q(`INSERT INTO history (coll, doc_id, op, data, by, at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`, [coll, data.id, op, JSON.stringify(data), by || actor || null, Date.now()]);
  }
  return repo;
}
function withTx(conn, actor, fn) { return conn.tx(t => fn(makeRepo(t, { inTx: true, actor }))); }
// JSON.stringify drops undefined; keep explicit nulls
const clean = o => JSON.parse(JSON.stringify(o ?? {}));
