// Live events across every server and worker, using PostgreSQL LISTEN/NOTIFY (no Redis needed).
// Each process keeps its own SSE clients and receives every event, then delivers only what each client may see.
import { log } from '../log.js';

export function makeBus(conn) {
  const handlers = [], cacheHandlers = [];
  return {
    async start() {
      await conn.listen('zipi_events', payload => { try { const ev = JSON.parse(payload); for (const h of handlers) h(ev); } catch (err) { log.error('bad event', { err }); } });
      await conn.listen('zipi_cache', () => { for (const h of cacheHandlers) h(); });
    },
    emit(ev) {
      let s = JSON.stringify(ev);
      if (s.length > 7800) s = JSON.stringify({ ...ev, users: (ev.users || []).slice(0, 200), orders: (ev.orders || []).slice(0, 50) });
      conn.notify('zipi_events', s).catch(err => log.error('emit failed', { err }));
    },
    on: h => handlers.push(h),
    onCache: h => cacheHandlers.push(h),
    cacheChanged: () => conn.notify('zipi_cache', '1').catch(() => {}),
  };
}
