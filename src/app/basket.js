// Multi-shop baskets: decide how many delivery partners an order from several shops needs, and which shops each one visits.
//
// For every way of grouping the shops into rider trips (set partitions; at most 6 shops per basket, so at most 203 groupings,
// all checked exactly) and every pickup order within a trip, we simulate the trip: the rider starts at the first shop when its
// packing is ready, rides to the next shop (waiting if it is not ready yet), then to the customer.
// A trip is allowed only if one rider can carry it (weight and item count) and visits at most 3 shops.
// Choice: the plan whose LAST parcel arrives soonest (minimax, like the p-center objective); among plans within SLACK minutes
// of that, the one with the fewest riders; then the shortest total distance.

export const BASKET = { MAX_SHOPS: 6, MAX_STOPS: 3, MAX_KG: 15, MAX_ITEMS: 40, CYCLE_MAX_KG: 8, SLACK_MIN: 8, MIN_PER_KM: 3.5, STOP_MIN: 2, REACH_MIN: 5 };

// rough weight of one unit of an item from its pack size, e.g. "5 kg", "500 ml", "4 x 75 g", "12 pcs", "1 dozen"
export function unitKg(item) {
  const u = String(item.unit || '').toLowerCase().replace(/,/g, '.');
  let m = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|l|ltr|litre|ml)\b/.exec(u);
  if (m) return +m[1] * toKg(+m[2], m[3]);
  m = /(\d+(?:\.\d+)?)\s*(kg|g|gm|l|ltr|litre|ml)\b/.exec(u);
  if (m) return toKg(+m[1], m[2]);
  m = /(\d+)\s*(pcs?|pieces?|tablets|sheets|eggs)\b/.exec(u);
  if (m) return Math.min(3, +m[1] * (m[2].startsWith('sheet') ? 0.005 : m[2].startsWith('tablet') ? 0.002 : 0.06));
  if (/dozen/.test(u)) return 1.2;
  return item.vendorType === 'restaurant' ? 0.6 : 0.4;
}
const toKg = (n, unit) => (unit === 'kg' || unit === 'l' || unit === 'ltr' || unit === 'litre' ? n : n / 1000);

function partitions(arr) {
  if (!arr.length) return [[]];
  const [first, ...rest] = arr, out = [];
  for (const p of partitions(rest)) {
    for (let i = 0; i < p.length; i++) out.push([...p.slice(0, i), [first, ...p[i]], ...p.slice(i + 1)]);
    out.push([[first], ...p]);
  }
  return out;
}
function permutations(a) { return a.length < 2 ? [a] : a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])); }

/**
 * shops: [{ id, name, ll:{lat,lng}, prepMins, kg, items }]   drop: {lat,lng}   km(a,b): road distance estimate
 * returns { legs: [{ shopIds (visit order), km, mins, kg, items, reason }], riders, etaMins, alternatives }
 */
export function planBasket(shops, drop, km) {
  const B = BASKET, byId = new Map(shops.map(s => [s.id, s]));
  // best visiting order for one trip, with its simulated finish time
  const tripCache = new Map();
  function bestTrip(ids) {
    const key = [...ids].sort().join('|'); if (tripCache.has(key)) return tripCache.get(key);
    const kg = ids.reduce((a, id) => a + byId.get(id).kg, 0), items = ids.reduce((a, id) => a + byId.get(id).items, 0);
    let best = null;
    if (ids.length <= B.MAX_STOPS && kg <= B.MAX_KG && items <= B.MAX_ITEMS) {
      for (const order of permutations(ids)) {
        const s0 = byId.get(order[0]); let t = Math.max(B.REACH_MIN, s0.prepMins), dist = 0, at = s0.ll;
        for (const id of order.slice(1)) { const s = byId.get(id), d = km(at, s.ll); dist += d; t = Math.max(t + d * B.MIN_PER_KM + B.STOP_MIN, s.prepMins); at = s.ll; }
        const last = km(at, drop); dist += last; t += last * B.MIN_PER_KM + B.STOP_MIN;
        if (!best || t < best.mins - 1e-9 || (Math.abs(t - best.mins) < 1e-9 && dist < best.km)) best = { shopIds: order, km: dist, mins: t, kg, items };
      }
    }
    tripCache.set(key, best); return best;
  }
  const plans = [];
  for (const part of partitions(shops.map(s => s.id))) {
    const legs = part.map(bestTrip); if (legs.some(l => !l)) continue;
    plans.push({ legs, worst: Math.max(...legs.map(l => l.mins)), riders: legs.length, km: legs.reduce((a, l) => a + l.km, 0) });
  }
  // every shop alone always fits unless one shop's order is itself too heavy: then it still goes, flagged for a large vehicle
  if (!plans.length) { const legs = shops.map(s => ({ ...(bestTrip([s.id]) || { shopIds: [s.id], km: km(s.ll, drop), mins: Math.max(B.REACH_MIN, s.prepMins) + km(s.ll, drop) * B.MIN_PER_KM + B.STOP_MIN, kg: s.kg, items: s.items, heavy: true }) })); plans.push({ legs, worst: Math.max(...legs.map(l => l.mins)), riders: legs.length, km: legs.reduce((a, l) => a + l.km, 0) }); }
  const fastest = Math.min(...plans.map(p => p.worst));
  const ok = plans.filter(p => p.worst <= fastest + B.SLACK_MIN).sort((a, b) => a.riders - b.riders || a.worst - b.worst || a.km - b.km);
  const pick = ok[0], oneRider = plans.filter(p => p.riders === 1).sort((a, b) => a.worst - b.worst)[0];
  // plain-language reason for the decision, shown to the customer and staff
  for (const leg of pick.legs) {
    const names = leg.shopIds.map(id => byId.get(id).name);
    leg.reason = leg.shopIds.length > 1 ? `One delivery partner picks up from ${names.join(', then ')}` : `${names[0]} is delivered on its own`;
  }
  let why = pick.riders === 1 ? (shops.length > 1 ? 'The shops are close together and everything fits in one bag, so one delivery partner collects it all.' : '')
    : !oneRider ? `${Math.round(shops.reduce((a, s) => a + s.kg, 0))} kg / ${shops.reduce((a, s) => a + s.items, 0)} items is more than one delivery partner can carry or the order covers too many shops, so it is split.`
    : `Using ${pick.riders} delivery partners brings everything about ${Math.round(oneRider.worst - pick.worst)} minutes sooner than one partner visiting every shop.`;
  return { legs: pick.legs.map(l => ({ ...l, km: Math.round(l.km * 10) / 10, mins: Math.round(l.mins), kg: Math.round(l.kg * 10) / 10 })), riders: pick.riders, etaMins: Math.round(pick.worst), why,
    oneRiderMins: oneRider ? Math.round(oneRider.worst) : null };
}
