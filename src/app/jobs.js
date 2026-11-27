// Background jobs. Every server runs the timer, but a PostgreSQL advisory lock makes sure only one runs each job at a time,
// so adding servers never double-cancels or double-assigns.
import { log } from '../log.js';
import { config } from '../config.js';
import { backupAll } from '../services/backup.js';

const LOCK_SWEEP = 715001, LOCK_DAILY = 715002;

export function makeJobs(c) {
  const { db } = c;
  async function withLock(key, fn) {
    if (!config.databaseUrl) { await fn(); return true; } // embedded database = one process, nothing to coordinate
    // the lock must be taken and released on the same connection, so run inside a transaction (xact lock frees itself)
    return db.tx(async tx => { const ok = (await tx.q('SELECT pg_try_advisory_xact_lock($1) AS ok', [key])).rows[0].ok; if (!ok) return false; await fn(); return true; });
  }
  async function sweep() {
    const s = await c.S(), t = Date.now(), mins = s.acceptMins || 5;
    // scheduled orders go to the shop in time to arrive at the chosen slot
    for (const o of await db.find('orders', { status: 'scheduled', releaseAt: { $lte: t } }, { limit: 500 }))
      await c.setStatus(o, 'placed', { placedAt: t, note: 'Sent to the shop' }, { from: ['scheduled'] });
    // shops that did not respond: cancel, return stock and coins, refund prepaid
    for (const o of await db.find('orders', { status: 'placed', $or: [{ placedAt: { $lt: t - mins * 60000 } }, { placedAt: null, createdAt: { $lt: t - mins * 60000 } }] }, { limit: 500 })) {
      const v = await db.get('vendors', o.vendorId);
      const n = await db.tx(async tx => {
        const r = await c.setStatus(o, 'cancelled', { cancelReason: 'Shop did not respond in time', note: `${v?.name || 'The shop'} did not respond in ${mins} min. ${o.payment === 'UPI' ? 'Full refund started.' : 'Nothing to pay.'}`, refund: o.payment === 'UPI' ? o.total : 0 }, { from: ['placed'], t: tx });
        if (r) await c.refundOrder(o, { t: tx }); return r;
      });
      if (n) c.emitOrder(n).catch(() => {});
    }
    // orders waiting for a rider: re-run zone dispatch (matches all waiting orders to all free riders at once)
    const zones = (await db.q(`SELECT DISTINCT data->>'zoneId' AS z FROM orders WHERE data->>'status' IN ('accepted','ready') AND (data->'riderId' IS NULL OR data->'riderId' = 'null'::jsonb)`)).rows.map(r => r.z);
    for (const z of zones) await c.dispatchZone(z);
    // riders who stopped sending GPS for 30 min while online and have nothing to deliver are set offline
    await db.q(`UPDATE riders SET data = data || '{"online": false}'::jsonb WHERE COALESCE((data->>'online')::boolean,false) AND (data->'pos'->>'at')::numeric < $1
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.data->>'riderId' = riders.id AND o.data->>'status' IN ('accepted','ready','picked'))`, [t - 30 * 60000]);
    await db.q(`INSERT INTO meta (k, v) VALUES ('jobs:last', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, at = now()`, [JSON.stringify({ at: t, pid: process.pid })]);
  }
  async function daily() {
    const t = Date.now(), DAY = 86400000;
    await db.q(`DELETE FROM history WHERE at < $1`, [t - config.historyDays * DAY]);
    await db.q(`DELETE FROM events WHERE (data->>'at')::numeric < $1`, [t - config.eventDays * DAY]);
    await db.q(`DELETE FROM logins WHERE (data->>'at')::numeric < $1`, [t - 180 * DAY]);
    await db.q(`DELETE FROM otps WHERE (data->>'exp')::numeric < $1`, [t - DAY]);
    await db.q(`DELETE FROM ratelimit WHERE reset_at < $1`, [t - DAY]);
    await db.q(`DELETE FROM idem WHERE at < $1`, [t - 2 * DAY]);
    await db.q(`DELETE FROM geo_cache WHERE at < $1`, [t - 120 * DAY]);
    if (!config.databaseUrl || process.env.APP_BACKUPS === '1') await backupAll(db).catch(err => log.error('daily backup failed', { err }));
  }
  let timers = [];
  return {
    sweep,
    start() {
      const tick = () => withLock(LOCK_SWEEP, sweep).catch(err => log.error('sweep failed', { err }));
      const dayTick = async () => { try { const last = (await db.q(`SELECT v FROM meta WHERE k = 'jobs:daily'`)).rows[0]?.v?.at || 0; if (Date.now() - last < 20 * 3600000) return;
        if (await withLock(LOCK_DAILY, daily)) await db.q(`INSERT INTO meta (k, v) VALUES ('jobs:daily', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [JSON.stringify({ at: Date.now() })]); } catch (err) { log.error('daily job failed', { err }); } };
      timers = [setInterval(tick, 15000), setInterval(dayTick, 3600000), setTimeout(dayTick, 20000)];
      for (const t of timers) t.unref?.();
      tick();
    },
    stop() { for (const t of timers) clearInterval(t); },
  };
}
