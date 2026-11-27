// Admin console: business dashboard, market insights, zones, team, payouts, coupons, settings.
import { api } from './api.js';
import { S, route, section, nav, live, user, permit } from './state.js';
import { esc, rs, icon, toast, sheet, confirmBox, ask, field, busy, empty, skel, fmtDT, fmtDate, ago, statusPill, bars, cols } from './ui.js';
import { ordersView } from './manager.js';
import { makeMap } from './map.js';

section('admin', { title: 'Admin', home: '/admin', items: [['/admin', 'Dashboard', 'chart', null, 'dashboard'], ['/admin/access', 'Access control', 'lock', null, 'access'], ['/admin/team', 'Users', 'users', null, 'access'],
  ['/manage/applications', 'Applications', 'doc', 'mapps', 'partners'], ['/manage/shops', 'Shops', 'store', null, 'partners'], ['/manage/riders', 'Riders', 'bike', null, 'partners'], ['/admin/orders', 'Orders', 'bell', null, 'orders'], ['/manage/map', 'Live map', 'map', null, 'orders'],
  ['/admin/payouts', 'Payouts', 'wallet', null, 'payouts'], ['/admin/coupons', 'Coupons', 'gift', null, 'coupons'], ['/admin/zones', 'Zones', 'pin', null, 'zones'], ['/admin/settings', 'Fees & growth', 'gear', null, 'settings'],
  ['/admin/support', 'Support', 'info', null, 'support'], ['/admin/reports', 'Reports', 'upload', null, 'reports'], ['/admin/insights', 'Market insights', 'spark', null, 'dashboard'],
  ['/admin/data', 'Data & recovery', 'box', null, 'data'], ['/admin/health', 'System health', 'shield', null, 'ops'], ['/admin/audit', 'Audit log', 'doc', null, 'audit']] });
const opt = { shell: 'p', section: 'admin', auth: true, role: 'admin' };
const alive = el => document.body.contains(el);
const zn = id => S.zones.find(z => z.id === id)?.name || '–';
const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : 0);

/* ---------- dashboard ---------- */
route('/admin', async el => {
  let days = 14;
  async function draw() {
    const d = await api.get('/api/admin/overview', { days }); if (!alive(el)) return; const k = d.kpis;
    const per = n => k.delivered ? n / k.delivered : 0;
    el.innerHTML = `<div class="phead"><div><h1>ZIPI is earning ${rs(k.perOrder)} per delivered order</h1><p>Last ${days} days across ${d.zones.filter(z => z.active).length} live zones. Contribution = commission + customer fees − discounts − rider pay.</p></div>
      <div class="chips">${[7, 14, 30].map(n => `<button class="chip" data-days="${n}" aria-pressed="${days === n}">${n} days</button>`).join('')}</div></div>
      <div class="kpis"><div class="kpi"><small>Order value (GMV)</small><b class="num">${rs(k.gmv)}</b><span>${k.delivered} delivered</span></div><div class="kpi"><small>Average order</small><b class="num">${rs(k.aov)}</b></div><div class="kpi"><small>Contribution</small><b class="num">${rs(k.contribution)}</b><span>${rs(k.perOrder)} per order</span></div>
        <div class="kpi"><small>Customers</small><b>${k.customers}</b><span>ordered at least once</span></div><div class="kpi ${k.cancelRate > 8 ? 'alert' : ''}"><small>Cancelled or rejected</small><b>${k.cancelRate}%</b><span>of ${k.orders} orders</span></div><div class="kpi"><small>Partners live</small><b>${k.vendors} · ${k.riders}</b><span>shops · riders</span></div>${k.pending ? `<div class="kpi alert"><small>Applications waiting</small><b>${k.pending}</b><span data-go="/manage/applications" style="cursor:pointer">Review ›</span></div>` : ''}</div>
      <div class="g2 wide-l"><div class="card"><h3>Delivered orders per day</h3>${cols(d.series.map(x => x.orders), d.series.map(x => new Date(x.day).getDate()), { peakTop: 1 })}</div>
        <div class="card"><h3>Where each order's money goes</h3><p class="small mute" style="margin:2px 0 6px">Average per delivered order</p>${bars([{ k: 'Commission', n: Math.round(per(k.commission)) }, { k: 'Customer fees', n: Math.round(per(k.fees)) }, { k: 'Discounts', n: Math.round(per(k.discounts)) }, { k: 'Rider pay', n: Math.round(per(k.riderPay)) }], { fmt: rs })}
          <div class="kv tot"><span>Contribution per order</span><span class="num" style="color:${k.perOrder >= 0 ? 'var(--goText)' : 'var(--red)'}">${rs(k.perOrder)}</span></div></div></div>
      <div class="g2 wide-l" style="margin-top:16px"><div><h2 style="margin-bottom:10px">Zones</h2><div class="tbl"><table><thead><tr><th>Zone</th><th>Manager</th><th class="r">Orders</th><th class="r">GMV</th><th class="r">Contribution</th><th class="r">Cancel %</th><th class="r">Shops</th><th class="r">Riders</th></tr></thead><tbody>${d.zones.map(z => `<tr><td><b>${esc(z.name)}</b> ${z.active ? '' : '<span class="pill w">Coming soon</span>'}<br><span class="small mute">${esc(z.city)}</span></td><td>${esc(z.manager || '–')}</td><td class="r">${z.delivered}</td><td class="r">${rs(z.gmv)}</td><td class="r">${rs(z.contribution)}</td><td class="r">${z.cancelRate}%</td><td class="r">${z.vendors}</td><td class="r">${z.riders}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card"><h3>Food vs grocery</h3>${bars(d.byType.map(t => ({ k: t.type === 'store' ? 'Grocery' : 'Food', n: t.orders })), { fmt: n => n + ' orders', cls: 'mari' })}${d.byType.map(t => `<div class="kv"><span>${t.type === 'store' ? 'Grocery' : 'Food'} average order</span><b class="num">${rs(t.orders ? t.gmv / t.orders : 0)}</b></div>`).join('')}</div></div>`;
  }
  el.addEventListener('click', e => { const b = e.target.closest('[data-days]'); if (b) { days = +b.dataset.days; draw(); } });
  el.innerHTML = `<div class="kpis">${skel(6, 90)}</div>`; live(draw); await draw();
}, { ...opt, title: 'Dashboard', perm: 'dashboard' });

/* ---------- market insights ---------- */
route('/admin/insights', async el => {
  let days = 30, zone = 'all';
  async function draw() {
    const d = await api.get('/api/admin/insights', { days, zone }); if (!alive(el)) return;
    const f = d.funnel, peakH = d.hours.indexOf(Math.max(...d.hours));
    const recs = [];
    if (d.misses[0]) recs.push(['store', `Sign a shop for “${d.misses[0].k}”`, `${d.misses[0].n} searches found nothing${d.misses[1] ? `; “${d.misses[1].k}” had ${d.misses[1].n}` : ''}. This is demand you are turning away.`]);
    if (d.waitlist[0]) recs.push(['map', `Open ${d.waitlist[0].k.split(',')[0]} next`, `${d.waitlist[0].n} people asked for it on the waitlist${d.waitlist[1] ? `, ahead of ${d.waitlist[1].k.split(',')[0]} (${d.waitlist[1].n})` : ''}.`]);
    if (d.hours.some(h => h)) recs.push(['bike', `Staff up around ${peakH % 12 || 12} ${peakH < 12 ? 'am' : 'pm'}`, `Your busiest hour has ${d.hours[peakH]} orders. Schedule rider slots ${Math.max(0, peakH - 1) % 12 || 12} to ${(peakH + 2) % 12 || 12} ${peakH + 2 < 12 ? 'am' : 'pm'}.`]);
    if (f[3]?.n && f[4]?.n) recs.push(['bag', `${100 - Math.round(100 * f[4].n / f[3].n)}% leave at checkout`, 'Test showing the delivery fee earlier and a first-order coupon on the cart screen.']);
    if (d.nps != null) recs.push(['star', `NPS is ${d.nps}`, d.nps >= 30 ? 'Customers are recommending you. Add a refer-a-friend reward.' : 'Read the wishes below and fix the top complaint first.']);
    const csv = [['Section', 'Item', 'Count'], ...d.searches.map(x => ['Search', x.k, x.n]), ...d.misses.map(x => ['Search with no result', x.k, x.n]), ...d.waitlist.map(x => ['Waitlist', x.k, x.n]), ...d.topItems.map(x => ['Top item', x.k, x.n]), ...d.wishes.map(x => ['Wish', x.wish, 1])].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    el._csv = csv;
    el.innerHTML = `<div class="phead"><div><h1>Market insights</h1><p>What customers search for, where they want ZIPI next, and how they feel, from the last ${days} days. Use it to pick shops, zones and offers.</p></div>
      <div class="row wrap"><select class="in" style="width:auto;min-height:40px" data-zone aria-label="Zone">${[['all', 'All zones'], ...S.zones.map(z => [z.id, z.name])].map(([v, t]) => `<option value="${v}" ${v === zone ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><div class="chips">${[7, 30, 90].map(n => `<button class="chip" data-days="${n}" aria-pressed="${days === n}">${n} days</button>`).join('')}</div><button class="btn sm" id="csv">${icon('doc', 16)} Copy as CSV</button></div></div>
      ${recs.length ? `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">${recs.map(([i, t, s]) => `<div class="kpi" style="background:var(--brand);color:#fff;border:0"><span style="color:var(--mari)">${icon(i, 22)}</span><b style="font-size:20px;margin-top:4px">${esc(t)}</b><p class="small" style="margin:4px 0 0;opacity:.85">${esc(s)}</p></div>`).join('')}</div>` : ''}
      <div class="g2"><div class="card"><h3>Customer funnel</h3><p class="small mute" style="margin:2px 0 6px">Daily visitors at each step</p>${f.map((x, i) => `<div class="bars"><div class="b"><span>${esc(x.k)}</span><span class="t"><i style="width:${pct(x.n, f[0].n)}%"></i></span><b class="num">${x.n}${i ? ` <span class="small mute">${pct(x.n, f[i - 1].n)}%</span>` : ''}</b></div></div>`).join('')}<p class="small mute">Overall conversion: <b>${pct(f[4].n, f[0].n)}%</b> of app opens become orders.</p></div>
        <div class="card"><h3>Searches with no result</h3><p class="small mute" style="margin:2px 0 6px">Things people wanted that no shop near them had</p>${bars(d.misses, { cls: 'tom' })}</div>
        <div class="card"><h3>Waitlist by area</h3><p class="small mute" style="margin:2px 0 6px">${d.waitlistTotal} people asked for ZIPI where it isn't live</p>${bars(d.waitlist, { cls: 'mari' })}</div>
        <div class="card"><h3>Top searches</h3>${bars(d.searches)}</div>
        <div class="card"><h3>Orders by hour</h3>${cols(d.hours, d.hours.map((_, h) => h % 3 === 0 ? String(h) : ''), { peakTop: 3 })}<p class="small mute" style="margin:6px 0 0">Red bars are the three busiest hours.</p></div>
        <div class="card"><h3>Best sellers</h3>${bars(d.topItems)}</div>
        <div class="card"><h3>Loyalty</h3><div class="kpis" style="margin:8px 0 0"><div class="kpi"><small>Repeat customers</small><b>${d.repeatRate}%</b><span>of ${d.customers} buyers ordered 2+ times</span></div><div class="kpi"><small>Net Promoter Score</small><b>${d.nps ?? '–'}</b><span>${d.npsCount} responses</span></div></div>
          ${d.npsCount ? `<div class="stack" style="margin-top:8px"><div style="display:flex;height:14px;border-radius:7px;overflow:hidden"><i style="background:var(--go);width:${pct(d.npsSplit.promoters, d.npsCount)}%"></i><i style="background:var(--mari);width:${pct(d.npsSplit.passives, d.npsCount)}%"></i><i style="background:var(--red);width:${pct(d.npsSplit.detractors, d.npsCount)}%"></i></div><div class="row small mute wrap"><span>Promoters ${d.npsSplit.promoters}</span><span>Passives ${d.npsSplit.passives}</span><span>Detractors ${d.npsSplit.detractors}</span></div></div>` : ''}</div>
        <div class="card"><h3>Order mix</h3>${d.aovByType.map(t => `<div class="kv"><span>${t.type === 'store' ? 'Grocery' : 'Food'}: ${t.n} orders</span><b class="num">${rs(t.aov)} average</b></div>`).join('')}<h3 style="margin-top:14px">Payment</h3>${bars(d.payments.map(p => ({ k: p.k === 'COD' ? 'Cash on delivery' : 'UPI', n: p.n })))}<h3 style="margin-top:14px">Coupons used</h3>${bars(d.coupons)}</div></div>
      <div class="card" style="margin-top:16px"><h3>What customers wish ZIPI had</h3><p class="small mute" style="margin:2px 0 8px">Asked after every delivered order</p>${d.wishes.length ? d.wishes.map(w => `<div class="li"><span>“${esc(w.wish)}”</span><span class="small mute num">${w.nps != null ? `NPS ${w.nps} · ` : ''}${ago(w.at)}</span></div>`).join('') : '<p class="mute small">No answers yet.</p>'}</div>`;
  }
  el.addEventListener('click', async e => { const b = e.target.closest('[data-days]'); if (b) { days = +b.dataset.days; draw(); }
    if (e.target.closest('#csv')) { try { await navigator.clipboard.writeText(el._csv); toast('Copied. Paste into Excel or Google Sheets.', 'ok'); } catch { toast('Copy is blocked here. Select and copy from the sheet instead.', 'err'); sheet(`<textarea class="in" style="min-height:300px" readonly>${esc(el._csv)}</textarea>`, { title: 'CSV', wide: true }); } } });
  el.addEventListener('change', e => { if (e.target.matches('[data-zone]')) { zone = e.target.value; draw(); } });
  el.innerHTML = `<div class="kpis">${skel(4, 120)}</div>`; await draw();
}, { ...opt, title: 'Insights', perm: 'dashboard' });

/* ---------- orders ---------- */
route('/admin/orders', el => ordersView(el, 'All orders'), { ...opt, title: 'Orders', perm: 'orders' });

/* ---------- payouts ---------- */
route('/admin/payouts', async el => {
  async function draw() {
    const d = await api.get('/api/admin/payouts'); if (!alive(el)) return;
    const tbl = (rows, kind) => rows.length ? `<div class="tbl"><table><thead><tr><th>${kind === 'vendor' ? 'Shop' : 'Rider'}</th><th>Zone</th><th>Pay to</th><th class="r">Earned</th><th class="r">Paid</th><th class="r">Due</th>${kind === 'rider' ? '<th class="r">Cash held</th>' : ''}<th></th></tr></thead><tbody>${rows.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(zn(x.zoneId))}</td><td class="small">${esc(x.upi || x.accountNo || '–')}</td><td class="r">${rs(x.earned)}</td><td class="r">${rs(x.paid)}</td><td class="r"><b>${rs(x.due)}</b></td>${kind === 'rider' ? `<td class="r">${x.cashInHand ? rs(x.cashInHand) : '–'}</td>` : ''}<td>${x.due >= 1 ? `<button class="btn sm go" data-pay="${kind}:${x.id}">Mark paid</button>` : '<span class="pill">Settled</span>'}</td></tr>`).join('')}</tbody></table></div>` : empty('Nothing to pay yet');
    const due = a => a.reduce((s, x) => s + Math.max(0, x.due), 0);
    el.innerHTML = `<div class="phead"><div><h1>Payouts</h1><p>Pay shops and riders weekly. Record each transfer here so their apps show it. For riders, net off any cash they still hold.</p></div></div>
      <div class="kpis"><div class="kpi"><small>Owed to shops</small><b class="num">${rs(due(d.vendors))}</b></div><div class="kpi"><small>Owed to riders</small><b class="num">${rs(due(d.riders))}</b></div><div class="kpi"><small>Cash still with riders</small><b class="num">${rs(d.riders.reduce((s, r) => s + (r.cashInHand || 0), 0))}</b></div></div>
      <h2 style="margin:8px 0 10px">Shops</h2>${tbl(d.vendors, 'vendor')}<h2 style="margin:22px 0 10px">Riders</h2>${tbl(d.riders, 'rider')}
      <h2 style="margin:22px 0 10px">Recent transfers</h2><div class="card">${d.recent.map(p => `<div class="li"><span><b>${esc(p.name)}</b> <span class="pill g">${p.partyType}</span><br><span class="small mute">${fmtDT(p.at)} · ${esc(p.ref)}</span></span><b class="num">${rs(p.amount)}</b></div>`).join('') || '<p class="mute small">None yet.</p>'}</div>`;
    el._d = d;
  }
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-pay]'); if (!b) return; const [kind, id] = b.dataset.pay.split(':'); const x = el._d[kind === 'vendor' ? 'vendors' : 'riders'].find(y => y.id === id);
    const f = await ask(`Pay ${x.name}`, field('amount', 'Amount (₹)', { type: 'number', value: Math.round(x.due), attrs: 'min="1"' }) + field('ref', 'UTR / reference', { ph: 'UPI transaction ID' }), { ok: 'Record payout' }); if (!f) return;
    try { await api.post('/api/admin/payouts', { partyType: kind, partyId: id, ...f }); toast('Payout recorded', 'ok'); draw(); } catch (x2) { toast(x2.message, 'err'); }
  });
  el.innerHTML = skel(4, 60); await draw();
}, { ...opt, title: 'Payouts', perm: 'payouts' });

/* ---------- zones ---------- */
route('/admin/zones', async el => {
  async function draw() {
    const [zs, ov] = await Promise.all([api.get('/api/admin/zones'), api.get('/api/admin/overview', { days: 30 })]); if (!alive(el)) return;
    S.zones = zs;
    el.innerHTML = `<div class="phead"><div><h1>Zones</h1><p>A zone is a 2–3 km area with its own shops, riders and manager. Open a new one when the waitlist and shop sign-ups justify it.</p></div><button class="btn go" id="addz">${icon('plus', 18)} New zone</button></div>
      <div class="tbl"><table><thead><tr><th>Zone</th><th>Manager</th><th class="r">Shops</th><th class="r">Riders</th><th class="r">Orders 30d</th><th>Live</th></tr></thead><tbody>${ov.zones.map(z => `<tr><td><b>${esc(z.name)}</b><br><span class="small mute">${esc(z.city)}</span></td><td>${esc(z.manager || '–')}</td><td class="r">${z.vendors}</td><td class="r">${z.riders}</td><td class="r">${z.delivered}</td><td><div class="row" style="gap:6px"><button class="switch" data-zt="${z.id}" aria-pressed="${z.active}" aria-label="Zone live"></button><button class="btn sm" data-zc="${z.id}">${icon('pin', 14)} Centre</button></div></td></tr>`).join('')}</tbody></table></div>`;
  }
  function centreSheet(z) {
    const s = sheet(`<p class="small mute" style="margin:0 0 8px">Drag the map so the pin is in the middle of ${esc(z.name)}. Customer address pins must be within 5 km of this point.</p><div class="pickmap"><div class="lmap" id="zc"></div><div class="pincenter" aria-hidden="true">${icon('pin', 40)}</div></div><p class="small mute num" id="zcll"></p><button class="btn go block" id="zcs">Save centre</button>`, { title: `${z.name} centre`, wide: true });
    let m = null;
    makeMap(s.el.querySelector('#zc'), { center: { lat: z.lat ?? 22.7196, lng: z.lng ?? 75.8577 }, zoom: 14 }).then(r => { m = r.m; const upd = () => { const c = m.getCenter(); s.el.querySelector('#zcll').textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`; }; upd(); m.on('moveend', upd); })
      .catch(() => { s.el.querySelector('.pickmap').outerHTML = empty('Map is unavailable', 'Check your internet connection.', 'map'); });
    s.el.querySelector('#zcs').onclick = async () => { if (!m) return; const c = m.getCenter();
      try { await api.patch('/api/admin/zones/' + z.id, { lat: c.lat, lng: c.lng }); toast('Zone centre saved', 'ok'); s.close(); draw(); } catch (x) { toast(x.message, 'err'); } };
  }
  el.addEventListener('click', async e => {
    if (e.target.closest('#addz')) { const f = await ask('New zone', field('name', 'Zone name', { req: true, ph: 'e.g. Bhawarkua' }) + field('city', 'City', { req: true, value: 'Indore' }) + '<label class="check"><input type="checkbox" name="active"> Go live now (otherwise "coming soon")</label><p class="small mute">Next you will place the zone centre on a map.</p>', { ok: 'Create zone' }); if (!f) return;
      try { const z = await api.post('/api/admin/zones', f); toast('Zone created', 'ok'); await draw(); centreSheet(z); } catch (x) { toast(x.message, 'err'); } }
    const zc = e.target.closest('[data-zc]'); if (zc) { const z = S.zones.find(x => x.id === zc.dataset.zc); if (z) centreSheet(z); return; }
    const t = e.target.closest('[data-zt]'); if (t) { const on = t.getAttribute('aria-pressed') !== 'true'; if (!on && !(await confirmBox('Pause this zone? Customers there will see it as coming soon.', { ok: 'Pause zone', danger: true }))) return;
      try { await api.patch('/api/admin/zones/' + t.dataset.zt, { active: on }); toast(on ? 'Zone is live' : 'Zone paused', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); } }
  });
  el.innerHTML = skel(3, 60); await draw();
}, { ...opt, title: 'Zones', perm: 'zones' });

/* ---------- team & users ---------- */
route('/admin/team', async el => {
  let role = 'all', q = '';
  async function draw() {
    const us = await api.get('/api/admin/users', { role: role === 'all' ? '' : role, q }); if (!alive(el)) return;
    el.innerHTML = `<div class="phead"><div><h1>Users</h1><p>Everyone with a ZIPI account. Open a person to see their orders, coins, logins and app access.</p></div><button class="btn go" data-go="/admin/access">${icon('lock', 18)} Access control</button></div>
      <div class="row wrap" style="margin-bottom:12px"><div class="chips">${[['manager', 'Managers'], ['admin', 'Admins'], ['vendor', 'Shop owners'], ['rider', 'Riders'], ['customer', 'Customers'], ['all', 'Everyone']].map(([k, t]) => `<button class="chip" data-role="${k}" aria-pressed="${role === k}">${t}</button>`).join('')}</div><div class="search" style="box-shadow:none;max-width:300px;min-height:44px">${icon('search', 18)}<input id="uq" placeholder="Name or phone" value="${esc(q)}" aria-label="Search users"></div></div>
      ${us.length ? `<div class="tbl"><table><thead><tr><th>Name</th><th>Phone</th><th>Roles</th><th>Zone</th><th class="r">Orders</th><th>Joined</th><th></th></tr></thead><tbody>${us.map(u => `<tr class="rowlink" data-go="/admin/users/${u.id}"><td><b>${esc(u.name || '–')}</b>${u.blocked ? ' <span class="pill r">Blocked</span>' : ''}</td><td class="num">+91 ${esc(u.phone)}</td><td>${u.roles.map(r => `<span class="pill ${r === 'admin' ? 'r' : r === 'manager' ? 'b' : 'g'}">${r}</span>`).join(' ')}</td><td>${esc(u.zoneId ? zn(u.zoneId) : '–')}</td><td class="r">${u.orders}</td><td class="num">${fmtDate(u.createdAt)}</td><td class="r">${icon('chevR', 16)}</td></tr>`).join('')}</tbody></table></div>` : empty('Nobody here yet', role === 'manager' ? 'Add your first zone manager.' : '', 'users')}`;
    const i = el.querySelector('#uq'); i.onchange = () => { q = i.value; draw(); };
  }
  el.addEventListener('click', async e => {
    const r = e.target.closest('[data-role]'); if (r) { role = r.dataset.role; return draw(); }
    if (e.target.closest('#addm')) { const f = await ask('Add zone manager', field('name', 'Full name', { req: true }) + field('phone', 'Mobile number', { req: true, type: 'tel', ph: '10 digits', hint: 'They log in with this number' }) + field('zoneId', 'Zone', { options: S.zones.map(z => [z.id, `${z.name}, ${z.city}`]) }), { ok: 'Add manager' }); if (!f) return;
      try { await api.post('/api/admin/managers', f); toast(`${f.name} can now log in as zone manager`, 'ok'); role = 'manager'; draw(); } catch (x) { toast(x.message, 'err'); } }
    const rm = e.target.closest('[data-rm]'); if (rm && await confirmBox('Remove manager access for this person?', { ok: 'Remove', danger: true })) { try { await api.patch('/api/admin/users/' + rm.dataset.rm, { removeRole: 'manager', zoneId: null }); toast('Manager removed', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); } }
    const bl = e.target.closest('[data-block]'); if (bl) { const b = bl.dataset.b === '1'; if (b && !(await confirmBox('Block this account? They will not be able to log in or order.', { ok: 'Block', danger: true }))) return; try { await api.patch('/api/admin/users/' + bl.dataset.block, { blocked: b }); toast(b ? 'Blocked' : 'Unblocked', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); } }
  });
  el.innerHTML = skel(4, 56); await draw();
}, { ...opt, title: 'Team', perm: 'access' });

/* ---------- coupons ---------- */
route('/admin/coupons', async el => {
  const TYPES = { pct: 'Percent off', flat: 'Flat off', freedel: 'Free delivery' };
  async function draw() {
    const cs = await api.get('/api/admin/coupons'); if (!alive(el)) return;
    el.innerHTML = `<div class="phead"><div><h1>Coupons</h1><p>ZIPI pays for these discounts, so they come out of contribution. Watch uses against new customers gained.</p></div><button class="btn go" id="addc">${icon('plus', 18)} New coupon</button></div>
      <div class="tbl"><table><thead><tr><th>Code</th><th>Offer</th><th>Rules</th><th class="r">Uses</th><th>Active</th></tr></thead><tbody>${cs.map(c => `<tr><td><b>${esc(c.code)}</b><br><span class="small mute">${esc(c.title)}</span></td><td>${TYPES[c.type]}${c.type === 'pct' ? ` ${c.value}%${c.maxDiscount ? ` up to ${rs(c.maxDiscount)}` : ''}` : c.type === 'flat' ? ` ${rs(c.value)}` : ''}</td><td class="small">Min ${rs(c.minOrder)}${c.firstOrderOnly ? ' · first order' : ''}${c.vendorType ? ` · ${c.vendorType === 'store' ? 'grocery' : 'food'} only` : ''}</td><td class="r">${c.uses}</td><td><button class="switch" data-ct="${c.id}" aria-pressed="${c.active}" aria-label="Active"></button></td></tr>`).join('')}</tbody></table></div>`;
  }
  el.addEventListener('click', async e => {
    if (e.target.closest('#addc')) { const f = await ask('New coupon', field('code', 'Code', { req: true, ph: 'DIWALI60', attrs: 'style="text-transform:uppercase"' }) + field('title', 'Headline customers see', { ph: '₹60 off this Diwali' }) + field('desc', 'Small print', { ph: 'On orders above ₹299' }) + `<div class="grid2">${field('type', 'Type', { options: Object.entries(TYPES) })}${field('value', 'Value (% or ₹)', { type: 'number', value: 50 })}</div><div class="grid2">${field('maxDiscount', 'Max discount ₹ (for %)', { type: 'number' })}${field('minOrder', 'Minimum order ₹', { type: 'number', value: 199 })}</div>${field('vendorType', 'Applies to', { options: [['', 'Food and grocery'], ['restaurant', 'Food only'], ['store', 'Grocery only']] })}<label class="check"><input type="checkbox" name="firstOrderOnly"> First order only</label>`, { ok: 'Create coupon' }); if (!f) return;
      try { await api.post('/api/admin/coupons', f); S.config = await api.get('/api/config'); toast('Coupon created', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); } }
    const t = e.target.closest('[data-ct]'); if (t) { try { await api.patch('/api/admin/coupons/' + t.dataset.ct, { active: t.getAttribute('aria-pressed') !== 'true' }); S.config = await api.get('/api/config'); draw(); } catch (x) { toast(x.message, 'err'); } }
  });
  el.innerHTML = skel(3, 56); await draw();
}, { ...opt, title: 'Coupons', perm: 'coupons' });

/* ---------- settings ---------- */
route('/admin/settings', async el => {
  const s = await api.get('/api/admin/settings');
  const n = (k, l, h) => field(k, l, { type: 'number', value: s[k], hint: h, attrs: 'step="0.5" min="0"' });
  const sg = s.surge || {};
  el.innerHTML = `<div class="phead"><div><h1>Fees & growth</h1><p>Changes apply to new orders straight away. Existing orders keep the price they were placed at.</p></div></div>
    <form id="sf" class="g2"><div class="card"><h3>Customer fees</h3>${n('baseFee', 'Delivery fee up to 2 km (₹)')}${n('perKmFee', 'Each extra km (₹)')}${n('freeDeliveryAbove', 'Free delivery above (₹)')}${n('smallOrderBelow', 'Small-order fee below (₹)')}${n('smallOrderFee', 'Small-order fee (₹)')}${n('platformFee', 'Platform fee per order (₹)')}</div>
      <div class="card"><h3>Partners</h3>${field('cr', 'Restaurant commission (%)', { type: 'number', value: s.commission.restaurant, attrs: 'step="0.5" min="0" max="40"' })}${field('cs', 'Grocery shop commission (%)', { type: 'number', value: s.commission.store, attrs: 'step="0.5" min="0" max="40"' })}${n('riderBase', 'Rider base pay per trip (₹)')}${n('riderPerKm', 'Rider pay per km (₹)')}${n('acceptMins', 'Minutes a shop has to accept', 'After this the order is auto-cancelled and refunded')}
      </div>
      <div class="card"><h3>${icon('bolt', 18)} Surge pricing</h3><p class="small mute" style="margin:2px 0 8px">Added to the customer's bill when riders are scarce. Riders get the share you set below.</p>
        <label class="check"><input type="checkbox" name="s_enabled" ${sg.enabled ? 'checked' : ''}> Surge pricing on</label>
        ${field('s_peakHours', 'Peak hours (24 h)', { value: sg.peakHours || '', ph: '12-14,19-22', hint: 'Comma-separated ranges, e.g. 12-14,19-22' })}<div class="grid2">${field('s_peakFee', 'Peak-hour fee (₹)', { type: 'number', value: sg.peakFee ?? 0 })}${field('s_demandFee', 'High-demand fee (₹)', { type: 'number', value: sg.demandFee ?? 0 })}</div>
        ${field('s_demandRatio', 'High demand when waiting orders per online rider reach', { type: 'number', value: sg.demandRatio ?? 2.5, attrs: 'step="0.5" min="1" max="10"' })}
        <div class="grid2">${field('s_rainFee', 'Rain fee (₹)', { type: 'number', value: sg.rainFee ?? 0 })}${field('s_riderShare', 'Rider share of surge (%)', { type: 'number', value: sg.riderShare ?? 60 })}</div>
        <label class="check"><input type="checkbox" name="s_rain" ${sg.rain ? 'checked' : ''}> It's raining now (turn on rain fee)</label></div>
      <div class="card"><h3>${icon('coin', 18)} Loyalty, referrals and dispatch</h3>${n('loyaltyPct', 'Coins earned (% of item total)', '1 coin = ₹1, credited on delivery')}${n('coinsMaxPct', 'Max coins usable (% of item total)')}${n('referralReward', 'Referral reward (coins, each side)', 'Paid to both people after the friend\'s first delivery')}${n('scheduleDays', 'Customers can schedule up to (days ahead)')}
        <label class="check" style="margin-top:12px"><input type="checkbox" name="autoAssign" ${s.autoAssign ? 'checked' : ''}> Auto-assign the nearest free rider when a shop accepts</label>
        <button class="btn go block big" style="margin-top:16px">Save settings</button></div></form>`;
  el.querySelector('#sf').onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true); const f = Object.fromEntries(new FormData(e.target));
    const form = e.target, surge = { enabled: form.s_enabled.checked, rain: form.s_rain.checked }; for (const k of ['peakHours', 'peakFee', 'demandFee', 'demandRatio', 'rainFee', 'riderShare']) surge[k] = f['s_' + k];
    for (const k in f) if (k.startsWith('s_')) delete f[k];
    try { const { cr, cs, ...rest } = f; await api.patch('/api/admin/settings', { ...rest, autoAssign: form.autoAssign.checked, surge, commission: { restaurant: cr, store: cs } }); S.config = await api.get('/api/config', { zone: S.zoneId }); toast('Settings saved', 'ok'); } catch (x) { toast(x.message, 'err'); } busy(b, false); };
}, { ...opt, title: 'Settings', perm: 'settings' });

/* ---------- audit log: every staff action that changes money, partners or access ---------- */
route('/admin/audit', async el => {
  let q = '';
  async function draw() {
    const rows = await api.get('/api/admin/audit', { q }); if (!alive(el)) return;
    const list = el.querySelector('#al');
    list.innerHTML = rows.length ? `<div class="tbl"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>On</th><th>Details</th></tr></thead><tbody>${rows.map(a => `<tr><td class="num">${fmtDT(a.at)}<br><span class="small mute">${ago(a.at)}</span></td><td>${esc(a.byName)}<br><span class="small mute">${esc(a.role)}</span></td><td><b>${esc(a.action)}</b></td><td>${esc(a.target)}</td><td class="small mute" style="max-width:340px;overflow-wrap:anywhere">${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>` : empty(q ? 'Nothing matches' : 'No staff actions yet', 'Approvals, cancellations, payouts, fee changes and user changes appear here.', 'lock');
  }
  el.innerHTML = `<div class="phead"><div><h1>Audit log</h1><p>Every staff action that changes money, partners or access. Entries cannot be edited.</p></div><div class="search" style="min-width:240px;box-shadow:none;min-height:44px">${icon('search', 18)}<input id="aq" placeholder="Search actions, people, orders" aria-label="Search audit log"></div></div><div id="al">${skel(5, 50)}</div>`;
  let t; el.querySelector('#aq').oninput = e => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); draw(); }, 300); };
  await draw();
}, { ...opt, title: 'Audit log', perm: 'audit' });

/* =====================================================================
   ACCESS CONTROL: the one page that decides who can use which app
   ===================================================================== */
const APP_INFO = { customer: ['ZIPI app', 'bag', '/'], vendor: ['Shop console', 'store', '/shop'], rider: ['Rider app', 'bike', '/rider'], manager: ['Zone manager', 'map', '/manager'], admin: ['Admin console', 'shield', '/admin'] };
const isSuperMe = () => (user()?.perms || []).includes('*');
const ago2 = t => (t ? ago(t) : 'never');
function accessChips(u) {
  const out = [];
  if (u.roles.includes('admin')) out.push(`<span class="pill r">${icon('shield', 12)} ${u.perms?.includes('*') ? 'Super admin' : `Admin · ${u.perms?.length || 0} areas`}</span>`);
  if (u.roles.includes('manager')) out.push(`<span class="pill b">${icon('map', 12)} Manager · ${esc(zn(u.zoneId))}</span>`);
  if (u.roles.includes('vendor')) out.push(`<span class="pill">${icon('store', 12)} ${esc(u.vendor?.name || 'Shop')}</span>`);
  if (u.roles.includes('rider')) out.push(`<span class="pill w">${icon('bike', 12)} Rider</span>`);
  for (const a of u.locked || []) out.push(`<span class="pill g">${icon('lock', 12)} ${esc(APP_INFO[a][0])} paused</span>`);
  if (u.blocked) out.push('<span class="pill r">Blocked</span>');
  return out.join(' ');
}
route('/admin/access', async el => {
  let d = null, filter = 'staff', q = '';
  async function load() { d = await api.get('/api/admin/access'); draw(); }
  function draw() {
    if (!alive(el)) return;
    const list = d.staff.filter(u => (filter === 'staff' ? u.roles.some(r => r === 'admin' || r === 'manager') : filter === 'partners' ? u.roles.some(r => r === 'vendor' || r === 'rider') : filter === 'paused' ? u.locked.length || u.blocked : true)
      && (!q || `${u.name} ${u.phone}`.toLowerCase().includes(q.toLowerCase())));
    el.innerHTML = `<div class="phead"><div><h1>Access control</h1><p>Each ZIPI app is separate and has its own login. A login only works in the app it was made for, and the server checks access on every request.</p></div><button class="btn go" id="addstaff">${icon('plus', 18)} Add staff</button></div>
      <div class="appgrid">${d.apps.map(a => `<div class="appcard"><span class="ic">${icon(APP_INFO[a.key][1], 22)}</span><div class="grow"><b>${esc(APP_INFO[a.key][0])}</b><small>${a.key === 'customer' ? 'Anyone with a phone number' : `${a.users} ${a.users === 1 ? 'person has' : 'people have'} access`} · ${a.logins7d} logins this week</small></div><a class="btn sm" href="${APP_INFO[a.key][2]}" target="_blank" rel="noopener">Open ${icon('chevR', 14)}</a></div>`).join('')}</div>
      <div class="row between wrap" style="margin:20px 0 10px"><div class="chips">${[['staff', 'Admins & managers'], ['partners', 'Shops & riders'], ['paused', 'Paused or blocked'], ['all', 'Everyone with app access']].map(([k, t]) => `<button class="chip" data-f="${k}" aria-pressed="${filter === k}">${t}</button>`).join('')}</div>
        <div class="search" style="box-shadow:none;min-height:42px;max-width:280px">${icon('search', 18)}<input id="aq" placeholder="Name or phone" value="${esc(q)}" aria-label="Search people"></div></div>
      ${list.length ? `<div class="tbl"><table><thead><tr><th>Person</th><th>Access</th><th>Last login</th><th></th></tr></thead><tbody>${list.map(u => `<tr><td><b>${esc(u.name || '–')}</b>${u.id === user().id ? ' <span class="pill g">You</span>' : ''}<br><span class="small mute num">+91 ${esc(u.phone)}</span></td><td style="max-width:420px">${accessChips(u)}</td>
        <td class="small">${Object.entries(u.last).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, t]) => `${esc(APP_INFO[k][0])}: ${ago2(t)}`).join('<br>') || '<span class="mute">never</span>'}</td><td class="r"><button class="btn sm" data-manage="${u.id}">Manage</button></td></tr>`).join('')}</tbody></table></div>` : empty('Nobody here', 'Try another filter.', 'users')}
      <h2 style="margin:24px 0 10px">Recent logins</h2><div class="tbl"><table><thead><tr><th>When</th><th>Who</th><th>App</th><th>Network</th><th>Device</th></tr></thead><tbody>${d.logins.map(l => `<tr><td class="num">${fmtDT(l.at)}</td><td><a href="#/admin/users/${l.userId}" data-go="/admin/users/${l.userId}">${esc(l.name)}</a></td><td>${esc(APP_INFO[l.app]?.[0] || l.app)}</td><td class="small mute num">${esc(l.ip || '–')}</td><td class="small mute" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.ua)}">${esc(device(l.ua))}</td></tr>`).join('') || '<tr><td colspan="5" class="mute">No logins recorded yet.</td></tr>'}</tbody></table></div>`;
    const i = el.querySelector('#aq'); i.oninput = () => { q = i.value; clearTimeout(i._t); i._t = setTimeout(() => { draw(); const n = el.querySelector('#aq'); n.focus(); n.setSelectionRange(q.length, q.length); }, 250); };
  }
  el.addEventListener('click', async e => {
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; return draw(); }
    const m = e.target.closest('[data-manage]'); if (m) return manageAccess(d.staff.find(u => u.id === m.dataset.manage), d, load);
    if (e.target.closest('#addstaff')) {
      const permBoxes = (name, all, sel = []) => `<div class="permgrid">${Object.entries(all).map(([k, t]) => `<label class="check"><input type="checkbox" name="${name}" value="${k}" ${sel.includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>`;
      const s = sheet(`<form id="sf">${field('name', 'Full name', { req: true })}${field('phone', 'Mobile number', { req: true, type: 'tel', ph: '10 digits', hint: 'They log in with this number in their own app' })}
        <div class="f"><span>Give access to</span><div class="payopt"><label><input type="radio" name="role" value="manager" checked hidden><b>${icon('map', 16)} Zone manager</b><span class="small mute">Runs one zone</span></label>${isSuperMe() ? `<label><input type="radio" name="role" value="admin" hidden><b>${icon('shield', 16)} Admin</b><span class="small mute">Head office</span></label>` : ''}</div></div>
        <div id="mgrf">${field('zoneId', 'Zone', { options: S.zones.map(z => [z.id, `${z.name}, ${z.city}`]) })}<div class="f"><span>Manager can</span>${permBoxes('mperms', d.managerPerms, Object.keys(d.managerPerms))}</div></div>
        <div id="admf" hidden><label class="check"><input type="checkbox" name="super"> <b>Super admin</b>: everything, including adding admins</label><div class="f"><span>Or only these areas</span>${permBoxes('perms', d.adminPerms, ['dashboard'])}</div></div>
        <button class="btn go block big" style="margin-top:16px">Give access</button></form>`, { title: 'Add staff' });
      const form = s.el.querySelector('#sf');
      const sync = () => { const r = form.role.value; form.querySelectorAll('.payopt label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); s.el.querySelector('#mgrf').hidden = r !== 'manager'; s.el.querySelector('#admf').hidden = r !== 'admin'; };
      form.addEventListener('change', sync); sync();
      form.onsubmit = async ev => { ev.preventDefault(); const b = ev.submitter; busy(b, true);
        const body = { name: form.name.value, phone: form.phone.value, role: form.role.value, zoneId: form.zoneId?.value,
          mperms: [...form.querySelectorAll('[name=mperms]:checked')].map(x => x.value), perms: form.super?.checked ? ['*'] : [...form.querySelectorAll('[name=perms]:checked')].map(x => x.value) };
        try { await api.post('/api/admin/access', body); toast(`${body.name} can now log in at ${body.role === 'admin' ? '/admin' : '/manager'}`, 'ok'); s.close(); load(); } catch (x) { toast(x.message, 'err'); busy(b, false); } };
    }
  });
  el.innerHTML = skel(4, 70); await load();
}, { ...opt, title: 'Access control', perm: 'access' });

const device = ua => !ua ? '–' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android phone' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : ua.slice(0, 40);

/* one person's access, app by app */
function manageAccess(u, d, after) {
  const s = sheet('<div id="ma"></div>', { title: `Access: ${u.name || u.phone}`, wide: true });
  const box = s.el.querySelector('#ma');
  const patch = async (body, msg) => { try { u = await api.patch('/api/admin/access/' + u.id, body); toast(msg, 'ok'); render(); after(); } catch (x) { toast(x.message, 'err'); render(); } };
  const self = u.id === user().id;
  function row(app, has, detail, ctrl) {
    const paused = (u.locked || []).includes(app);
    return `<div class="accrow ${has ? 'on' : ''}"><span class="ic">${icon(APP_INFO[app][1], 20)}</span><div class="grow"><b>${esc(APP_INFO[app][0])}</b><small>${detail}</small></div>
      ${has && app !== 'customer' || app === 'customer' ? `<button class="btn sm ${paused ? 'go' : ''}" data-pause="${app}" ${self && app === 'admin' ? 'disabled' : ''}>${paused ? 'Resume' : 'Pause'}</button>` : ''}${ctrl}</div>`;
  }
  function render() {
    const has = r => u.roles.includes(r), P = u.perms || [], M = u.mperms || [];
    box.innerHTML = `<p class="small mute" style="margin:0 0 10px">+91 ${esc(u.phone)} · ${u.blocked ? '<b style="color:var(--red)">Blocked</b>' : 'Active'}. Pausing an app signs them out of it straight away; their data is kept.</p>
      ${row('customer', true, (u.locked || []).includes('customer') ? 'Paused: cannot order' : 'Can order food and groceries', '')}
      ${row('vendor', has('vendor'), has('vendor') ? `${esc(u.vendor?.name || '')} · shop is ${esc(u.vendor?.status || '')}` : u.vendor ? `Application: ${esc(u.vendor.status)}` : 'No shop application', has('vendor') ? `<button class="btn sm danger" data-revoke="vendor">Remove</button>` : u.vendor ? `<button class="btn sm go" data-grant="vendor">Approve & give access</button>` : '')}
      ${row('rider', has('rider'), has('rider') ? `Rider is ${esc(u.rider?.status || '')}` : u.rider ? `Application: ${esc(u.rider.status)}` : 'No rider application', has('rider') ? `<button class="btn sm danger" data-revoke="rider">Remove</button>` : u.rider ? `<button class="btn sm go" data-grant="rider">Approve & give access</button>` : '')}
      ${row('manager', has('manager'), has('manager') ? `Zone: ${esc(zn(u.zoneId))}` : 'Not a manager', has('manager') ? `<button class="btn sm danger" data-revoke="manager">Remove</button>` : `<button class="btn sm" data-grant="manager">Make manager</button>`)}
      ${has('manager') ? `<div class="accsub"><label class="f" style="margin:0"><span>Zone</span><select class="in" data-zone>${S.zones.map(z => `<option value="${z.id}" ${z.id === u.zoneId ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select></label>
        <div class="f"><span>Manager can</span><div class="permgrid">${Object.entries(d.managerPerms).map(([k, t]) => `<label class="check"><input type="checkbox" data-mperm="${k}" ${M.includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div></div></div>` : ''}
      ${row('admin', has('admin'), has('admin') ? (P.includes('*') ? 'Super admin: full control' : `Admin: ${P.length ? P.map(k => esc(d.adminPerms[k])).join(', ') : 'no areas yet'}`) : 'Not an admin', has('admin') ? (self ? '' : `<button class="btn sm danger" data-revoke="admin" ${isSuperMe() ? '' : 'disabled'}>Remove</button>`) : `<button class="btn sm" data-grant="admin" ${isSuperMe() ? '' : 'disabled title="Only a super admin can do this"'}>Make admin</button>`)}
      ${has('admin') ? `<div class="accsub"><label class="check"><input type="checkbox" data-super ${P.includes('*') ? 'checked' : ''} ${isSuperMe() ? '' : 'disabled'}> <b>Super admin</b>: every area, can manage other admins</label>
        <div class="permgrid" ${P.includes('*') ? 'hidden' : ''}>${Object.entries(d.adminPerms).map(([k, t]) => `<label class="check"><input type="checkbox" data-perm="${k}" ${P.includes(k) ? 'checked' : ''} ${isSuperMe() ? '' : 'disabled'}> ${esc(t)}</label>`).join('')}</div></div>` : ''}
      <div class="row wrap" style="margin-top:16px"><button class="btn" data-signout>${icon('logout', 16)} Sign out everywhere</button><button class="btn" data-otpunlock>${icon('refresh', 16)} Reset login code limit</button>${self ? '' : `<button class="btn ${u.blocked ? 'go' : 'danger'}" data-blk>${u.blocked ? 'Unblock account' : 'Block account'}</button>`}<span class="grow"></span><button class="btn ghost" data-go="/admin/users/${u.id}" data-close>Full profile ${icon('chevR', 14)}</button></div>`;
  }
  box.addEventListener('click', async e => {
    const b = e.target.closest('button'); const t = e.target;
    if (b?.dataset.pause) { const on = !(u.locked || []).includes(b.dataset.pause); return patch(on ? { lock: b.dataset.pause } : { unlock: b.dataset.pause }, on ? 'App paused and signed out' : 'App resumed'); }
    if (b?.dataset.grant) { if (b.dataset.grant === 'manager') { const f = await ask('Make zone manager', field('zoneId', 'Zone', { options: S.zones.map(z => [z.id, z.name]) }), { ok: 'Give access' }); if (f) patch({ grant: 'manager', zoneId: f.zoneId }, 'Manager access given'); return; }
      return patch({ grant: b.dataset.grant }, 'Access given'); }
    if (b?.dataset.revoke) { if (await confirmBox(`Remove ${APP_INFO[b.dataset.revoke][0]} access for ${u.name || u.phone}? They are signed out of it now.`, { ok: 'Remove access', danger: true })) patch({ revoke: b.dataset.revoke }, 'Access removed'); return; }
    if (b?.hasAttribute('data-otpunlock')) { busy(b, true); try { await api.post(`/api/admin/users/${u.id}/unlock-otp`); toast('They can request a new login code now', 'ok'); } catch (x) { toast(x.message, 'err'); } busy(b, false); return; }
    if (b?.hasAttribute('data-signout')) { if (await confirmBox('Sign them out of every app on every device?', { ok: 'Sign out' })) patch({ signOut: true }, 'Signed out everywhere'); return; }
    if (b?.hasAttribute('data-blk')) { if (u.blocked || await confirmBox('Block this account? They are signed out and cannot log in to any app.', { ok: 'Block', danger: true })) patch({ blocked: !u.blocked }, u.blocked ? 'Unblocked' : 'Blocked'); return; }
    if (t.matches('[data-super]')) return patch({ perms: t.checked ? ['*'] : [] }, t.checked ? 'Now a super admin' : 'Super admin removed. Pick their areas below.');
    if (t.matches('[data-perm]')) return patch({ perms: [...box.querySelectorAll('[data-perm]:checked')].map(x => x.dataset.perm) }, 'Admin permissions saved');
    if (t.matches('[data-mperm]')) return patch({ mperms: [...box.querySelectorAll('[data-mperm]:checked')].map(x => x.dataset.mperm) }, 'Manager permissions saved');
  });
  box.addEventListener('change', e => { if (e.target.matches('[data-zone]')) patch({ zoneId: e.target.value }, 'Zone changed'); });
  render();
}

/* =====================================================================
   ONE PERSON: profile, access, orders, coins, logins, shop / rider
   ===================================================================== */
route('/admin/users/:id', async (el, { id }) => {
  el.innerHTML = skel(4, 80);
  let d, acc;
  async function load() { [d, acc] = await Promise.all([api.get('/api/admin/users/' + id), api.get('/api/admin/access')]); draw(); }
  function draw() {
    if (!alive(el)) return; const u = d.user;
    el.innerHTML = `<div class="phead"><div><button class="btn ghost sm" data-go="/admin/team">${icon('chevL', 16)} Users</button><h1>${esc(u.name || 'No name')}</h1><p class="num">+91 ${esc(u.phone)} · joined ${fmtDate(u.createdAt)}${u.referredBy ? ` · invited by ${esc(u.referredBy)}` : ''}</p><div style="margin-top:6px">${accessChips(u) || '<span class="pill g">Customer only</span>'}</div></div>
      <div class="row wrap"><button class="btn" id="edname">${icon('edit', 16)} Rename</button><button class="btn go" id="acc">${icon('lock', 16)} Manage access</button></div></div>
      <div class="kpis"><div class="kpi"><small>Orders</small><b>${d.stats.orders}</b><span>${d.stats.delivered} delivered · ${d.stats.cancelled} cancelled</span></div><div class="kpi"><small>Spent</small><b class="num">${rs(d.stats.spent)}</b></div><div class="kpi"><small>ZIPI coins</small><b>${u.coins}</b><span data-act2="coins" style="cursor:pointer;color:var(--goText)">Adjust ›</span></div>
        <div class="kpi"><small>Last login</small><b style="font-size:20px">${ago2(Math.max(0, ...Object.values(u.last)))}</b><span>${Object.keys(u.last).map(k => APP_INFO[k][0]).join(', ') || 'never'}</span></div></div>
      ${d.vendor ? `<div class="card row wrap" style="margin-top:14px">${icon('store', 22)}<div class="grow"><b>${esc(d.vendor.name)}</b> ${statusPill(d.vendor.status)}<br><span class="small mute">${esc(d.vendor.address)} · ${esc(zn(d.vendor.zoneId))} · commission ${d.vendor.commission ?? 'default'}${d.vendor.commission != null ? '%' : ''}</span></div><button class="btn sm" data-editv>Edit shop</button><button class="btn sm" data-go="/manage/shop/${d.vendor.id}">Menu & stock</button></div>` : ''}
      ${d.rider ? `<div class="card row wrap" style="margin-top:10px">${icon('bike', 22)}<div class="grow"><b>Rider</b> ${statusPill(d.rider.status)}<br><span class="small mute">${esc(d.rider.vehicle)} · ${esc(zn(d.rider.zoneId))} · ${d.rider.rating} ★ · cash in hand ${rs(d.rider.cashInHand)}</span></div><button class="btn sm" data-editr>Edit rider</button></div>` : ''}
      <div class="g2" style="margin-top:16px"><div class="card"><h3>Recent orders</h3>${d.orders.length ? d.orders.map(o => `<div class="li"><span><b>${esc(o.code)}</b> · ${esc(o.vendor || '')}<br><span class="small mute">${fmtDT(o.at)}</span></span><span class="row">${statusPill(o.status)}<b class="num">${rs(o.total)}</b></span></div>`).join('') : '<p class="mute small">No orders yet.</p>'}
        <h3 style="margin-top:16px">Addresses</h3>${u.addresses.map(a => `<div class="li"><span><b>${esc(a.label)}</b><br><span class="small mute">${esc(a.line)}, ${esc(a.area)} · ${esc(zn(a.zoneId))}</span></span></div>`).join('') || '<p class="mute small">None saved.</p>'}</div>
      <div class="card"><h3>Coins</h3>${d.wallet.map(w => `<div class="li"><span>${esc(w.reason)}<br><span class="small mute">${fmtDT(w.at)}</span></span><b class="num" style="color:${w.amount > 0 ? 'var(--goText)' : 'var(--red)'}">${w.amount > 0 ? '+' : ''}${w.amount}</b></div>`).join('') || '<p class="mute small">No coin activity.</p>'}
        <h3 style="margin-top:16px">Logins</h3>${d.logins.map(l => `<div class="li"><span>${esc(APP_INFO[l.app]?.[0] || l.app)}<br><span class="small mute">${fmtDT(l.at)} · ${esc(device(l.ua))}</span></span><span class="small mute num">${esc(l.ip || '')}</span></div>`).join('') || '<p class="mute small">No logins recorded yet.</p>'}</div></div>`;
  }
  el.addEventListener('click', async e => {
    if (e.target.closest('#acc')) return manageAccess(acc.staff.find(x => x.id === id) || { ...d.user, vendor: d.vendor, rider: d.rider }, acc, load);
    if (e.target.closest('#edname')) { const f = await ask('Rename', field('name', 'Full name', { req: true, value: d.user.name })); if (f) { try { await api.patch('/api/admin/access/' + id, f); toast('Saved', 'ok'); load(); } catch (x) { toast(x.message, 'err'); } } return; }
    if (e.target.closest('[data-act2=coins]')) { const f = await ask('Adjust ZIPI coins', field('amount', 'Coins (use a minus sign to remove)', { type: 'number', req: true, ph: 'e.g. 50 or -20' }) + field('reason', 'Reason (the customer sees this)', { req: true, ph: 'e.g. Sorry for the late delivery' }), { ok: 'Save' });
      if (f) { try { await api.post(`/api/admin/users/${id}/coins`, f); toast('Coins updated', 'ok'); load(); } catch (x) { toast(x.message, 'err'); } } return; }
    if (e.target.closest('[data-editv]')) { const { editVendorSheet } = await import('./manager.js'); if (await editVendorSheet(d.vendor)) load(); return; }
    if (e.target.closest('[data-editr]')) { const { editRiderSheet } = await import('./manager.js'); if (await editRiderSheet(d.rider)) load(); return; }
  });
  await load();
}, { ...opt, title: 'User', perm: 'access' });

/* =====================================================================
   DATA & STORAGE: every data space, record browser, exports, backups, files
   ===================================================================== */
const bytes = n => (n == null ? '–' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const COLL_LABEL = { users: 'Accounts', wallet: 'Coin ledger', feedback: 'Ratings & NPS', waitlist: 'Waitlist', vendors: 'Shops', items: 'Menu & stock items', riders: 'Riders', shifts: 'Shift bookings', cashlogs: 'Cash deposits',
  orders: 'Orders', payouts: 'Payouts', coupons: 'Coupons', zones: 'Zones', settings: 'Settings', audit: 'Audit log', logins: 'Login history', events: 'App analytics events', otps: 'Pending login codes' };
route('/admin/data', async el => {
  let d, tab = 'spaces';
  async function load() { d = await api.get('/api/admin/storage'); draw(); }
  function draw() {
    if (!alive(el)) return; const st = d.stats;
    const total = d.spaces.reduce((a, x) => a + x.count, 0);
    el.innerHTML = `<div class="phead"><div><h1>Data & storage</h1><p>Every piece of data ZIPI keeps, grouped by the app it belongs to. Sensitive fields (login codes, order OTPs, bank numbers) are masked here.</p></div><button class="btn go" id="bk">${icon('shield', 18)} Back up now</button></div>
      <div class="kpis"><div class="kpi"><small>Database</small><b>${bytes(st?.dbBytes)}</b><span>${total.toLocaleString('en-IN')} records${st ? ` · in ${esc(st.dataDir)}/` : ''}</span></div><div class="kpi"><small>Uploaded files</small><b>${bytes(st?.uploadsBytes)}</b><span>${d.uploads} files</span></div>
        <div class="kpi"><small>Backups</small><b>${bytes(st?.backupsBytes)}</b><span>${d.backups.length} kept${d.backups[0] ? ` · last ${ago(d.backups[0].at)}` : ''}</span></div><div class="kpi"><small>Data spaces</small><b>${d.spaces.length}</b><span>one per app, plus system</span></div></div>
      <div class="chips" style="margin:6px 0 14px">${[['spaces', 'Data spaces'], ['trash', 'History & trash'], ['files', 'Uploaded files'], ['backups', 'Backups']].map(([k, t]) => `<button class="chip" data-tab="${k}" aria-pressed="${tab === k}">${t}</button>`).join('')}</div><div id="tabv"></div>`;
    const v = el.querySelector('#tabv');
    if (tab === 'spaces') v.innerHTML = `<div class="spacegrid">${d.spaces.map(sp => `<div class="card"><div class="row between"><h3>${esc(sp.name)}</h3><span class="small mute">${sp.count.toLocaleString('en-IN')} records · ${bytes(sp.bytes)}</span></div>
      ${sp.colls.map(c => `<button class="li collbtn" data-coll="${c.name}"><span><b>${esc(COLL_LABEL[c.name] || c.name)}</b><br><span class="small mute">${c.name} · ${bytes(c.bytes)}</span></span><span class="row"><b class="num">${c.count.toLocaleString('en-IN')}</b>${icon('chevR', 16)}</span></button>`).join('')}</div>`).join('')}</div>`;
    if (tab === 'backups') v.innerHTML = `<p class="small mute">A backup is a full copy of every record (compressed). One is made automatically every day (last 7 kept), plus any you make by hand (last 10 kept). To restore, run <code>node scripts/zipi.js restore &lt;file&gt;</code> on the server (see OPERATIONS.md). Single records can be restored from History & trash.</p>
      ${d.backups.length ? `<div class="tbl"><table><thead><tr><th>File</th><th>Made</th><th class="r">Size</th><th></th></tr></thead><tbody>${d.backups.map(b => `<tr><td class="num">${esc(b.name)}</td><td>${fmtDT(b.at)}</td><td class="r">${bytes(b.bytes)}</td><td class="r"><button class="btn sm" data-dl="${esc(b.name)}">${icon('upload', 14)} Download</button></td></tr>`).join('')}</tbody></table></div>` : empty('No backups yet', api.mode === 'server' ? 'Tap "Back up now".' : 'Backups need the real server.', 'shield')}`;
    if (tab === 'files') files(v);
    if (tab === 'trash') import('./staff.js').then(m => m.trashView(v));
  }
  async function files(v) {
    v.innerHTML = skel(3, 60);
    const fs_ = await api.get('/api/admin/uploads'); if (!alive(el)) return;
    v.innerHTML = fs_.length ? `<div class="filegrid">${fs_.map(f => `<div class="card filecard">${/\.pdf$/.test(f.name) ? `<div class="fprev">${icon('doc', 34)}</div>` : `<img class="fprev" src="${esc(f.url)}" alt="" loading="lazy">`}<div class="small"><b class="num">${esc(f.name.slice(0, 10))}…</b> · ${bytes(f.bytes)}<br><span class="mute">${f.usedBy ? esc(f.usedBy) : 'Not used anywhere'}</span></div>
      <div class="row" style="gap:6px"><a class="btn sm" href="${esc(f.url)}" target="_blank" rel="noopener">Open</a>${f.usedBy ? '' : `<button class="btn sm danger" data-rmf="${esc(f.name)}">Delete</button>`}</div></div>`).join('')}</div>` : empty('No uploaded files', 'Shop photos and partner documents appear here.', 'upload');
  }
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; return draw(); }
    const c = e.target.closest('[data-coll]'); if (c) return browse(c.dataset.coll);
    if (e.target.closest('#bk')) { const b = e.target.closest('#bk'); busy(b, true); try { const r = await api.post('/api/admin/storage/backup'); toast(`Backup ${r.backup.name} saved`, 'ok'); tab = 'backups'; await load(); } catch (x) { toast(x.message, 'err'); busy(b, false); } return; }
    const dl = e.target.closest('[data-dl]'); if (dl) {
      busy(dl, true);
      try { await api.download('/api/admin/storage/backups/' + encodeURIComponent(dl.dataset.dl), null, dl.dataset.dl); } catch (x) { toast(x.message, 'err'); } busy(dl, false); return; }
    const rm = e.target.closest('[data-rmf]'); if (rm) { if (!(await confirmBox('Delete this file for good? It is not used by any shop, rider or item.', { ok: 'Delete', danger: true }))) return;
      try { await api.del('/api/admin/uploads/' + rm.dataset.rmf); toast('File deleted', 'ok'); files(el.querySelector('#tabv')); } catch (x) { toast(x.message, 'err'); } }
  });
  el.innerHTML = `<div class="kpis">${skel(4, 90)}</div>`; await load();
}, { ...opt, title: 'Data & storage', perm: 'data' });

function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const csvCell = v => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function browse(coll) {
  let q = '', page = 0;
  const s = sheet(`<div class="row wrap" style="margin-bottom:10px"><div class="search grow" style="box-shadow:none;min-height:42px">${icon('search', 18)}<input id="bq" placeholder="Search inside ${esc(COLL_LABEL[coll] || coll)}" aria-label="Search records"></div>
    <button class="btn sm" data-exp="csv">Export CSV</button><button class="btn sm" data-exp="json">Export JSON</button></div><div id="bres">${skel(3, 40)}</div>`, { title: COLL_LABEL[coll] || coll, wide: true });
  const res = s.el.querySelector('#bres');
  async function load() {
    const d = await api.get('/api/admin/storage/' + coll, { q, page });
    const keys = [...new Set(d.rows.flatMap(r => Object.keys(r)))].filter(k => k !== 'id').slice(0, 7);
    res.innerHTML = `<p class="small mute" style="margin:0 0 8px">${d.total.toLocaleString('en-IN')} records${q ? ` matching “${esc(q)}”` : ''}. Tap a row to see everything in it.</p>
      ${d.rows.length ? `<div class="tbl"><table class="datatbl"><thead><tr><th>id</th>${keys.map(k => `<th>${esc(k)}</th>`).join('')}${d.tracked ? '<th></th>' : ''}</tr></thead><tbody>${d.rows.map((r, i) => `<tr class="rowlink" data-row="${i}"><td class="num small">${esc(String(r.id).slice(0, 14))}</td>${keys.map(k => `<td class="small">${esc(short(r[k], k))}</td>`).join('')}${d.tracked ? `<td><button class="btn sm" data-hist="${esc(r.id)}">History</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : empty('No records', '', 'box')}
      <div class="row between" style="margin-top:10px"><button class="btn sm" data-pg="-1" ${page ? '' : 'disabled'}>${icon('chevL', 14)} Previous</button><span class="small mute">Page ${page + 1} of ${Math.max(1, Math.ceil(d.total / 50))}</span><button class="btn sm" data-pg="1" ${(page + 1) * 50 < d.total ? '' : 'disabled'}>Next ${icon('chevR', 14)}</button></div>`;
    res._rows = d.rows;
  }
  const short = (v, k) => v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : /At$|^at$/.test(k) && typeof v === 'number' && v > 1e12 ? fmtDT(v) : String(v).slice(0, 40);
  s.el.addEventListener('click', async e => {
    const pg = e.target.closest('[data-pg]'); if (pg) { page += +pg.dataset.pg; return load(); }
    const hb = e.target.closest('[data-hist]'); if (hb) { e.stopPropagation(); const { historySheet } = await import('./staff.js'); return historySheet(coll, hb.dataset.hist, load); }
    const r = e.target.closest('[data-row]'); if (r) { const row = res._rows[+r.dataset.row]; sheet(`<pre class="jsonview">${esc(JSON.stringify(row, null, 2))}</pre>`, { title: `${coll} · ${row.id}`, wide: true }); return; }
    const ex = e.target.closest('[data-exp]'); if (ex) { busy(ex, true);
      try { const d = await api.get('/api/admin/storage/' + coll, { q, all: 1 }); const stamp = new Date().toISOString().slice(0, 10);
        if (ex.dataset.exp === 'json') saveBlob(new Blob([JSON.stringify(d.rows, null, 2)], { type: 'application/json' }), `zipi-${coll}-${stamp}.json`);
        else { const keys = [...new Set(d.rows.flatMap(r => Object.keys(r)))]; saveBlob(new Blob([[keys.join(','), ...d.rows.map(r => keys.map(k => csvCell(r[k])).join(','))].join('\n')], { type: 'text/csv' }), `zipi-${coll}-${stamp}.csv`); }
        toast(`Exported ${d.rows.length} records`, 'ok'); } catch (x) { toast(x.message, 'err'); } busy(ex, false); }
  });
  const inp = s.el.querySelector('#bq'); inp.oninput = () => { clearTimeout(inp._t); inp._t = setTimeout(() => { q = inp.value.trim(); page = 0; load(); }, 300); };
  load();
}
