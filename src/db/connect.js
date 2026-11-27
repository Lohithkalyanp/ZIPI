// Database connection. Production: PostgreSQL through a connection pool (DATABASE_URL).
// Development: embedded PostgreSQL (PGlite) stored in DATA_DIR/pglite, so nothing needs installing.
// Both expose the same small interface: query, tx, listen, notify, close.
import path from 'node:path';
import { log } from '../log.js';

export async function connect(cfg) {
  if (cfg.databaseUrl) return connectPostgres(cfg);
  return connectEmbedded(cfg);
}

async function connectPostgres(cfg) {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, v => Number(v));   // bigint (counts, sums) as numbers
  pg.types.setTypeParser(1700, v => Number(v)); // numeric as numbers
  const opts = { connectionString: cfg.databaseUrl, ssl: cfg.dbSsl ? { rejectUnauthorized: false } : undefined };
  const pool = new pg.Pool({ ...opts, max: cfg.dbPool, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 20000, application_name: 'zipi' });
  pool.on('error', err => log.error('database pool error', { err }));
  await pool.query('select 1');
  const listeners = [];
  let listenClient = null, stopped = false;
  async function startListener() {
    if (stopped || !listeners.length) return;
    const c = new pg.Client({ ...opts, application_name: 'zipi-listen' });
    c.on('notification', m => { for (const l of listeners) if (l.channel === m.channel) try { l.cb(m.payload); } catch (err) { log.error('listener failed', { err }); } });
    c.on('error', err => { log.warn('listen connection lost, reconnecting', { err: err.message }); listenClient = null; setTimeout(startListener, 2000); });
    try {
      await c.connect();
      for (const ch of new Set(listeners.map(l => l.channel))) await c.query(`LISTEN "${ch}"`);
      listenClient = c;
    } catch (err) { log.warn('listen connect failed, retrying', { err: err.message }); setTimeout(startListener, 3000); }
  }
  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const r = await fn({ query: (t, p) => c.query(t, p) }); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
    async listen(channel, cb) { listeners.push({ channel, cb }); if (listenClient) await listenClient.query(`LISTEN "${channel}"`); else await startListener(); },
    notify: (channel, payload) => pool.query('select pg_notify($1, $2)', [channel, payload]),
    stats: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }),
    async close() { stopped = true; await listenClient?.end().catch(() => {}); await pool.end(); },
  };
}

async function connectEmbedded(cfg) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const dir = path.join(cfg.dataDir, 'pglite');
  const db = await PGlite.create(dir, { extensions: { pg_trgm }, parsers: { 20: v => Number(v), 1700: v => Number(v) } });
  log.info('using embedded PostgreSQL (development). Set DATABASE_URL for production.', { dir });
  return {
    kind: 'embedded',
    query: (text, params) => db.query(text, params),
    tx: fn => db.transaction(t => fn({ query: (a, b) => t.query(a, b) })),
    listen: async (channel, cb) => { await db.listen(channel, cb); },
    notify: (channel, payload) => db.query('select pg_notify($1, $2)', [channel, payload]),
    stats: () => ({ total: 1, idle: 1, waiting: 0 }),
    dump: () => db.dumpDataDir('gzip'),
    close: () => db.close(),
  };
}
