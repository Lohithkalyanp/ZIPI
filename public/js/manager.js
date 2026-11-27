// Zone manager console: approve partners, manage shop stock, riders, live orders, field onboarding.
// Admins use the same screens with a zone picker.
import { api } from './api.js';
import { S, route, section, nav, live, hasRole, user, store, APP } from './state.js';
import { esc, rs, icon, pic, toast, sheet, confirmBox, ask, field, busy, empty, skel, fmtTime, fmtDT, ago, statusPill } from './ui.js';
import { setBadge } from './main.js';
import { stockTable, bindStock, editItemSheet } from './vendor.js';
import { partnerForm } from './partner.js';
import { makeMap, pin, glide } from './map.js';

section('manage', { title: 'Zone manager', home: '/manage', items: [['/manage', 'Overview', 'chart'], ['/manage/applications', 'Applications', 'doc', 'mapps'], ['/manage/orders', 'Live orders', 'bell', 'mneed'], ['/manage/map', 'Live map', 'map'], ['/manage/shops', 'Shops & stock', 'store', 'mlow'], ['/manage/shifts', 'Rider shifts', 'cal'], ['/manage/riders', 'Riders', 'bike'], ['/manage/support', 'Support', 'info'], ['/manage/reports', 'Reports', 'upload'], ['/manage/onboard', 'Onboard', 'plus']] });
const opt = { shell: 'p', section: 'manage', auth: true, role: 'manager' };
const alive = el => document.body.contains(el);
const VEH = { bike: 'Bike', scooter: 'Scooter', ev: 'EV scooter', cycle: 'Bicycle' };
S.manageZone = store.get('mzone', 'all');
const zq = () => (hasRole('admin') && !user().zoneId ? { zone: S.manageZone } : {});
const zoneLabel = () => { const z = S.zones.find(x => x.id === (user().zoneId || S.manageZone)); return z ? `${z.name}, ${z.city}` : 'All zones'; };
function zonePicker() {
  if (!(hasRole('admin') && !user().zoneId)) return `<span class="pill b">${icon('pin', 12)} ${esc(zoneLabel())}</span>`;
  return `<label class="row small" style="gap:6px">Zone <select class="in" style="width:auto;min-height:40px" data-mzone>${[['all', 'All zones'], ...S.zones.map(z => [z.id, z.name])].map(([v, t]) => `<option value="${v}" ${v === S.manageZone ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}
document.addEventListener('change', e => { if (e.target.matches('[data-mzone]')) { S.manageZone = e.target.value; store.set('mzone', S.manageZone); nav(S.path || '/manage', { replace: true }); } });
const head = (t, p, extra = '') => `<div class="phead"><div><h1>${t}</h1><p>${p}</p></div><div class="row wrap">${extra}${zonePicker()}</div></div>`;
const zoneName = id => S.zones.find(z => z.id === id)?.name || '';

/* ---------- overview ---------- */
route('/manage', async el => {
  el.innerHTML = `<div class="kpis">${skel(6, 90)}</div>`;
  async function draw() {
    const d = await api.get('/api/manage/overview', zq()); if (!alive(el)) return; const k = d.kpis;
    setBadge('mapps', k.pendingVendors + k.pendingRiders); setBadge('mneed', k.needsRider); setBadge('mlow', k.lowStock);
    el.innerHTML = head(`${esc(d.zone?.name || 'All zones')} today`, `Live view for ${esc(zoneLabel())}. Updates as orders move.`) + `
      <div class="kpis"><div class="kpi"><small>Orders today</small><b>${k.ordersToday}</b><span>${k.delivered} delivered · ${k.cancelledToday} cancelled</span></div><div class="kpi"><small>Delivered value</small><b class="num">${rs(k.gmv)}</b></div>
        <div class="kpi ${k.needsRider ? 'alert' : ''}"><small>Live orders</small><b>${k.live}</b><span ${k.needsRider ? 'style="color:var(--tomText)"' : ''}>${k.needsRider ? `${k.needsRider} need a rider` : 'All covered'}</span></div>
        <div class="kpi"><small>Shops open</small><b>${k.vendorsOnline}/${k.vendorsLive}</b></div><div class="kpi"><small>Riders online</small><b>${k.ridersOnline}/${k.ridersActive}</b></div>
        <div class="kpi ${k.pendingVendors + k.pendingRiders ? 'alert' : ''}"><small>Waiting for approval</small><b>${k.pendingVendors + k.pendingRiders}</b><span data-go="/manage/applications" style="cursor:pointer">${k.pendingVendors} shops · ${k.pendingRiders} riders ›</span></div>
        <div class="kpi ${k.lowStock ? 'alert' : ''}"><small>Low-stock items</small><b>${k.lowStock}</b></div><div class="kpi"><small>Cash with riders</small><b class="num">${rs(k.cashWithRiders)}</b></div></div>
      <div class="g2 wide-l"><div class="card"><div class="row between"><h3>Live orders</h3><button class="btn sm" data-go="/manage/orders">All orders</button></div>${d.live.length ? d.live.map(o => `<div class="li"><span><b>${esc(o.code)}</b> · ${esc(o.vendor.name)}<br><span class="small mute">${ago(o.createdAt)} · to ${esc(o.address.area)} · ${o.rider ? esc(o.rider.name) : 'no rider'}</span></span><span class="row">${statusPill(o.status)}${o.needsRider ? `<button class="btn sm go" data-assign="${o.id}">Assign</button>` : ''}</span></div>`).join('') : '<p class="mute small">No live orders right now.</p>'}</div>
        <div class="card"><h3>Running low</h3><p class="small mute" style="margin:2px 0 8px">Call the shop or top up stock for them.</p>${d.lowStock.length ? d.lowStock.map(i => `<div class="li"><span><b>${esc(i.name)}</b><br><span class="small mute">${esc(i.vendorName)}</span></span><span class="row"><span class="pill ${i.stock === 0 ? 'r' : 'w'}">${i.stock === 0 ? 'Out' : i.stock + ' left'}</span><button class="btn sm" data-go="/manage/shop/${i.vendorId}">Restock</button></span></div>`).join('') : '<p class="mute small">Stock looks healthy.</p>'}</div></div>`;
  }
  el.addEventListener('click', async e => { const b = e.target.closest('[data-assign]'); if (b) { await assignRider(b.dataset.assign); draw(); } });
  live(draw); await draw();
}, { ...opt, title: 'Overview' });

async function assignRider(orderId) {
  const rs_ = await api.get('/api/manage/riders', zq()); const o = await api.get('/api/orders/' + orderId);
  const opts = rs_.filter(r => r.status === 'approved' && r.zoneId === o.zoneId).map(r => [r.id, `${r.name} · ${r.online ? 'online' : 'offline'} · ${r.active} active`]);
  if (!opts.length) return toast('No approved riders in this zone', 'err');
  const f = await ask(`Assign rider to ${o.code}`, field('riderId', 'Rider', { options: opts }), { ok: 'Assign' }); if (!f) return;
  try { await api.post(`/api/manage/orders/${orderId}/assign` + (zq().zone ? '?zone=' + zq().zone : ''), f); toast('Rider assigned', 'ok'); } catch (x) { toast(x.message, 'err'); }
}

/* ---------- live map: online riders (real GPS where shared), shops and live orders ---------- */
route('/manage/map', async el => {
  el.innerHTML = head('Live map', 'Riders, shops and live orders. Rider dots move as their GPS updates.') + `<div class="maplegend"><span><i style="background:#ffc23d"></i>Rider (live GPS)</span><span><i style="background:#ffc23d;opacity:.45"></i>Rider (last known area)</span><span><i style="background:var(--go)"></i>Shop open</span><span><i style="background:#9aa9a0"></i>Shop closed</span><span><i style="background:var(--tom)"></i>Order needs a rider</span></div><div class="lmap xl" id="mm"></div><div id="ml" style="margin-top:14px"></div>`;
  let M = null; const riders = new Map(); let layer = null, stageLayer = null;
  async function draw() {
    const d = await api.get('/api/manage/map', zq()); if (!alive(el)) return;
    if (!M) { try { const z = d.zones[0] || S.zones.find(x => x.lat); M = await makeMap(el.querySelector('#mm'), { center: z, zoom: 13 }); } catch { el.querySelector('#mm').outerHTML = empty('Map is unavailable', 'Check your internet connection.', 'map'); return; } }
    const { L, m } = M;
    if (layer) layer.remove(); layer = L.layerGroup().addTo(m);
    for (const z of d.zones) L.circle([z.lat, z.lng], { radius: z.radiusKm * 1000, color: '#0b7a43', weight: 1, fillOpacity: .04, interactive: false }).addTo(layer);
    for (const v of d.shops) L.marker([v.ll.lat, v.ll.lng], { icon: pin(L, 'shop', { color: v.open ? v.color : '#9aa9a0', dim: !v.open }), title: v.name }).addTo(layer).bindTooltip(`${esc(v.name)}${v.open ? '' : ' (closed)'}`);
    for (const o of d.orders.filter(o => o.needsRider)) L.circleMarker([o.vendorLL.lat, o.vendorLL.lng], { radius: 22, color: '#ff5a36', weight: 3, fill: false, className: 'needpulse' }).addTo(layer).bindTooltip(`${o.code} needs a rider`);
    const seen = new Set();
    for (const r of d.riders) { seen.add(r.id);
      const lbl = `<b>${esc(r.name)}</b><br>${r.live ? 'Live GPS' : 'No GPS, approximate'} · ${r.active.length ? 'on ' + r.active.join(', ') : 'free'}<br><a href="tel:+91${esc(r.phone)}">Call</a>`;
      if (riders.has(r.id)) { const mk = riders.get(r.id); glide(mk, r.ll); mk.setPopupContent(lbl); }
      else riders.set(r.id, L.marker([r.ll.lat, r.ll.lng], { icon: pin(L, 'rider', { pulse: r.live, dim: !r.live, label: esc(r.name.split(' ')[0]) }), zIndexOffset: 600 }).addTo(m).bindPopup(lbl)); }
    for (const [id, mk] of riders) if (!seen.has(id)) { mk.remove(); riders.delete(id); }
    // p-center plan: suggested waiting spots for free riders, with the distance that keeps every open shop covered
    try {
      const plan = await api.get('/api/manage/staging', zq()); if (stageLayer) stageLayer.remove(); stageLayer = L.layerGroup().addTo(m);
      for (const sp of plan.spots) { L.circle([sp.ll.lat, sp.ll.lng], { radius: plan.radiusKm * 1000, color: '#ffc23d', weight: 1, dashArray: '4 6', fillOpacity: .05, interactive: false }).addTo(stageLayer);
        L.circleMarker([sp.ll.lat, sp.ll.lng], { radius: 7, color: '#14201a', weight: 2, fillColor: '#ffc23d', fillOpacity: 1 }).addTo(stageLayer).bindTooltip(`Waiting spot: ${esc(sp.name)}${sp.riderName ? ' · ' + esc(sp.riderName) + ` (${sp.riderKm} km away)` : ''}`); }
      el._plan = plan;
    } catch { }
    el.querySelector('#ml').innerHTML = `<div class="kpis"><div class="kpi"><small>Riders online</small><b>${d.riders.length}</b><span>${d.riders.filter(r => r.live).length} sharing GPS</span></div><div class="kpi"><small>Free riders</small><b>${d.riders.filter(r => !r.active.length).length}</b></div><div class="kpi ${d.orders.some(o => o.needsRider) ? 'alert' : ''}"><small>Live orders</small><b>${d.orders.length}</b><span>${d.orders.filter(o => o.needsRider).length} need a rider</span></div><div class="kpi"><small>Shops open</small><b>${d.shops.filter(v => v.open).length}/${d.shops.length}</b></div></div>
      <div class="card" style="margin-top:14px"><div class="row between wrap"><div><h3>Rider positioning (p-center plan)</h3><p class="small mute" style="margin:2px 0 0">${el._plan?.spots?.length ? `Yellow dots are where the ${el._plan.riders} free riders should wait: every open shop is then within about <b>${el._plan.radiusKm} km</b> of a rider. Orders are matched to riders so the longest pickup is as short as possible.` : 'No free riders online right now.'}</p></div><button class="btn sm" id="cov">${icon('chart', 16)} How many riders do we need?</button></div><div id="covt"></div></div>`;
  }
  const off = api.on(ev => { if (!alive(el)) return off(); if (ev.type === 'rider_pos' && riders.has(ev.id) && ev.pos) glide(riders.get(ev.id), ev.pos); });
  el.addEventListener('click', async e => {
    const b = e.target.closest('#cov'); if (!b) return; busy(b, true);
    try { const cv = await api.get('/api/manage/coverage', zq()); const box = el.querySelector('#covt');
      box.innerHTML = cv.rows.length ? `<p class="small mute" style="margin:10px 0 6px">For ${cv.shops} open shops: with this many riders well placed, the farthest shop is this far from the nearest rider.</p><div class="covgrid">${cv.rows.map(r => `<div class="${r.radiusKm <= 2 ? 'good' : r.radiusKm <= 4 ? 'ok' : ''}"><b>${r.riders}</b><span>${r.riders === 1 ? 'rider' : 'riders'}</span><small>${r.radiusKm} km</small></div>`).join('')}</div><p class="small mute">Green: every shop within 2 km (pickups in about 5 minutes).</p>` : empty('No open shops', '', 'store'); }
    catch (x) { toast(x.message, 'err'); } busy(b, false);
  });
  live(draw); await draw();
}, { ...opt, title: 'Live map' });

/* ---------- rider shifts: booked riders against forecast demand ---------- */
route('/manage/shifts', async el => {
  el.innerHTML = skel(3, 120);
  async function draw() {
    const d = await api.get('/api/manage/shifts', zq()); if (!alive(el)) return;
    const gaps = d.days.flatMap(x => x.slots.filter(s => !s.over && s.booked < s.needed).map(s => ({ ...s, day: x }))).length;
    el.innerHTML = head(`Rider shifts${d.zone ? ' · ' + esc(d.zone.name) : ''}`, 'Riders book their own slots. Forecast comes from the same weekday over the last two weeks (about 2.5 deliveries per rider per hour).', gaps ? `<span class="pill t">${gaps} slots short</span>` : '<span class="pill">All slots covered</span>') +
      `<div class="tbl"><table class="shifttbl"><thead><tr><th>Day</th>${Object.values(d.slots).map(x => `<th>${esc(x[2])}</th>`).join('')}</tr></thead><tbody>${d.days.map((x, i) => `<tr><td><b>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(x.at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</b></td>${x.slots.map(s => `<td class="${s.over ? 'mute' : s.booked < s.needed ? 'short' : 'ok'}"><b>${s.booked}/${s.needed}</b> riders<br><span class="small mute">~${s.expected} orders</span>${s.riders.length ? `<br><span class="small">${s.riders.map(esc).join(', ')}</span>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="small mute">Short slots: call riders who usually ride then, or offer a slot bonus. Riders see these slots marked "needs riders" in their app.</p>`;
  }
  live(draw); await draw();
}, { ...opt, title: 'Rider shifts' });

/* ---------- applications ---------- */
route('/manage/applications', async el => {
  let tab = 'vendors', status = 'pending';
  async function draw() {
    const d = await api.get('/api/manage/applications', { ...zq(), status }); if (!alive(el)) return;
    if (status === 'pending') setBadge('mapps', d.vendors.length + d.riders.length);
    const list = d[tab];
    el.innerHTML = head('Partner applications', 'Check documents, then approve or send back with a clear reason.') + `
      <div class="row wrap" style="margin-bottom:14px"><div class="seg" style="position:relative">${[['vendors', `Shops (${d.vendors.length})`], ['riders', `Riders (${d.riders.length})`]].map(([k, t]) => `<button data-tab="${k}" aria-pressed="${tab === k}" style="${tab === k ? 'background:var(--card);box-shadow:var(--shadow)' : ''}">${t}</button>`).join('')}</div>
      <div class="chips">${[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['suspended', 'Suspended'], ['all', 'All']].map(([k, t]) => `<button class="chip" data-st="${k}" aria-pressed="${status === k}">${t}</button>`).join('')}</div></div>
      ${list.length ? `<div class="tbl"><table><thead><tr><th>${tab === 'vendors' ? 'Business' : 'Rider'}</th><th>${tab === 'vendors' ? 'Type' : 'Vehicle'}</th><th>Zone</th><th>Applied</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>${list.map(x => `<tr class="click" data-open="${x.id}"><td><b>${esc(x.name)}</b><br><span class="small mute">${esc(tab === 'vendors' ? x.ownerName : '')} +91 ${esc(x.phone)}</span></td><td>${tab === 'vendors' ? (x.type === 'store' ? 'Shop · ' + esc(x.storeCategory || '') : 'Restaurant') : esc(VEH[x.vehicle])}</td><td>${esc(zoneName(x.zoneId))}</td><td class="num">${ago(x.createdAt)}</td><td>${x.onboardedBy === 'self' ? 'App' : x.onboardedBy === 'seed' ? 'Pilot' : 'Field'}</td><td>${statusPill(x.status)}</td><td>${icon('chevR', 18)}</td></tr>`).join('')}</tbody></table></div>` : empty(status === 'pending' ? 'Nothing waiting' : 'No applications here', status === 'pending' ? 'New applications appear here as soon as they are sent.' : '', 'doc')}`;
    el._list = list;
  }
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; return draw(); }
    const s = e.target.closest('[data-st]'); if (s) { status = s.dataset.st; return draw(); }
    const r = e.target.closest('[data-open]'); if (r) reviewSheet(tab === 'vendors' ? 'vendor' : 'rider', el._list.find(x => x.id === r.dataset.open), draw);
  });
  live(draw); await draw();
}, { ...opt, title: 'Applications' });

function reviewSheet(kind, x, after) {
  const V = kind === 'vendor';
  const rows = V ? [['Type', x.type === 'store' ? `Shop (${x.storeCategory})` : 'Restaurant'], ['Owner', x.ownerName], ['Phone', '+91 ' + x.phone], ['Address', `${x.address}${x.landmark ? ', ' + x.landmark : ''}`], ['Zone', zoneName(x.zoneId)], ['Sells', (x.tags || []).join(', ')], ['Hours', x.hours], ['Prep time', x.prepMins + ' min'], ['PAN', x.pan], [x.storeCategory === 'pharmacy' ? 'Drug licence' : 'FSSAI', x.storeCategory === 'pharmacy' ? x.drugLicense : x.fssai], ['GSTIN', x.gst || 'Not registered'], ['Payout', x.upi || `Bank ${x.accountNo} · ${x.ifsc}`], ['Commission', x.commission != null ? x.commission + '% (custom)' : 'Standard']]
    : [['Phone', '+91 ' + x.phone], ['Zone', zoneName(x.zoneId)], ['Vehicle', VEH[x.vehicle]], ['Driving licence', x.dl || 'Not needed'], ['RC', x.rc || 'Not needed'], ['Aadhaar', '•••• •••• ' + x.aadhaarLast4], ['PAN', x.pan], ['Shift', x.shift], ['Languages', x.languages], ['Emergency contact', x.emergencyName ? `${x.emergencyName} · ${x.emergencyPhone}` : '–'], ['Payout', x.upi || `Bank ${x.accountNo} · ${x.ifsc}`]];
  const s = sheet(`<div class="row between"><span class="small mute">Applied ${fmtDT(x.createdAt)}</span>${statusPill(x.status)}</div>${x.rejectReason ? `<div class="err">${esc(x.rejectReason)}</div>` : ''}
    <dl class="dl" style="margin-top:12px">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd data-k="${esc(k)}">${esc(v)}</dd>`).join('')}</dl>
    <button class="btn sm ghost" data-kyc>${icon('lock', 14)} Show full ID & bank details</button><span class="small mute"> Hidden by default. Each view is logged.</span>
    <h3 style="margin:18px 0 8px">Documents</h3>${x.docs?.length ? `<div class="docgrid">${x.docs.map(d => `<a class="doc" href="${esc(d.url)}" target="_blank" rel="noopener">${d.url.includes('pdf') ? `<div style="height:110px;display:grid;place-items:center">${icon('doc', 40)}</div>` : `<img src="${esc(d.url)}" alt="${esc(d.label)}">`}<div>${esc(d.label)}</div></a>`).join('')}</div>` : '<p class="small mute">No documents uploaded. Check originals during your visit.</p>'}
    <div class="card" style="margin-top:16px;background:var(--sunk);border:0"><b>Before approving</b><ul class="small" style="margin:6px 0 0;padding-left:18px">${V ? '<li>Visit the shop and match the photo and address</li><li>Check PAN and FSSAI / drug licence originals</li><li>Help them add their first 15 items and set stock</li>' : '<li>Match the selfie with the person</li><li>Check licence and RC originals</li><li>Confirm police verification is submitted</li>'}</ul></div>
    ${V ? field('commission', 'Commission % for this shop (blank = standard)', { type: 'number', value: x.commission ?? '', attrs: 'min="0" max="40" step="0.5"' }) : ''}
    <div class="row wrap" style="margin-top:16px">${x.status === 'pending' || x.status === 'rejected' ? `<button class="btn danger" data-a="reject">Send back</button><button class="btn go grow" data-a="approve">Approve and make live</button>` : x.status === 'approved' ? `<button class="btn danger grow" data-a="suspend">Suspend</button>` : `<button class="btn go grow" data-a="reinstate">Reinstate</button>`}</div>`, { title: x.name, wide: true });
  s.el.addEventListener('click', async e => {
    const k = e.target.closest('[data-kyc]');
    if (k) { try { const d = await api.get(`/api/manage/kyc/${kind}/${x.id}` + (zq().zone ? '?zone=' + zq().zone : '')); const set = (label, v) => { const dd = s.el.querySelector(`[data-k="${label}"]`); if (dd && v) dd.textContent = v; };
      set('PAN', d.pan); set('Driving licence', d.dl); set('RC', d.rc); set('Drug licence', d.drugLicense); if (d.aadhaarLast4) set('Aadhaar', '•••• •••• ' + d.aadhaarLast4);
      const pay = s.el.querySelector('[data-k="Payout"]'); if (pay && d.accountNo) pay.textContent = (x.upi ? x.upi + ' · ' : '') + `Bank ${d.accountNo} · ${x.ifsc || ''}`; k.remove(); } catch (x2) { toast(x2.message, 'err'); } return; }
    const b = e.target.closest('[data-a]'); if (!b) return; const action = b.dataset.a; let reason = '';
    if (action === 'reject' || action === 'suspend') { const f = await ask(action === 'reject' ? 'What needs fixing?' : 'Reason for suspension', field('reason', 'Reason (the applicant sees this)', { type: 'textarea', req: true, ph: action === 'reject' ? 'e.g. FSSAI number does not match the certificate' : 'e.g. 5 missed orders this week' }), { ok: action === 'reject' ? 'Send back' : 'Suspend', danger: true }); if (!f) return; reason = f.reason; }
    busy(b, true);
    try { const commission = s.el.querySelector('[name=commission]')?.value; await api.post(`/api/manage/${V ? 'vendors' : 'riders'}/${x.id}/review` + (zq().zone ? '?zone=' + zq().zone : ''), { action, reason, commission });
      toast({ approve: `${x.name} is approved`, reject: 'Sent back to applicant', suspend: 'Suspended', reinstate: 'Reinstated' }[action], 'ok'); s.close(); after(); } catch (x2) { toast(x2.message, 'err'); busy(b, false); }
  });
}

/* ---------- shops & stock ---------- */
route('/manage/shops', async el => {
  el.innerHTML = skel(5, 56); let q = '';
  async function draw() {
    const vs = await api.get('/api/manage/vendors', zq()); if (!alive(el)) return;
    setBadge('mlow', vs.reduce((a, v) => a + v.lowStock, 0));
    const list = vs.filter(v => !q || v.name.toLowerCase().includes(q));
    el.innerHTML = head('Shops & stock', 'Open a shop to update its stock, prices or opening status on its behalf.') + `<div class="search" style="box-shadow:none;max-width:360px;min-height:44px;margin-bottom:12px">${icon('search', 18)}<input id="sq" placeholder="Search shops" value="${esc(q)}" aria-label="Search shops"></div>
      ${list.length ? `<div class="tbl"><table><thead><tr><th>Shop</th><th>Status</th><th>Open</th><th class="r">Items</th><th class="r">Low / out</th><th class="r">Orders 7d</th><th class="r">Missed 7d</th><th class="r">Rating</th><th class="r">Commission</th></tr></thead><tbody>${list.map(v => `<tr class="click" data-open="${v.id}"><td><div class="row"><div class="thumb">${pic(v)}</div><span><b>${esc(v.name)}</b><br><span class="small mute">${v.type === 'store' ? 'Shop' : 'Restaurant'} · ${esc(v.ownerName)} · ${esc(zoneName(v.zoneId))}</span></span></div></td><td>${statusPill(v.status)}</td><td><button class="switch" data-onl="${v.id}" aria-pressed="${v.online}" aria-label="Shop open"></button></td><td class="r">${v.items}</td><td class="r">${v.lowStock || v.outOfStock ? `<span class="pill ${v.outOfStock ? 'r' : 'w'}">${v.lowStock} / ${v.outOfStock}</span>` : '–'}</td><td class="r">${v.orders7d}</td><td class="r">${v.rejected7d ? `<span class="pill r">${v.rejected7d}</span>` : '0'}</td><td class="r">${v.rating ?? 'New'}</td><td class="r">${v.commissionPct}%</td></tr>`).join('')}</tbody></table></div>` : empty('No shops yet', 'Onboard your first shop from the Onboard tab.', 'store')}`;
    el.querySelector('#sq').oninput = e => { q = e.target.value.toLowerCase(); const pos = e.target.selectionStart; draw().then(() => { const i = el.querySelector('#sq'); i.focus(); i.setSelectionRange(pos, pos); }); };
  }
  el.addEventListener('click', async e => {
    const s = e.target.closest('[data-onl]'); if (s) { e.stopPropagation(); try { await api.patch('/api/manage/vendors/' + s.dataset.onl + (zq().zone ? '?zone=' + zq().zone : ''), { online: s.getAttribute('aria-pressed') !== 'true' }); toast('Updated', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); } return; }
    const r = e.target.closest('[data-open]'); if (r) nav('/manage/shop/' + r.dataset.open);
  });
  await draw();
}, { ...opt, title: 'Shops' });

route('/manage/shop/:id', async (el, { id }) => {
  el.innerHTML = skel(5, 60); let v, items = [];
  const qz = zq().zone ? '?zone=' + zq().zone : '';
  async function load() { const d = await api.get('/api/manage/vendors/' + id, zq()); v = d.vendor; items = d.items; draw(); }
  function draw() {
    if (!alive(el)) return;
    el.innerHTML = `<div class="phead"><div><button class="btn ghost sm" data-go="/manage/shops">${icon('chevL', 16)} All shops</button><h1>${esc(v.name)}</h1><p>${esc(v.ownerName)} · +91 ${esc(v.phone)} · ${esc(v.address)}</p></div><div class="row wrap"><a class="btn" href="tel:+91${esc(v.phone)}">${icon('phone', 16)} Call owner</a>${APP === 'admin' ? `<button class="btn" id="editv">${icon('edit', 16)} Edit shop</button>` : ''}<button class="btn go" id="add">${icon('plus', 18)} Add item</button></div></div>
      <div class="online ${v.online ? 'on' : ''}" style="margin-bottom:14px"><span class="grow"><b>${v.online ? 'Open for orders' : 'Closed'}</b><br><span class="small mute">Prep ${v.prepMins} min · ${statusPill(v.status)}</span></span><button class="switch" id="onl" aria-pressed="${v.online}" aria-label="Open for orders"></button></div>
      <div id="tbl">${items.length ? stockTable(items, v, {}) : empty('No items yet', 'Add the shop\'s catalogue so customers can order.', 'box')}</div><p class="small mute">Changes are saved instantly and logged under your name.</p>`;
  }
  const patch = async (iid, b) => { const n = await api.patch('/api/manage/items/' + iid + qz, b); items = items.map(i => i.id === iid ? n : i); };
  const sections = () => [...new Set(items.map(i => i.section))];
  el.addEventListener('click', async e => {
    if (e.target.closest('#editv')) { if (await editVendorSheet(v)) load(); return; }
    if (e.target.closest('#onl')) { try { await api.patch('/api/manage/vendors/' + id + qz, { online: !v.online }); toast('Updated', 'ok'); load(); } catch (x) { toast(x.message, 'err'); } }
    if (e.target.closest('#add')) { await editItemSheet(null, v, sections(), async p => { await api.post(`/api/manage/vendors/${id}/items` + qz, p); toast('Item added', 'ok'); }); load(); }
  });
  await load();
  bindStock(el, () => items, patch, draw, async it => { await editItemSheet(it, v, sections(), async (p, del) => { await api.patch('/api/manage/items/' + it.id + qz, del ? { available: false, stock: 0 } : p); toast(del ? 'Marked unavailable' : 'Saved', 'ok'); }); load(); });
}, { ...opt, title: 'Shop stock' });

/* ---------- riders ---------- */
route('/manage/riders', async el => {
  el.innerHTML = skel(5, 56);
  async function draw() {
    const rs_ = await api.get('/api/manage/riders', zq()); if (!alive(el)) return;
    el.innerHTML = head('Riders', `${rs_.filter(r => r.online && r.status === 'approved').length} online now. Collect cash from riders daily and record it here.`) + (rs_.length ? `<div class="tbl"><table><thead><tr><th>Rider</th><th>Status</th><th>Online</th><th class="r">Today</th><th class="r">All trips</th><th class="r">Active</th><th class="r">Rating</th><th class="r">Cash in hand</th><th></th></tr></thead><tbody>${rs_.map(r => `<tr><td><b>${esc(r.name)}</b><br><span class="small mute">${esc(VEH[r.vehicle])} · +91 ${esc(r.phone)} · ${esc(zoneName(r.zoneId))}</span></td><td>${statusPill(r.status)}</td><td>${r.online ? '<span class="pill">Online</span>' : '<span class="pill g">Offline</span>'}</td><td class="r">${r.tripsToday}</td><td class="r">${r.trips}</td><td class="r">${r.active}</td><td class="r">${r.rating}</td><td class="r">${r.cashInHand ? `<b>${rs(r.cashInHand)}</b>` : '–'}</td><td><div class="row" style="gap:4px;justify-content:flex-end">${APP === 'admin' ? `<button class="btn sm" data-editr="${r.id}">Edit</button>` : ''}${r.cashInHand ? `<button class="btn sm" data-cash="${r.id}">Record deposit</button>` : ''}<a class="iconbtn" href="tel:+91${esc(r.phone)}" aria-label="Call ${esc(r.name)}">${icon('phone', 18)}</a></div></td></tr>`).join('')}</tbody></table></div>` : empty('No riders yet', 'Onboard riders from the Onboard tab.', 'bike'));
    el._rs = rs_;
  }
  el.addEventListener('click', async e => {
    const er = e.target.closest('[data-editr]'); if (er) { if (await editRiderSheet(el._rs.find(x => x.id === er.dataset.editr))) draw(); return; }
    const b = e.target.closest('[data-cash]'); if (!b) return; const r = el._rs.find(x => x.id === b.dataset.cash);
    const f = await ask(`Cash from ${r.name}`, field('amount', 'Amount received (₹)', { type: 'number', value: Math.round(r.cashInHand), attrs: `min="1" max="${r.cashInHand}"` }) + field('ref', 'Reference', { ph: 'UPI ref or "cash at office"' }), { ok: 'Record deposit' }); if (!f) return;
    try { await api.post(`/api/manage/riders/${r.id}/cash` + (zq().zone ? '?zone=' + zq().zone : ''), f); toast('Deposit recorded', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); }
  });
  live(draw); await draw();
}, { ...opt, title: 'Riders' });

/* ---------- orders ---------- */
export async function ordersView(el, title) {
  let st = 'live';
  async function draw() {
    const os = await api.get('/api/manage/orders', { ...zq(), status: st }); if (!alive(el)) return;
    if (st === 'live') setBadge('mneed', os.filter(o => o.needsRider).length);
    el.innerHTML = head(title, 'Every order in your area. Assign a rider when nobody has taken an order within a few minutes.') + `<div class="chips" style="margin-bottom:12px">${[['live', 'Live'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, t]) => `<button class="chip" data-st="${k}" aria-pressed="${st === k}">${t}</button>`).join('')}</div>
      ${os.length ? `<div class="tbl"><table><thead><tr><th>Order</th><th>Placed</th><th>Shop</th><th>Customer</th><th>Status</th><th>Rider</th><th class="r">Total</th><th></th></tr></thead><tbody>${os.map(o => `<tr><td><b>${esc(o.code)}</b><br><span class="small mute">${o.payment}</span></td><td class="num">${fmtDT(o.createdAt)}<br><span class="small mute">${ago(o.createdAt)}</span></td><td>${esc(o.vendor.name)}</td><td>${esc(o.customer?.name || '')}<br><span class="small mute">${esc(o.address.area)}</span></td><td>${statusPill(o.status)}${o.cancelReason ? `<br><span class="small mute">${esc(o.cancelReason)}</span>` : ''}</td><td>${o.rider ? esc(o.rider.name) : o.needsRider ? `<button class="btn sm go" data-assign="${o.id}">Assign</button>` : '–'}</td><td class="r">${rs(o.total)}</td><td>${['placed', 'accepted', 'ready', 'picked'].includes(o.status) ? `<button class="btn sm danger" data-cancel="${o.id}">Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty(st === 'live' ? 'No live orders' : 'No orders here', '', 'bell')}`;
  }
  el.addEventListener('click', async e => {
    const s = e.target.closest('[data-st]'); if (s) { st = s.dataset.st; return draw(); }
    const a = e.target.closest('[data-assign]'); if (a) { await assignRider(a.dataset.assign); return draw(); }
    const c = e.target.closest('[data-cancel]'); if (c) { const f = await ask('Cancel order', field('reason', 'Reason (the customer sees this)', { req: true, ph: 'e.g. Shop closed unexpectedly' }) + '<p class="small mute">Prepaid orders are refunded in full. Stock goes back to the shop unless the order was picked up.</p>', { ok: 'Cancel order', danger: true }); if (!f) return;
      try { await api.post(`/api/manage/orders/${c.dataset.cancel}/cancel` + (zq().zone ? '?zone=' + zq().zone : ''), f); toast('Order cancelled', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); } }
  });
  live(draw); await draw();
}
route('/manage/orders', el => ordersView(el, 'Orders'), { ...opt, title: 'Orders' });

/* ---------- field onboarding ---------- */
route('/manage/onboard', async el => {
  let kind = 'vendor';
  const draw = () => {
    el.innerHTML = head('Onboard in the field', 'Sitting with a shop owner or a new rider? Fill this in together. They go live straight away and log in with their mobile number.') + `<div class="seg" style="margin-bottom:18px">${[['vendor', 'Shop or restaurant'], ['rider', 'Delivery partner']].map(([k, t]) => `<button data-k="${k}" aria-pressed="${kind === k}" style="${kind === k ? 'background:var(--card);box-shadow:var(--shadow)' : ''}">${t}</button>`).join('')}</div><div class="card"><div id="pf"></div></div>`;
    partnerForm(el.querySelector('#pf'), kind, { mode: 'manager', onDone: r => { toast(kind === 'vendor' ? `${r.vendor.name} is live. Add their items now.` : `${r.rider.name} can log in and go online.`, 'ok'); nav(kind === 'vendor' ? '/manage/shop/' + r.vendor.id : '/manage/riders'); } });
  };
  el.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) { kind = b.dataset.k; draw(); } });
  draw();
}, { ...opt, title: 'Onboard' });

/* ---------- admin-only edits of a shop's or rider's details (used from the admin console) ---------- */
export async function editVendorSheet(v) {
  const f = await ask(`Edit ${v.name}`, field('name', 'Shop name', { req: true, value: v.name }) + field('ownerName', 'Owner name', { value: v.ownerName }) + field('phone', 'Shop phone', { type: 'tel', value: v.phone })
    + field('address', 'Address', { value: v.address }) + `<div class="grid2">${field('hours', 'Opening hours', { value: v.hours })}${field('prepMins', 'Prep time (min)', { type: 'number', value: v.prepMins })}</div>`
    + field('tags', 'Tags (comma separated)', { value: (v.tags || []).join(', ') }) + `<div class="grid2">${field('commission', 'Commission % (blank = default)', { type: 'number', value: v.commission ?? '', attrs: 'step="0.5" min="0" max="40"' })}${field('zoneId', 'Zone', { options: S.zones.map(z => [z.id, z.name]), value: v.zoneId })}</div>`
    + field('offer', 'Offer on card', { value: v.offer || '' }), { ok: 'Save shop' });
  if (!f) return false;
  try { await api.patch('/api/admin/vendors/' + v.id, f); toast('Shop saved', 'ok'); return true; } catch (x) { toast(x.message, 'err'); return false; }
}
export async function editRiderSheet(r) {
  const f = await ask(`Edit ${r.name}`, field('name', 'Full name', { req: true, value: r.name }) + field('zoneId', 'Zone', { options: S.zones.map(z => [z.id, z.name]), value: r.zoneId })
    + field('vehicle', 'Vehicle', { options: Object.entries(VEH), value: r.vehicle }) + field('shift', 'Preferred shift', { options: [['morning', 'Morning'], ['evening', 'Evening'], ['full', 'Full day']], value: r.shift }), { ok: 'Save rider' });
  if (!f) return false;
  try { await api.patch('/api/admin/riders/' + r.id, f); toast('Rider saved', 'ok'); return true; } catch (x) { toast(x.message, 'err'); return false; }
}
