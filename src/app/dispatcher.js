// Zone dispatcher: plugs the p-center methods (dispatch.js) into live operations.
//  - dispatchZone: all waiting orders in a zone are matched to all free online riders at once, minimising the worst pickup
//    distance (then how many orders are at that distance, then total km). Runs when a shop accepts and every 15 s.
//  - stagingPlan: p-center over the zone's open shops with p = free riders, so every shop has a rider as close as possible;
//    each free rider gets a suggested waiting spot.
//  - coveragePlan: radius for p = 1, 2, 3… riders, so managers can see how many riders keep every shop within X km.
import { solvePCenter, solveAssignment } from './dispatch.js';
import { ACTIVE, r1 } from './context.js';
import { log } from '../log.js';

const UNIT_KM = 0.1;               // distances are integers in 100 m units, like the report's integer radii
const MAX_PICKUP_KM = 15;
const toUnits = km => Math.max(0, Math.ceil(km / UNIT_KM));

export function makeDispatcher(c) {
  const { db, maps } = c;
  const roadKm = (a, b) => maps.haversineKm(a, b) * 1.3; // road estimate; fast enough to build matrices
  const running = new Map(); // zone -> promise (one dispatch per zone at a time in this process)

  async function freeRiders(zoneId) {
    const online = await db.find('riders', { zoneId, status: 'approved', online: true }, { limit: 2000 });
    if (!online.length) return [];
    const busy = new Set((await db.q(`SELECT DISTINCT data->>'riderId' AS r FROM orders WHERE data->>'riderId' = ANY($1::text[]) AND data->>'status' = ANY($2::text[])`, [online.map(r => r.id), ACTIVE])).rows.map(x => x.r));
    return online.filter(r => !busy.has(r.id));
  }

  async function runDispatch(zoneId) {
    if (!(await c.S()).autoAssign) return [];
    const waiting = await db.find('orders', { zoneId, status: { $in: ['accepted', 'ready'] }, riderId: null }, { sort: 'createdAt', limit: 300 });
    if (!waiting.length) return [];
    // jobs: a single order, or one rider trip of a multi-shop basket (all its shop orders go to the same rider)
    const groupIds = [...new Set(waiting.filter(o => o.legId).map(o => o.groupId))];
    const siblings = groupIds.length ? await db.find('orders', { groupId: { $in: groupIds } }, { limit: 3000 }) : [];
    const jobs = [], seenLeg = new Set(), follow = [];
    for (const o of waiting) {
      if (!o.legId) { jobs.push({ orders: [o], first: o, kg: 0, at: o.acceptedAt || o.createdAt }); continue; }
      if (seenLeg.has(o.legId)) continue; seenLeg.add(o.legId);
      const leg = siblings.filter(x => x.legId === o.legId);
      if (leg.some(x => x.status === 'placed' || x.status === 'scheduled')) continue; // wait until every shop in the trip has accepted
      const active = leg.filter(x => ['accepted', 'ready'].includes(x.status) && !x.riderId);
      const taken = leg.find(x => x.riderId && ['accepted', 'ready', 'picked'].includes(x.status));
      if (taken) { follow.push({ orders: active, riderId: taken.riderId }); continue; } // rest of a trip already given to a rider
      const order = o.legStops || active.map(x => x.vendorId), first = order.map(id => active.find(x => x.vendorId === id)).find(Boolean) || active[0];
      jobs.push({ orders: active, first, kg: o.legKg || 0, at: Math.min(...active.map(x => x.acceptedAt || x.createdAt)) });
    }
    const done = [];
    const assign = async (job, rd, km) => {
      try {
        const res = await db.tx(async tx => {
          const out = [];
          for (const ord of job.orders) {
            const multi = job.orders.length > 1 ? ` (picks up from ${job.orders.length} shops)` : '';
            const timeline = [...(ord.timeline || []), { status: 'rider', at: Date.now(), note: `${rd.name} assigned by ZIPI dispatch, about ${km} km from the first shop${multi}` }];
            const n = await tx.updateIf('orders', ord.id, { riderId: null, status: { $in: ['accepted', 'ready'] } }, { riderId: rd.id, claimedAt: Date.now(), autoAssigned: true, dispatchKm: km, timeline });
            if (!n) throw new Error('changed'); out.push(n);
          }
          return out;
        });
        for (const n of res) { done.push(n); c.emitOrder(n).catch(() => {}); }
        c.bus.emit({ type: 'order', id: res[0].id, zoneId, users: [rd.userId], ridersZone: true });
        return true;
      } catch { return false; } // someone else took part of it meanwhile; next run will retry
    };
    for (const f of follow) { const rd = await db.get('riders', f.riderId); if (rd) await assign({ orders: f.orders }, rd, 0); }
    if (!jobs.length) return done;
    const riders = await freeRiders(zoneId); if (!riders.length) return done;
    const shops = await db.getMany('vendors', jobs.map(j => j.first.vendorId));
    const m = jobs.length, k = riders.length, cost = new Float64Array(m * k), rll = riders.map(r => c.riderLL(r));
    for (let o = 0; o < m; o++) {
      const v = shops.get(jobs[o].first.vendorId), vll = v ? c.vendorLL(v) : c.center(zoneId), declined = new Set(jobs[o].orders.flatMap(x => x.declinedBy || []));
      for (let r = 0; r < k; r++) {
        const km = roadKm(rll[r], vll), tooHeavy = riders[r].vehicle === 'cycle' && jobs[o].kg > 8;
        cost[o * k + r] = declined.has(riders[r].id) || km > MAX_PICKUP_KM || tooHeavy ? 1e9 : toUnits(km);
      }
    }
    const res = solveAssignment(cost, m, k, { timeMs: m > 20 || k > 50 ? 80 : 40, priority: jobs.map(j => j.at) });
    for (let o = 0; o < m; o++) {
      const ri = res.assign[o]; if (ri < 0) continue;
      const rd = riders[ri];
      if (await db.count('orders', { riderId: rd.id, status: { $in: ACTIVE } })) continue; // rider became busy
      await assign(jobs[o], rd, r1(cost[o * k + ri] * UNIT_KM));
    }
    if (done.length) log.info('dispatch', { zone: zoneId, jobs: m, riders: k, assigned: done.length, worstKm: res.worst != null ? r1(res.worst * UNIT_KM) : null, ms: res.ms });
    return done;
  }
  c.dispatchZone = zoneId => {
    if (running.has(zoneId)) return running.get(zoneId).then(() => runDispatch(zoneId));
    const p = runDispatch(zoneId).catch(err => { log.error('dispatch failed', { err, zone: zoneId }); return []; }).finally(() => running.delete(zoneId));
    running.set(zoneId, p); return p;
  };
  // compatible with the old one-order call: dispatch the zone, return this order if it got a rider
  c.autoAssign = async o => {
    if (!o || o.riderId || !['accepted', 'ready'].includes(o.status)) return null;
    const done = await c.dispatchZone(o.zoneId);
    return done.find(x => x.id === o.id) || null;
  };

  /* ---------- p-center over shops: where riders should wait, and how many riders a zone needs ---------- */
  async function shopGraph(zoneId) {
    const shops = (await db.find('vendors', { zoneId, status: 'approved' }, { limit: 600 })).filter(v => c.isOpen(v));
    const pts = shops.map(v => c.vendorLL(v)), n = pts.length, D = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = toUnits(roadKm(pts[i], pts[j])); D[i * n + j] = d; D[j * n + i] = d; }
    return { shops, pts, n, D };
  }
  const cache = new Map();
  c.stagingPlan = async (zoneId, { fresh = false } = {}) => {
    const hit = cache.get(zoneId); if (!fresh && hit && Date.now() - hit.at < 120000) return hit.plan;
    const [g, riders] = await Promise.all([shopGraph(zoneId), freeRiders(zoneId)]);
    let plan = { zoneId, at: Date.now(), radiusKm: null, spots: [], riders: riders.length, shops: g.n };
    if (g.n && riders.length) {
      const p = Math.min(riders.length, g.n), r = solvePCenter(g.D, g.n, p, { timeMs: g.n > 200 ? 300 : 150 });
      const centres = r.centres, cost = new Float64Array(riders.length * centres.length), rll = riders.map(x => c.riderLL(x));
      // which free rider goes to which spot: minimise the farthest anyone has to ride
      for (let a = 0; a < riders.length; a++) for (let b = 0; b < centres.length; b++) cost[a * centres.length + b] = toUnits(roadKm(rll[a], g.pts[centres[b]]));
      const as = solveAssignment(cost, riders.length, centres.length, { timeMs: 30 });
      plan = { ...plan, radiusKm: r1(r.radius * UNIT_KM), critical: r.critical,
        spots: centres.map((ci, b) => { const ai = [...as.assign].indexOf(b); const rd = ai >= 0 ? riders[ai] : null;
          return { shopId: g.shops[ci].id, name: g.shops[ci].name, ll: g.pts[ci], riderId: rd?.id || null, riderName: rd?.name || null, riderKm: rd ? r1(cost[ai * centres.length + b] * UNIT_KM) : null }; }) };
    }
    cache.set(zoneId, { at: Date.now(), plan });
    return plan;
  };
  c.coveragePlan = async (zoneId, maxP = 15) => {
    const g = await shopGraph(zoneId); if (!g.n) return { shops: 0, rows: [] };
    const rows = [];
    for (let p = 1; p <= Math.min(maxP, g.n); p++) { const r = solvePCenter(g.D, g.n, p, { timeMs: 80, seed: p }); rows.push({ riders: p, radiusKm: r1(r.radius * UNIT_KM) }); if (r.radius === 0) break; }
    return { shops: g.n, rows };
  };
}
