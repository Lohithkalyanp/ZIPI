// Dispatch optimisation based on "Binary GA with p-Center Refinement" (T. Pratyusha, SRM University–AP, 2026).
//
// 1. solvePCenter: the vertex p-center problem. Choose p of n vertices as centres so the largest distance from any vertex to its
//    nearest centre (the radius f) is as small as possible. Used for rider positioning: shops are the vertices, free riders are
//    the p centres, so every shop has a rider close by. Also answers "how many riders do we need for every shop within X km?".
//    Stage 1: binary GA (population 50 = 49 random + 1 greedy farthest-point, tournament 3, uniform crossover 0.9, repair to
//    exactly p ones (50/50 farthest uncovered / random), swap mutation 1/p, 2 elites, duplicate removal, swap local search on the
//    best chromosome every 10 generations). Stage 2: B_h-pC refinement (flat moves, tabu list with growing tenure, restarts).
//    Fitness h = n·f + nC, where nC is the number of critical vertices (at distance f). Time split 30% / 70%.
//
// 2. solveAssignment: the same minimax idea for matching waiting orders to free riders. Minimise the worst pickup distance f,
//    then the number of orders at that distance nC (h = m·f + nC), then the total distance. Same two stages: a GA over
//    assignments followed by a tabu refinement with flat moves and restarts.
//
// Distances are integers (units of 100 m), as in the report where radii are integer distance-matrix values.

const INF = 1e9;

/* small fast seeded random generator so runs are reproducible when a seed is given */
function rng(seed = Date.now()) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/* ======================================================================================
   p-center
   D: Int32Array/Float64Array of n*n integer distances (symmetric, 0 diagonal)
   ====================================================================================== */
export function solvePCenter(D, n, p, { timeMs = 300, seed, gaShare = 0.3 } = {}) {
  p = Math.max(1, Math.min(p, n));
  const rand = rng(seed), ri = k => Math.floor(rand() * k);
  if (p === n) { const all = Array.from({ length: n }, (_, i) => i); return { centres: all, radius: 0, critical: 0, gaRadius: 0, generations: 0, iterations: 0 }; }
  const t0 = Date.now(), gaEnd = t0 + timeMs * gaShare, end = t0 + timeMs;

  // fitness of a centre list: radius f, critical count nC, h = n·f + nC
  function evaluate(S) {
    let f = -1, nC = 0;
    for (let i = 0; i < n; i++) {
      let m = INF; const row = i * n;
      for (let k = 0; k < S.length; k++) { const d = D[row + S[k]]; if (d < m) m = d; }
      if (m > f) { f = m; nC = 1; } else if (m === f) nC++;
    }
    return { f, nC, h: n * f + nC };
  }
  const toList = x => { const S = []; for (let v = 0; v < n; v++) if (x[v]) S.push(v); return S; };
  const keyOf = x => toList(x).join(',');
  // nearest-centre distance for every vertex given a list of centres
  const serviceDist = S => { const sd = new Float64Array(n); for (let i = 0; i < n; i++) { let m = INF; for (const c of S) { const d = D[i * n + c]; if (d < m) m = d; } sd[i] = m; } return sd; };

  /* Algorithm 2: greedy farthest-point chromosome */
  function greedy() {
    const x = new Uint8Array(n), S = [ri(n)]; x[S[0]] = 1;
    const sd = new Float64Array(n); for (let i = 0; i < n; i++) sd[i] = D[i * n + S[0]];
    while (S.length < p) { let v = 0; for (let i = 1; i < n; i++) if (sd[i] > sd[v]) v = i; x[v] = 1; S.push(v); for (let i = 0; i < n; i++) { const d = D[i * n + v]; if (d < sd[i]) sd[i] = d; } }
    return x;
  }
  function randomChrom() { const x = new Uint8Array(n); let k = 0; while (k < p) { const v = ri(n); if (!x[v]) { x[v] = 1; k++; } } return x; }

  /* Algorithm 3: repair to exactly p centres */
  function repair(x) {
    let ones = []; for (let v = 0; v < n; v++) if (x[v]) ones.push(v);
    while (ones.length > p) { const k = ri(ones.length); x[ones[k]] = 0; ones[k] = ones[ones.length - 1]; ones.pop(); }
    while (ones.length < p) {
      let v;
      if (rand() < 0.5 && ones.length) { const sd = serviceDist(ones); v = 0; for (let i = 1; i < n; i++) if (sd[i] > sd[v]) v = i; if (x[v]) v = -1; }
      if (v === undefined || v < 0) { do { v = ri(n); } while (x[v]); }
      x[v] = 1; ones.push(v);
    }
    return x;
  }
  /* swap mutation, probability 1/p per centre */
  function mutate(x, force = false) {
    const S = toList(x); let changed = false;
    for (const c of S) if (force ? !changed : rand() < 1 / p) { let z; do { z = ri(n); } while (x[z]); x[c] = 0; x[z] = 1; changed = true; }
    if (force && !changed) { const c = S[ri(S.length)]; let z; do { z = ri(n); } while (x[z]); x[c] = 0; x[z] = 1; }
    return x;
  }

  /* nearest and second-nearest centre of every vertex: lets one candidate opening be scored against all p closings in O(n + p) */
  function nearest(S) {
    const d1 = new Float64Array(n), d2 = new Float64Array(n), c1 = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let a = INF, b = INF, ca = -1; const row = i * n;
      for (const c of S) { const d = D[row + c]; if (d < a) { b = a; a = d; ca = c; } else if (d < b) b = d; }
      d1[i] = a; d2[i] = b; c1[i] = ca;
    }
    return { d1, d2, c1 };
  }
  // score all moves "open u, close j" (j in S): returns arrays f[j], nC[j]
  function scoreOpen(S, u, near) {
    const p_ = S.length, idx = new Map(S.map((c, k) => [c, k]));
    const gA = new Float64Array(p_).fill(-1), gAc = new Int32Array(p_), gB = new Float64Array(p_).fill(-1), gBc = new Int32Array(p_);
    for (let i = 0; i < n; i++) {
      const du = D[i * n + u], g = idx.get(near.c1[i]);
      const a = du < near.d1[i] ? du : near.d1[i];   // value if i's nearest centre stays open
      const b = du < near.d2[i] ? du : near.d2[i];   // value if i's nearest centre is the one closed
      if (a > gA[g]) { gA[g] = a; gAc[g] = 1; } else if (a === gA[g]) gAc[g]++;
      if (b > gB[g]) { gB[g] = b; gBc[g] = 1; } else if (b === gB[g]) gBc[g]++;
    }
    // best and second-best distinct group maxima of a, with total counts
    let v1 = -1, v2 = -1, s1 = 0, s2 = 0, n1 = 0;
    for (let g = 0; g < p_; g++) { const v = gA[g]; if (v > v1) { v2 = v1; s2 = s1; v1 = v; s1 = gAc[g]; n1 = 1; } else if (v === v1) { s1 += gAc[g]; n1++; } else if (v > v2) { v2 = v; s2 = gAc[g]; } else if (v === v2) s2 += gAc[g]; }
    const F = new Float64Array(p_), C = new Int32Array(p_);
    for (let g = 0; g < p_; g++) {
      let ex, exc; // max of a over vertices not served by centre g
      if (gA[g] === v1) { if (n1 > 1) { ex = v1; exc = s1 - gAc[g]; } else { ex = v2; exc = s2; } } else { ex = v1; exc = s1; }
      const f = Math.max(ex, gB[g]); F[g] = f; C[g] = (ex === f ? exc : 0) + (gB[g] === f ? gBc[g] : 0);
    }
    return { F, C };
  }
  const criticals = (S, near, f) => { const out = []; for (let i = 0; i < n; i++) if (near.d1[i] === f) out.push(i); return out; };

  /* Algorithm 4: swap local search (best improving swap until none), candidates near critical vertices only */
  function swapLS(S, deadline) {
    S = S.slice(); let near = nearest(S), cur = evaluate(S);
    for (let it = 0; it < 200 && Date.now() < deadline; it++) {
      const crit = criticals(S, near, cur.f), inS = new Set(S), cand = new Set();
      for (const c of crit) for (let u = 0; u < n; u++) if (!inS.has(u) && D[u * n + c] < cur.f) cand.add(u);
      let best = null;
      for (const u of cand) { const { F, C } = scoreOpen(S, u, near); for (let g = 0; g < S.length; g++) { const h = n * F[g] + C[g]; if (!best || h < best.h) best = { h, g, u, f: F[g], nC: C[g] }; } }
      if (!best || best.h >= cur.h) break;
      S[best.g] = best.u; near = nearest(S); cur = { f: best.f, nC: best.nC, h: best.h };
    }
    return { S, ...cur };
  }

  /* ---------- Stage 1: binary GA ---------- */
  const POP = 50;
  let pop = []; const seen = new Set();
  const add = x => { const k = keyOf(x); seen.add(k); const e = evaluate(toList(x)); pop.push({ x, k, ...e }); };
  add(greedy());
  for (let tries = 0; pop.length < POP && tries < POP * 20; tries++) { const x = randomChrom(), k = keyOf(x); if (!seen.has(k) || tries > POP * 10) add(x); }
  pop.sort((a, b) => a.h - b.h);
  let best = { S: toList(pop[0].x), f: pop[0].f, nC: pop[0].nC, h: pop[0].h }, gen = 0;
  const tour = () => { let w = pop[ri(pop.length)]; for (let k = 1; k < 3; k++) { const c = pop[ri(pop.length)]; if (c.h < w.h) w = c; } return w; };
  while (Date.now() < gaEnd && n > p) {
    gen++;
    const next = pop.slice(0, 2), keys = new Set(next.map(e => e.k));
    while (next.length < Math.min(POP, pop.length)) {
      const a = tour(), b = tour(); let x;
      if (rand() < 0.9) { x = new Uint8Array(n); for (let v = 0; v < n; v++) x[v] = a.x[v] === b.x[v] ? a.x[v] : (rand() < 0.5 ? a.x[v] : b.x[v]); } else x = a.x.slice();
      repair(x); mutate(x);
      let k = keyOf(x), guard = 0; while (keys.has(k) && guard++ < 10) { mutate(x, true); k = keyOf(x); }
      keys.add(k); next.push({ x, k, ...evaluate(toList(x)) });
    }
    pop = next.sort((a, b) => a.h - b.h);
    if (gen % 10 === 0) { // memetic step on the best chromosome
      const r = swapLS(toList(pop[0].x), gaEnd);
      if (r.h < pop[0].h) { const x = new Uint8Array(n); for (const c of r.S) x[c] = 1; pop[0] = { x, k: keyOf(x), f: r.f, nC: r.nC, h: r.h }; }
    }
    if (pop[0].h < best.h) best = { S: toList(pop[0].x), f: pop[0].f, nC: pop[0].nC, h: pop[0].h };
  }
  const gaRadius = best.f;

  /* ---------- Stage 2: B_h-pC refinement (flat moves, growing tabu tenure, restarts from best) ---------- */
  let S = best.S.slice(), near = nearest(S), cur = { f: best.f, nC: best.nC, h: best.h };
  const tabuOpen = new Map(), tabuClose = new Map(); // vertex -> iteration until which the move is forbidden
  let tenure = 1, stall = 0, iter = 0;
  const STALL = Math.max(50, 4 * p);
  while (Date.now() < end && cur.f > 0) {
    iter++;
    const crit = criticals(S, near, cur.f), c = crit[ri(crit.length)], inS = new Set(S);
    let move = null, count = 0;
    for (let u = 0; u < n; u++) {
      if (inS.has(u) || D[u * n + c] >= cur.f) continue;
      const { F, C } = scoreOpen(S, u, near);
      for (let g = 0; g < S.length; g++) {
        const h = n * F[g] + C[g], tabu = (tabuOpen.get(u) || 0) > iter || (tabuClose.get(S[g]) || 0) > iter;
        if (tabu && h >= best.h) continue; // aspiration: tabu allowed only if it beats the best ever
        if (!move || h < move.h) { move = { h, g, u, f: F[g], nC: C[g] }; count = 1; }
        else if (h === move.h && rand() < 1 / ++count) move = { h, g, u, f: F[g], nC: C[g] }; // random tie-break keeps flat walks moving
      }
    }
    if (!move) { tenure = 1; S = best.S.slice(); near = nearest(S); cur = { f: best.f, nC: best.nC, h: best.h }; continue; }
    const closed = S[move.g]; S[move.g] = move.u; near = nearest(S);
    cur = { f: move.f, nC: move.nC, h: move.h };
    // tenure grows while the search is stuck (capped, with a little randomness so the search does not cycle)
    const t = tenure + ri(3); tabuClose.set(move.u, iter + t); tabuOpen.set(closed, iter + t);
    if (cur.h < best.h) { best = { S: S.slice(), ...cur }; stall = 0; tenure = 1; }
    else { stall++; if (stall % 5 === 0) tenure = Math.min(tenure + 1, 10); }
    if (stall > STALL) { S = best.S.slice(); near = nearest(S); cur = { f: best.f, nC: best.nC, h: best.h }; stall = 0; tenure = 1; tabuOpen.clear(); tabuClose.clear(); }
  }
  return { centres: best.S.sort((a, b) => a - b), radius: best.f, critical: best.nC, gaRadius, generations: gen, iterations: iter, ms: Date.now() - t0 };
}

/* ======================================================================================
   minimax assignment of m orders to k riders (each rider at most one order)
   cost[o * k + r]: integer pickup distance, INF when not allowed (rider declined, too far)
   Assigns min(m, k) orders; when there are more orders than riders, `priority` (lower = older = first) decides which wait.
   ====================================================================================== */
export function solveAssignment(cost, m, k, { timeMs = 60, seed, priority = null } = {}) {
  const rand = rng(seed), ri = x => Math.floor(rand() * x);
  if (!m || !k) return { assign: new Int32Array(m).fill(-1), worst: 0, critical: 0, total: 0 };
  // which orders to serve: all if riders suffice, otherwise the k oldest
  let orders = Array.from({ length: m }, (_, i) => i);
  if (m > k) orders = orders.sort((a, b) => (priority ? priority[a] - priority[b] : a - b)).slice(0, k);
  const M = orders.length, t0 = Date.now(), gaEnd = t0 + timeMs * 0.3, end = t0 + timeMs;
  // lower bound (report, future work 5): the exact best possible worst pickup distance, by threshold matching.
  // Pairs above it are forbidden, so the GA and refinement only optimise the tie-breakers (orders at the worst distance, total km).
  const sub = new Float64Array(M * k); for (let i = 0; i < M; i++) for (let r = 0; r < k; r++) sub[i * k + r] = cost[orders[i] * k + r];
  const bm = bottleneckMatch(sub, M, k), bound = bm ? bm.value : null;
  const C = (oi, r) => { const d = sub[oi * k + r]; return bound != null && d > bound ? INF : d; };
  // lexicographic fitness: worst distance, then orders at worst, then total. Unassignable orders count as INF.
  function evaluate(a) { let f = -1, nC = 0, tot = 0; for (let i = 0; i < M; i++) { const d = a[i] < 0 ? INF : C(i, a[i]); tot += d; if (d > f) { f = d; nC = 1; } else if (d === f) nC++; } return { f, nC, tot, h: (M + 1) * f + nC + tot / (M * INF + 1) }; }
  // greedy: hardest order first (whose best option is farthest), take its nearest free rider
  function greedy() {
    const a = new Int32Array(M).fill(-1), used = new Uint8Array(k), left = new Set(Array.from({ length: M }, (_, i) => i));
    while (left.size) {
      let pick = -1, pickBest = -1, pickR = -1;
      for (const i of left) { let bd = INF + 1, br = -1; for (let r = 0; r < k; r++) if (!used[r] && C(i, r) < bd) { bd = C(i, r); br = r; } if (bd > pickBest) { pickBest = bd; pick = i; pickR = br; } }
      if (pickR >= 0 && pickBest < INF) { a[pick] = pickR; used[pickR] = 1; } left.delete(pick);
    }
    return a;
  }
  function randomA() { const a = new Int32Array(M).fill(-1), rs = Array.from({ length: k }, (_, r) => r); for (let i = rs.length - 1; i > 0; i--) { const j = ri(i + 1); [rs[i], rs[j]] = [rs[j], rs[i]]; } for (let i = 0; i < M; i++) a[i] = rs[i]; return a; }
  // repair: unique riders per order; fill gaps with the nearest unused rider
  function repair(a) {
    const used = new Uint8Array(k);
    for (let i = 0; i < M; i++) { if (a[i] >= 0 && !used[a[i]]) used[a[i]] = 1; else a[i] = -1; }
    for (let i = 0; i < M; i++) if (a[i] < 0) { let bd = INF + 1, br = -1; for (let r = 0; r < k; r++) if (!used[r] && C(i, r) < bd) { bd = C(i, r); br = r; } if (br >= 0) { a[i] = br; used[br] = 1; } }
    return a;
  }
  function mutate(a) { // swap the riders of two orders, or move an order to an unused rider
    const i = ri(M);
    if (rand() < 0.5 && M > 1) { const j = ri(M); const t = a[i]; a[i] = a[j]; a[j] = t; }
    else { const used = new Set(a); const free = []; for (let r = 0; r < k; r++) if (!used.has(r)) free.push(r); if (free.length) a[i] = free[ri(free.length)]; }
    return a;
  }
  const POP = Math.min(30, 4 + M * 2);
  // seed with the exact matching at the bound (always feasible, optimal worst distance) plus greedy and random assignments
  let pop = [...(bm ? [bm.assign] : []), greedy(), ...Array.from({ length: POP - 2 }, randomA)].map(a => ({ a, ...evaluate(a) })).sort((x, y) => x.h - y.h);
  let best = { a: pop[0].a.slice(), ...pop[0] };
  const tour = () => { let w = pop[ri(pop.length)]; for (let t = 1; t < 3; t++) { const c = pop[ri(pop.length)]; if (c.h < w.h) w = c; } return w; };
  while (Date.now() < gaEnd && M > 1) {
    const next = pop.slice(0, 2);
    while (next.length < POP) {
      const x = tour(), y = tour(), a = new Int32Array(M);
      for (let i = 0; i < M; i++) a[i] = rand() < 0.9 && rand() < 0.5 ? y.a[i] : x.a[i];
      repair(a); if (rand() < 1 / Math.max(1, M) * 2) mutate(a), repair(a);
      next.push({ a, ...evaluate(a) });
    }
    pop = next.sort((x, y) => x.h - y.h);
    if (pop[0].h < best.h) best = { a: pop[0].a.slice(), ...pop[0] };
  }
  // refinement: best reassign/swap move each step, flat moves allowed, tabu with growing tenure, restart from best
  let a = best.a.slice(), cur = evaluate(a), tenure = 1, stall = 0, iter = 0; const tabu = new Map();
  while (Date.now() < end) {
    iter++;
    let move = null;
    const used = new Map(); for (let i = 0; i < M; i++) if (a[i] >= 0) used.set(a[i], i);
    // focus on critical orders (at the worst distance), as the report focuses on critical vertices
    const crit = []; for (let i = 0; i < M; i++) { const d = a[i] < 0 ? INF : C(i, a[i]); if (d === cur.f) crit.push(i); }
    if (!crit.length) break;
    const i = crit[ri(crit.length)];
    for (let r = 0; r < k; r++) {
      if (r === a[i]) continue;
      const j = used.has(r) ? used.get(r) : -1, b = a.slice(); b[i] = r; if (j >= 0) b[j] = a[i];
      const e = evaluate(b), isTabu = (tabu.get(i + ':' + r) || 0) > iter;
      if (isTabu && e.h >= best.h) continue;
      if (!move || e.h < move.e.h) move = { b, e, r };
    }
    if (!move) break;
    tabu.set(i + ':' + a[i], iter + tenure); a = move.b; cur = move.e;
    if (cur.h < best.h - 1e-12) { best = { a: a.slice(), ...cur }; stall = 0; tenure = 1; } else { stall++; tenure = Math.min(tenure + 1, Math.max(2, M)); }
    if (stall > 30) { a = best.a.slice(); cur = evaluate(a); stall = 0; tenure = 1; tabu.clear(); }
    if (best.f === 0 || (bound != null && best.f <= bound && best.nC === 1 && stall > 10)) break;
  }
  const assign = new Int32Array(m).fill(-1);
  for (let i = 0; i < M; i++) if (best.a[i] >= 0 && C(i, best.a[i]) < INF) assign[orders[i]] = best.a[i];
  return { assign, worst: best.f >= INF ? null : best.f, bound, critical: best.nC, total: best.tot, ms: Date.now() - t0 };
}

/* exact bottleneck (minimax) value by threshold matching: used in tests to check the heuristic reaches the true optimum */
export function bottleneckMatch(cost, m, k) {
  const vals = [...new Set(Array.from(cost).filter(v => v < INF))].sort((a, b) => a - b), need = Math.min(m, k);
  const run = th => { const match = new Int32Array(k).fill(-1); let size = 0;
    const tryO = (o, seen) => { for (let r = 0; r < k; r++) if (cost[o * k + r] <= th && !seen[r]) { seen[r] = 1; if (match[r] < 0 || tryO(match[r], seen)) { match[r] = o; return true; } } return false; };
    for (let o = 0; o < m; o++) if (tryO(o, new Uint8Array(k))) size++; return size >= need ? match : null; };
  let lo = 0, hi = vals.length - 1; if (hi < 0 || !run(vals[hi])) return null;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (run(vals[mid])) hi = mid; else lo = mid + 1; }
  const match = run(vals[lo]), assign = new Int32Array(m).fill(-1);
  for (let r = 0; r < k; r++) if (match[r] >= 0) assign[match[r]] = r;
  return { value: vals[lo], assign };
}
export const bottleneckOptimum = (cost, m, k) => bottleneckMatch(cost, m, k)?.value ?? null;
