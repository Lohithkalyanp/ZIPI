import { api } from './api.js';
import { S, store, routes, sections, setNav, refreshMe, setSession, logout, hasRole, user, cartCount, onCart, nav, notify, notifyOn, setTheme, APP, APPS, SESSION_KEY, permit } from './state.js';
import { $, esc, icon, toast, sheet, field, busy, initials, art, confirmBox } from './ui.js';
import { kmBetween } from './map.js';

/* ---------- each app loads only its own screens ---------- */
const MODULES = { customer: ['./customer.js', './partner.js', './support.js'], vendor: ['./vendor.js', './support.js'], rider: ['./rider.js', './support.js'],
  manager: ['./manager.js', './support.js', './staff.js'], admin: ['./manager.js', './admin.js', './support.js', './staff.js'] };
// and may only open its own pages, even if a shared module registered others
const OWN = {
  customer: p => !/^\/(vendor|rider|manage|admin)(\/|$)/.test(p),
  vendor: p => /^\/vendor(\/|$)/.test(p), rider: p => /^\/rider(\/|$)/.test(p),
  manager: p => /^\/manage(\/|$)/.test(p), admin: p => /^\/(admin|manage)(\/|$)/.test(p),
};
const HOME = APPS[APP].home;

let cur = null, stack = [], shellKey = null, liveTimer = null;
const useHash = () => api.mode === 'server';
const app = $('#app');

/* ---------- router ---------- */
function go(path, { replace = false } = {}) {
  if (useHash()) { const h = '#' + path; if (replace) history.replaceState(null, '', h); else if (location.hash !== h) history.pushState(null, '', h); }
  else if (!replace && cur && cur !== path) stack.push(cur);
  render(path);
}
function goBack(fallback = '/') { if (useHash() && history.length > 1 && stack.length !== -1) history.back(); else render(stack.pop() || fallback); }
setNav(go, goBack);
addEventListener('popstate', () => render(location.hash.slice(1) || '/'));

async function render(path = cur || '/', { soft = false } = {}) {
  let r = null, params = {};
  for (const x of routes) { const m = x.re.exec(path); if (m) { r = x; x.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1])); break; } }
  if (path !== '/login' && (!r || !OWN[APP](path))) return go(HOME === path ? '/login' : HOME, { replace: true });
  if (r.auth && !S.me) { S.after = path; return go('/login', { replace: true }); }
  if (r.role && !hasRole(r.role) && !(r.role === 'manager' && hasRole('admin'))) { toast(`This account cannot use the ${APPS[APP].name}`, 'err'); logout(); shellKey = null; return go('/login', { replace: true }); }
  const managePerm = APP === 'admin' && /^\/manage/.test(path) ? (/^\/manage(\/orders|\/map)?$/.test(path) ? 'orders' : 'partners') : null;
  if ((r.perm && !permit(r.perm)) || (managePerm && !permit(managePerm))) { toast('Your admin account does not have access to that page', 'err'); return go(path === HOME ? '/admin/access' : HOME, { replace: true }); }
  const isNew = path !== cur; cur = path; S.path = path; S.live = null;
  // the admin console reuses the zone manager's tools inside its own menu
  const secName = APP === 'admin' && r.section === 'manage' ? 'admin' : r.section;
  const key = r.shell === 'p' ? 'p:' + secName : r.shell || 'c';
  if (key !== shellKey) { shellKey = key; app.innerHTML = r.shell === 'none' ? `${demoBar()}<div id="view"></div>` : r.shell === 'p' ? partnerShell(secName) : customerShell(); bindShell(); }
  markNav(path);
  const old = $('#view'), view = document.createElement(old.tagName); view.id = 'view'; view.className = old.className.replace(' page', '') + (soft ? '' : ' page');
  old.replaceWith(view);
  if (isNew && !soft) scrollTo({ top: 0 });
  try { await r.view(view, params); } catch (e) { console.error(e); view.innerHTML = `<div class="empty">${icon('alert', 44)}<b>Could not load this page</b>${esc(e.message)}<div style="margin-top:12px"><button class="btn" data-go="${esc(path)}">Try again</button></div></div>`; }
  document.title = (r.title ? r.title + ' · ' : '') + APPS[APP].title;
}
// rider GPS pings are frequent: only maps listen to them (via api.on), page redraws ignore them
api.on(e => { if (e.type === 'rider_pos' || !S.live) return; clearTimeout(liveTimer); liveTimer = setTimeout(() => S.live && S.live(e), 250); });

/* ---------- background notifications for order changes ---------- */
const NOTE = { accepted: o => [`${o.vendor.name} accepted your order`, o.vendorType === 'store' ? 'Your items are being packed.' : 'Your food is being prepared.'],
  ready: o => ['Order packed', o.rider ? `${o.rider.name.split(' ')[0]} is picking it up.` : 'Assigning a delivery partner.'], picked: o => ['On the way!', `${o.rider?.name?.split(' ')[0] || 'Your rider'} has your order. Keep your OTP ready.`],
  delivered: () => ['Delivered. Enjoy!', 'Tap to rate your order and earn feedback rewards.'], cancelled: o => ['Order cancelled', o.cancelReason || ''], rejected: o => [`${o.vendor.name} couldn't take your order`, o.cancelReason || ''],
  placed: o => o.scheduleAt ? ['Your scheduled order is on its way to the shop', `${o.vendor.name} will start preparing it now.`] : null };
const seen = new Map();
api.on(async e => {
  if (e.type !== 'order' || !e.id || !e.status || !notifyOn() || !S.me) return;
  const key = e.id + e.status; if (seen.has(key)) return; seen.set(key, 1);
  const here = S.path === '/order/' + e.id || (S.path === '/vendor' && !document.hidden);
  if (here && !document.hidden) return;
  try {
    const o = await api.get('/api/orders/' + e.id);
    if (APP === 'customer' && o.customerId === user().id) { const n = NOTE[o.status]?.(o); if (n) notify(n[0], `${o.code} · ${n[1]}`, '/#/order/' + o.id); }
    else if (APP === 'vendor' && o.status === 'placed' && S.me.vendor?.id === o.vendorId) notify(`New order ${o.code}`, `${o.items.reduce((a, l) => a + l.qty, 0)} items · ₹${Math.round(o.subtotal)} · accept within a few minutes`, '/shop#/vendor');
    else if (APP === 'rider' && S.me.rider && o.rider?.id === S.me.rider.id && o.status === 'accepted') notify(`Order ${o.code} assigned to you`, `Pick up from ${o.vendor.name}`, '/rider#/rider');
  } catch { }
});

/* ---------- shells ---------- */
function demoBar() {
  if (api.mode !== 'local') return '';
  return `<div class="demo">${icon('info', 16)}<span>Demo mode: the full backend is running inside this browser. Run <b>node server.js</b> for the real multi-device app.</span><button data-act="demo-reset">Reset demo data</button></div>`;
}
const zoneName = () => { const a = S.me?.user?.addresses?.find(x => x.id === S.addressId); const z = S.zones.find(z => z.id === (a?.zoneId || S.zoneId)); return { z, a }; };
function customerShell() {
  const items = [['/', 'Home', 'home'], ['/search', 'Search', 'search'], ['/cart', 'Cart', 'bag'], ['/orders', 'Orders', 'clock'], ['/account', 'Account', 'user']];
  return `${demoBar()}<header class="c-top"><div class="inner"><span class="brandmark" aria-label="ZIPI">ZIPI</span><button class="loc" data-act="zone" id="locbtn"></button>
    <nav class="dnav" aria-label="Main">${items.map(([p, t, i]) => `<a href="#${p}" data-go="${p}" data-nav="${p}">${icon(i, 18)}${t}${p === '/cart' ? ' <span class="pill t num" data-cartn hidden></span>' : ''}</a>`).join('')}</nav>
    <button class="avatar" data-go="/account" aria-label="Account" id="avbtn"></button></div></header>
    <main class="c-main" id="view"></main>
    <nav class="bnav" aria-label="Main">${items.map(([p, t, i]) => `<a href="#${p}" data-go="${p}" data-nav="${p}">${icon(i, 22)}<span>${t}</span>${p === '/cart' ? '<span class="dot" data-cartn hidden></span>' : ''}</a>`).join('')}</nav>`;
}
// staff apps: their own sidebar only. No links into other apps: each one is separate and has its own login.
function partnerShell(name) {
  const sec = sections[name], items = sec.items.filter(it => permit(it[4]));
  const u = user(), who = APP === 'admin' ? ((u?.perms || []).includes('*') ? 'Super admin' : 'Admin') : APP === 'manager' ? (S.zones.find(z => z.id === u?.zoneId)?.name || 'Zone manager') : APP === 'vendor' ? (S.me?.vendor?.name || 'Shop') : 'Delivery partner';
  return `${demoBar()}<div class="p-shell"><aside class="p-side"><span class="brandmark">ZIPI</span><span class="appname">${icon(APPS[APP].icon, 14)} ${esc(APPS[APP].name)}</span>
    ${items.map(([p, t, i, b]) => `<a href="#${p}" data-go="${p}" data-nav="${p}">${icon(i, 18)}<span>${t}</span>${b ? `<span class="badge" data-badge="${b}" hidden></span>` : ''}</a>`).join('')}
    <div class="whoami"><div class="avatar">${esc(initials(u?.name || 'Z'))}</div><span><b>${esc(u?.name || '')}</b><small>${esc(who)}</small></span></div></aside>
    <div><header class="p-top"><span class="brandmark" style="font-size:22px">ZIPI</span><span class="role">${esc(APPS[APP].name)}</span><span class="grow"></span>
      <button class="avatar" data-act="usermenu" aria-label="Account">${esc(initials(u?.name || 'Z'))}</button></header>
    <main class="p-main" id="view"></main></div>
    <nav class="p-tabs" aria-label="Sections">${items.map(([p, t, i, b]) => `<a href="#${p}" data-go="${p}" data-nav="${p}">${icon(i, 22)}<span>${t}</span>${b ? `<span class="badge" data-badge="${b}" hidden></span>` : ''}</a>`).join('')}</nav></div>`;
}
function bindShell() { updateCustomerBar(); updateCartBadge(); }
export function updateCustomerBar() {
  const lb = $('#locbtn'); if (lb) { const { z, a } = zoneName(), h = !a && S.here;
    const top = a ? a.label : h ? h.area : z ? z.name : 'Choose location', sub = a ? `${a.line}, ${a.area}` : h ? [h.line, h.city].filter(Boolean).join(', ') || 'Current location' : z ? `${z.name}, ${z.city}` : 'Set your delivery location';
    lb.innerHTML = `${icon(h ? 'locate' : 'pin', 22, 'style="color:var(--tom)"')}<span><b>${esc(top)} ${icon('chevD', 16)}</b><small>${esc(sub)}</small></span>`; }
  const av = $('#avbtn'); if (av) av.innerHTML = S.me ? esc(initials(user().name || 'Me')) : icon('user', 20);
}
function updateCartBadge() { const n = cartCount(); document.querySelectorAll('[data-cartn]').forEach(e => { e.hidden = !n; e.textContent = n; }); }
onCart(updateCartBadge);
export function setBadge(k, n) { document.querySelectorAll(`[data-badge="${k}"]`).forEach(e => { e.hidden = !n; e.textContent = n; }); }
function markNav(path) {
  document.querySelectorAll('[data-nav]').forEach(a => {
    const p = a.dataset.nav, on = p === path || (p !== '/' && path.startsWith(p + '/')) || (p === '/' && (path === '/' || path.startsWith('/v/')));
    const exact = [...document.querySelectorAll('[data-nav]')].some(b => b.dataset.nav !== p && b.dataset.nav.length > p.length && path.startsWith(b.dataset.nav));
    if (on && !exact) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

export const themeSeg = t => `<div class="chips" role="group" aria-label="Appearance">${[['system', 'Auto', 'spark'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([k, l, i]) => `<button type="button" class="chip" data-act="theme" data-t="${k}" aria-pressed="${t === k}">${icon(i, 14)} ${l}</button>`).join('')}</div>`;

/* ---------- delivery location: detect, search, saved addresses (customer app) ---------- */
const ZONE_KM = 8; // how far from a zone centre we deliver
const nearestZone = ll => S.zones.filter(z => z.active && z.lat != null).map(z => [z, kmBetween(ll, z)]).sort((a, b) => a[1] - b[1])[0] || null;
const getPos = () => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error('Location is not available on this device. Search for your area instead.'));
  if (!isSecureContext) return rej(new Error('Location needs a secure (https) connection'));
  navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
    e => rej(new Error(e.code === 1 ? 'Location permission is off. Allow it in your browser settings, or search for your area.' : 'Could not get your location. Try again or search for your area.')),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
});
export function selectAddress(ad) { S.addressId = ad.id; S.zoneId = ad.zoneId; store.set('addr', ad.id); store.set('zone', ad.zoneId); }
/** deliver to this spot (detected or searched). Returns { ok } or { outside, km, zone } */
export async function useSpot(ll, known = {}) {
  const near = nearestZone(ll);
  if (!near || near[1] > ZONE_KM) return { outside: true, km: near?.[1], zone: near?.[0] };
  const r = known.area ? known : await api.get('/api/maps/reverse', ll).catch(() => null) || {};
  S.here = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), area: r.area || near[0].name, line: r.road || '', city: r.city || near[0].city, zoneId: near[0].id, at: Date.now() };
  store.set('here', S.here); S.zoneId = near[0].id; store.set('zone', S.zoneId);
  const saved = (S.me?.user?.addresses || []).find(a => a.lat != null && kmBetween(a, ll) < 0.15); // already saved this place
  if (saved) selectAddress(saved); else { S.addressId = null; store.del('addr'); }
  return { ok: true };
}
const outsideMsg = o => o.zone ? `You're ${o.km.toFixed(1)} km from ${o.zone.name}. ZIPI doesn't deliver there yet. Join the waitlist below.` : "ZIPI doesn't deliver there yet. Join the waitlist below.";

/** "Change location" sheet: current location, search, saved addresses (add / edit), areas, waitlist */
export function zoneSheet(onPick) {
  const addrs = S.me?.user?.addresses || [];
  const s = sheet(`<div class="search addrsearch" style="box-shadow:none;min-height:46px">${icon('search', 18)}<input id="lsq" placeholder="Search for area, street name…" autocomplete="off" aria-label="Search for your area"></div><div id="lsr" class="asr"></div>
    <button class="addr locnow" data-here>${icon('locate', 22, 'style="color:var(--tom)"')}<span class="grow"><b style="color:var(--tom)">Use my current location</b><br><span class="small mute">${S.here && !S.addressId ? esc([S.here.line, S.here.area].filter(Boolean).join(', ')) : 'Using GPS'}</span></span>${icon('chevR', 18)}</button>
    <button class="addr" data-new>${icon('plus', 22)}<span class="grow"><b>Add new address</b><br><span class="small mute">${S.me ? 'Save home, work or any place' : 'Log in to save addresses'}</span></span>${icon('chevR', 18)}</button>
    ${addrs.length ? `<h3 style="margin:18px 0 8px">Saved addresses</h3><div class="stack">${addrs.map(a => `<div class="addr" style="padding:0"><button class="addr grow" style="border:0" data-addr="${a.id}" aria-pressed="${a.id === S.addressId}">${icon(a.label === 'Work' ? 'store' : 'home', 22)}<span><b>${esc(a.label)}</b>${S.me.user.defaultAddress === a.id ? ' <span class="pill">Default</span>' : ''}<br><span class="small mute">${esc([a.line, a.building, a.area].filter(Boolean).join(', '))}</span></span></button><button class="btn ghost sm" data-edit="${a.id}" aria-label="Edit ${esc(a.label)}">Edit</button></div>`).join('')}</div>` : ''}
    <h3 style="margin:18px 0 8px">Areas we deliver to</h3><div class="stack">${S.zones.map(z => `<button class="addr" data-zone="${z.id}" ${z.active ? '' : 'data-soon="1"'} aria-pressed="${!S.addressId && !S.here && z.id === S.zoneId}">${icon('pin', 22)}<span class="grow"><b>${esc(z.name)}</b><br><span class="small mute">${esc(z.city)}</span></span>${z.active ? '' : '<span class="pill w">Coming soon</span>'}</button>`).join('')}</div>
    <div class="card" style="margin-top:18px;background:var(--sunk);border:0"><b>Not in these areas?</b><p class="small mute" style="margin:4px 0 0">Tell us where you are. We open new areas where most people ask.</p>
    <form id="wl">${field('area', 'Your area', { req: true, ph: 'e.g. Nipania' })}${field('phone', 'Mobile number', { req: true, type: 'tel', ph: '10 digits', value: user()?.phone || '' })}${field('want', 'What would you order?', { options: [['Both', 'Food and groceries'], ['Food', 'Food'], ['Groceries', 'Groceries'], ['Medicines', 'Medicines']] })}
    <button class="btn go block" style="margin-top:12px">Notify me when ZIPI arrives</button></form></div>`, { title: 'Change location' });
  const done = () => { s.close(); updateCustomerBar(); onPick?.(); };
  const outside = (o, area) => { toast(outsideMsg(o), 'err'); if (area) s.el.querySelector('#wl [name=area]').value = area; s.el.querySelector('#wl').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  // search (OpenStreetMap)
  const sq = s.el.querySelector('#lsq'), sr = s.el.querySelector('#lsr'); let sT = null;
  sq.oninput = () => { clearTimeout(sT); const q = sq.value.trim(); if (q.length < 3) { sr.innerHTML = ''; return; }
    sT = setTimeout(async () => { const list = await api.get('/api/maps/search', { q, zone: S.zoneId }).catch(() => []); sr._list = list;
      sr.innerHTML = list.length ? list.map((r, i) => `<button type="button" class="li" data-res="${i}">${icon('pin', 16)}<span class="small">${esc(r.label)}</span></button>`).join('') : '<p class="small mute">No matches. Try another spelling or a nearby landmark.</p>'; }, 450); };
  s.el.addEventListener('click', async e => {
    const t = e.target.closest('[data-res],[data-here],[data-new],[data-addr],[data-edit],[data-zone]'); if (!t) return;
    if (t.dataset.res != null) { const r = sr._list[+t.dataset.res]; const o = await useSpot(r, r.area ? r : {}); return o.ok ? done() : outside(o, r.area || r.label.split(',')[0]); }
    if (t.hasAttribute('data-here')) { busy(t, true); try { const o = await useSpot(await getPos()); busy(t, false); return o.ok ? done() : outside(o); } catch (x) { busy(t, false); return toast(x.message, 'err'); } }
    if (t.hasAttribute('data-new')) { if (!S.me) { s.close(); S.after = S.path; return go('/login'); }
      const { addAddressSheet } = await import('./customer.js'); s.close(); const ad = await addAddressSheet(S.zoneId); if (ad) { selectAddress(ad); updateCustomerBar(); onPick?.(); } return; }
    if (t.dataset.edit) { const { addAddressSheet } = await import('./customer.js'); s.close(); const ad = await addAddressSheet(null, addrs.find(x => x.id === t.dataset.edit)); if (ad && ad.id === S.addressId) selectAddress(ad); updateCustomerBar(); onPick?.(); return; }
    if (t.dataset.addr) { selectAddress(addrs.find(x => x.id === t.dataset.addr)); return done(); }
    if (t.dataset.zone) { if (t.dataset.soon) { toast('Not live yet. Join the waitlist below.'); s.el.querySelector('#wl [name=area]').value = S.zones.find(x => x.id === t.dataset.zone).name; return; }
      S.zoneId = t.dataset.zone; S.addressId = null; S.here = null; store.set('zone', S.zoneId); store.del('addr'); store.del('here'); done(); }
  });
  s.el.querySelector('#wl').onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true); const f = Object.fromEntries(new FormData(e.target));
    try { await api.post('/api/waitlist', f); toast(`Thanks! We'll message you when ZIPI reaches ${f.area}.`, 'ok'); s.close(); } catch (x) { toast(x.message, 'err'); } busy(b, false); };
}

/** first visit: find where to deliver, like Swiggy / Blinkit. Silent if location is already allowed. */
async function locationGate() {
  if (APP !== 'customer' || S.addressId || S.here) return;
  const addrs = S.me?.user?.addresses || [];
  if (addrs.length) { selectAddress(addrs.find(a => a.id === S.me.user.defaultAddress) || addrs[0]); updateCustomerBar(); return render(cur, { soft: true }); }
  const granted = await navigator.permissions?.query({ name: 'geolocation' }).then(p => p.state === 'granted').catch(() => false);
  if (granted) { try { const o = await useSpot(await getPos()); if (o.ok) { updateCustomerBar(); return render(cur, { soft: true }); } } catch { } }
  if (store.get('locAsked', false)) return;
  store.set('locAsked', true);
  const s = sheet(`<div style="text-align:center;padding:6px 4px 2px"><div style="color:var(--tom)">${icon('locate', 56)}</div><h2 style="margin:10px 0 4px">Where should we deliver?</h2>
    <p class="mute" style="margin:0 0 18px">Turn on location to see shops, delivery times and offers for your exact address.</p>
    <button class="btn go big block" data-gate="gps">${icon('locate', 18)} Use my current location</button>
    <button class="btn ghost big block" style="margin-top:8px" data-gate="pick">${icon('search', 18)} Search or choose area</button></div>`, { title: '' });
  s.el.addEventListener('click', async e => { const b = e.target.closest('[data-gate]'); if (!b) return;
    if (b.dataset.gate === 'pick') { s.close(); return zoneSheet(() => render(cur, { soft: true })); }
    busy(b, true);
    try { const o = await useSpot(await getPos()); busy(b, false); s.close(); if (o.ok) { updateCustomerBar(); toast(`Delivering to ${S.here.area}`, 'ok'); render(cur, { soft: true }); } else { toast(outsideMsg(o), 'err'); zoneSheet(() => render(cur, { soft: true })); } }
    catch (x) { busy(b, false); toast(x.message, 'err'); }
  });
}


/* ---------- login ---------- */
// test accounts, shown only while dev OTP is on, and only the ones for this app
const DEMO = { customer: [['9000000006', 'Riya Sharma', 'Customer with saved addresses']], vendor: [['9000000003', 'Saffron Biryani House', 'Restaurant owner'], ['9000000004', 'Sharma Kirana Store', 'Grocery shop owner']],
  rider: [['9000000005', 'Ravi Kumar', 'Rider, Vijay Nagar'], ['9100000041', 'Imran Sheikh', 'Rider, Vijay Nagar']], manager: [['9000000002', 'Vikram Rathore', 'Manager, Vijay Nagar'], ['9000000007', 'Sneha Kulkarni', 'Manager, Palasia']],
  admin: [['9000000001', 'Anita Joshi', 'Super admin, head office']] }[APP];
const LOGIN = { customer: ['Your neighbourhood, delivered.', 'Food from local kitchens and groceries from the shops you already trust, at your door in about 20 minutes.'],
  vendor: ['Run your shop on ZIPI.', 'Accept orders, manage your menu and stock, and track earnings and payouts.'], rider: ['Deliver in your own neighbourhood.', 'Go online, take nearby orders and see your earnings and shifts.'],
  manager: ['Keep your zone running.', 'Approve partners, watch live orders and riders, and keep stock right.'], admin: ['ZIPI control centre.', 'Business, access control, partners, money and data in one place. Authorised staff only.'] }[APP];
import { route } from './state.js';
route('/login', async el => {
  if (S.me) return go(S.after || HOME, { replace: true });
  el.innerHTML = `<div class="login ${APP === 'customer' ? '' : 'staff'}"><div class="art"><span class="brandmark" style="color:var(--mari);font-size:34px">ZIPI${APP === 'customer' ? '' : ` <small class="appbadge">${esc(APPS[APP].name)}</small>`}</span><div><h1>${LOGIN[0]}</h1><p>${LOGIN[1]}</p></div>
    <svg class="scene" viewBox="0 0 400 200" aria-hidden="true">${[['biryani', '#7a3b12', 0, 60], ['pizza', '#a3201c', 110, 20], ['basket', '#0b6e4f', 220, 70], ['cake', '#9d174d', 300, 10]].map(([k, c, x, y]) => `<g transform="translate(${x} ${y})"><foreignObject width="110" height="110"><div xmlns="http://www.w3.org/1999/xhtml" style="width:110px;height:110px;border-radius:28px;overflow:hidden;box-shadow:0 10px 30px #0006">${art(k, c, { ratio: 'square' })}</div></foreignObject></g>`).join('')}</svg></div>
    <div class="form"><div id="step"></div></div></div>`;
  const stepEl = el.querySelector('#step');
  const phoneStep = (phone = '', mode = 'login', pre = {}) => {
    const cust = APP === 'customer', up = cust && mode === 'signup';
    stepEl.innerHTML = `${cust ? `<div class="chips authtabs" role="tablist" style="margin-bottom:14px"><button type="button" class="chip" role="tab" data-mode="login" aria-selected="${!up}" aria-pressed="${!up}">Log in</button><button type="button" class="chip" role="tab" data-mode="signup" aria-selected="${up}" aria-pressed="${up}">Sign up</button></div>` : ''}
      <h2>${up ? 'Create your ZIPI account' : cust ? 'Log in' : `Log in to ${esc(APPS[APP].name)}`}</h2><p class="mute">${up ? "Just your name and number. We'll send a 6-digit code to verify it." : cust ? "Enter your number. We'll send a 6-digit code." : 'Only numbers registered for this app can log in. We\'ll send a 6-digit code.'}</p><form id="pf">
      ${up ? `<label class="f" for="snm"><span>Full name</span><input class="in" id="snm" name="name" maxlength="60" placeholder="Your name" value="${esc(pre.name || '')}" autocomplete="name" required></label>` : ''}
      <label class="f" for="ph"><span>Mobile number</span><div class="row"><span class="in" style="width:auto;display:grid;place-items:center;flex:none">+91</span><input class="in" id="ph" name="phone" type="tel" inputmode="numeric" maxlength="10" placeholder="98XXXXXXXX" value="${esc(phone)}" autocomplete="tel-national" required></div></label>
      ${up ? `<label class="f" for="sref"><span>Referral code (optional)</span><input class="in" id="sref" name="ref" maxlength="12" placeholder="ZIPIXXXXX" value="${esc(pre.ref || store.get('ref', ''))}" style="text-transform:uppercase"></label>` : ''}
      <button class="btn go big block" style="margin-top:16px">${up ? 'Create account' : 'Send OTP'}</button></form>
      ${cust ? `<p class="small" style="margin-top:12px;text-align:center">${up ? 'Already have an account?' : 'New to ZIPI?'} <button type="button" class="btn ghost sm" data-mode="${up ? 'login' : 'signup'}">${up ? 'Log in' : 'Create an account'}</button></p>` : ''}
      <p class="small mute" style="margin-top:14px">By continuing you agree to ZIPI's terms and privacy policy.</p>
      ${APP === 'vendor' || APP === 'rider' ? `<p class="small mute">New ${APP === 'vendor' ? 'shop' : 'rider'}? Apply in the <a href="/">ZIPI app</a> under "Partner with us". You can log in here once you're approved.</p>` : ''}
      ${S.config?.devMode ? `<div style="margin-top:22px"><b>Test accounts</b><p class="small mute" style="margin:2px 0 0">Shown only while dev OTP is on. The code appears on screen.</p><div class="demoacc">${DEMO.map(([p, t, d]) => `<button type="button" data-demo="${p}"><b>${t}</b><span class="mute">${d}</span></button>`).join('')}</div></div>` : ''}`;
    const f = stepEl.querySelector('#pf');
    const send = async (ph, auto) => { const b = f.querySelector('button.go'); const extra = up ? { name: f.name.value.trim(), ref: f.ref.value.trim(), mode } : { mode };
      if (up && !extra.name) return toast('Enter your name', 'err');
      busy(b, true);
      try { const r = await api.post('/api/auth/otp', { phone: ph, app: APP }); otpStep(ph, r.devOtp, auto, extra); } catch (x) { toast(x.message, 'err'); busy(b, false); } };
    f.onsubmit = e => { e.preventDefault(); send(f.phone.value.trim()); };
    stepEl.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => phoneStep(f.phone.value.trim(), b.dataset.mode, up ? {} : { name: '' }));
    stepEl.querySelectorAll('[data-demo]').forEach(b => b.onclick = () => { f.phone.value = b.dataset.demo; send(b.dataset.demo, true); });
  };
  const otpStep = (phone, dev, auto, extra = {}) => {
    stepEl.innerHTML = `<button class="btn ghost sm" data-back>${icon('chevL', 16)} Change number</button><h2 style="margin-top:8px">Enter the code</h2><p class="mute">Sent to +91 ${esc(phone)}</p>
      ${dev ? `<div class="saved" style="margin:10px 0">${icon('info', 18)} Test mode: your code is <span class="num">${esc(dev)}</span></div>` : ''}
      <form id="of"><div class="otpin">${Array.from({ length: 6 }, (_, i) => `<input inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" ${i === 0 ? 'autocomplete="one-time-code"' : ''}>`).join('')}</div>
      <label class="f" for="nm" id="nmw" hidden><span>Your name</span><input class="in" id="nm" placeholder="So shops and riders know who to ask for"></label>
      <details class="refbox" ${APP === 'customer' && extra.mode !== 'signup' ? '' : 'hidden'} ${store.get('ref', '') ? 'open' : ''}><summary class="small">Have a referral code?</summary><input class="in" id="refc" maxlength="12" placeholder="ZIPIXXXXX" value="${esc(store.get('ref', ''))}" style="text-transform:uppercase;margin-top:6px" aria-label="Referral code"><div class="hint">New accounts only. You both get ZIPI coins after your first delivery.</div></details>
      <button class="btn go big block" style="margin-top:16px">Verify and continue</button></form><p class="small mute" style="text-align:center;margin-top:12px"><button class="btn ghost sm" data-resend>Resend code</button></p>`;
    const ins = [...stepEl.querySelectorAll('.otpin input')];
    const fill = d => { d.slice(0, 6).split('').forEach((c, j) => ins[j].value = c); ins[5].focus(); stepEl.querySelector('#of').requestSubmit(); };
    // Android Chrome: read the code straight from the SMS (WebOTP), when the SMS ends with "@our-domain #123456"
    if ('OTPCredential' in window && !dev) {
      const ac = new AbortController(); setTimeout(() => ac.abort(), 5 * 60000);
      new MutationObserver((_, ob) => { if (!document.body.contains(ins[0])) { ac.abort(); ob.disconnect(); } }).observe(stepEl, { childList: true });
      navigator.credentials.get({ otp: { transport: ['sms'] }, signal: ac.signal }).then(c => { if (c?.code && document.body.contains(ins[0])) fill(c.code); }).catch(() => {});
    }
    ins.forEach((inp, i) => {
      inp.oninput = () => { const d = inp.value.replace(/\D/g, '');
        if (d.length >= 6) return fill(d); // iOS "From Messages" and password managers put the whole code in one box
        inp.value = d.slice(-1); if (inp.value && ins[i + 1]) ins[i + 1].focus(); if (ins.every(x => x.value)) stepEl.querySelector('#of').requestSubmit(); };
      inp.onkeydown = e => { if (e.key === 'Backspace' && !inp.value && ins[i - 1]) ins[i - 1].focus(); };
      inp.onpaste = e => { const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); if (t.length === 6) { e.preventDefault(); t.split('').forEach((c, j) => ins[j].value = c); stepEl.querySelector('#of').requestSubmit(); } };
    });
    ins[0].focus();
    stepEl.querySelector('[data-back]').onclick = () => phoneStep(phone, extra.mode, extra);
    stepEl.querySelector('[data-resend]').onclick = async () => { try { const r = await api.post('/api/auth/otp', { phone, app: APP }); toast('New code sent', 'ok'); otpStep(phone, r.devOtp, false, extra); } catch (x) { toast(x.message, 'err'); } };
    stepEl.querySelector('#of').onsubmit = async e => {
      e.preventDefault(); const code = ins.map(x => x.value).join(''); if (code.length < 6) return;
      const b = e.target.querySelector('button.go'); busy(b, true);
      try {
        const refCode = extra.ref || stepEl.querySelector('#refc')?.value.trim();
        const r = await api.post('/api/auth/verify', { phone, code, app: APP, name: extra.name || stepEl.querySelector('#nm').value, ref: APP === 'customer' ? refCode || undefined : undefined });
        if (extra.mode === 'signup' && !r.isNew) setTimeout(() => toast('This number already has a ZIPI account, so we logged you in.'), 1200);
        if (r.isNew && refCode) { store.del('ref'); setTimeout(() => toast('Referral code saved. Coins arrive after your first delivery.', 'ok'), 1200); }
        setSession(r.token, { user: r.user, vendor: r.vendor, rider: r.rider, zone: r.zone });
        if (!r.user.name && APP === 'customer') { busy(b, false); const nm = await new Promise(res => { const s = sheet(`<form>${field('name', 'Your name', { req: true, ph: 'Full name' })}<button class="btn go block" style="margin-top:14px">Continue</button></form>`, { title: 'Create your account', onClose: () => res('') }); s.el.querySelector('form').onsubmit = ev => { ev.preventDefault(); res(ev.target.name.value); s.close(); }; });
          if (nm) { const m = await api.patch('/api/me', { name: nm }).catch(() => null); if (m) S.me = m; } }
        const a = S.me.user.addresses?.[0]; if (a && !S.addressId) { S.addressId = a.id; S.zoneId = a.zoneId; store.set('addr', a.id); store.set('zone', a.zoneId); }
        toast(`${r.isNew ? 'Welcome to ZIPI' : 'Welcome back'}${S.me.user.name ? ', ' + S.me.user.name.split(' ')[0] : ''}!`, 'ok');
        // new customer: save where to deliver right away (starts from the detected location)
        if (APP === 'customer' && !S.me.user.addresses?.length) { const { addAddressSheet } = await import('./customer.js');
          toast('Save your delivery address so we know where to come'); const ad = await addAddressSheet(S.here?.zoneId || S.zoneId); if (ad) selectAddress(ad); }
        const dest = S.after && OWN[APP](S.after) ? S.after : HOME;
        S.after = null; shellKey = null; go(dest, { replace: true });
      } catch (x) { toast(x.message, 'err'); busy(b, false); ins.forEach(i => i.value = ''); ins[0].focus(); }
    };
    if (auto && dev) { dev.split('').forEach((c, j) => setTimeout(() => { ins[j].value = c; if (j === 5) setTimeout(() => stepEl.querySelector('#of').requestSubmit(), 250); }, 90 * j)); }
  };
  phoneStep();
}, { shell: 'none', title: 'Log in' });

/* ---------- global events ---------- */
document.addEventListener('click', async e => {
  const g = e.target.closest('[data-go]');
  if (g && !e.defaultPrevented) { e.preventDefault(); go(g.dataset.go); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'zone') zoneSheet(() => render(cur, { soft: true }));
  if (act === 'demo-reset') { if (confirm('Reset all demo data in this browser?')) api.resetDemo(); }
  if (act === 'usermenu') { const t = store.get('theme', 'system'); sheet(`<div class="li"><span><b>${esc(user()?.name || '')}</b><br><span class="small mute">+91 ${esc(user()?.phone || '')} · ${esc(APPS[APP].name)}</span></span></div>
    <div class="f"><span>Appearance</span>${themeSeg(t)}</div><button class="btn danger block" data-act="logout" style="margin-top:8px">${icon('logout', 18)} Log out</button>${api.mode === 'server' ? `<button class="btn ghost block" data-act="logoutall" style="margin-top:8px">${icon('lock', 18)} Log out on all devices</button>` : ''}`, { title: 'Account' }); }
  if (act === 'logoutall') { if (!(await confirmBox('Log out of every ZIPI app on every device? You will need a new code to log in again.', { ok: 'Log out everywhere', danger: true }))) return;
    try { await api.post('/api/auth/logout-all'); } catch { } logout(); location.hash = '#/login'; location.reload(); }
  if (act === 'theme') { setTheme(a.dataset.t); a.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === a)); }
  if (act === 'logout') { logout(); document.querySelectorAll('.backdrop').forEach(b => b.remove()); shellKey = null; toast('Logged out'); go(APP === 'customer' ? '/' : '/login', { replace: true }); }
});

/* ---------- boot ---------- */
(async () => {
  app.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center"><span class="brandmark" style="font-size:54px;animation:pop .6s var(--spring)">ZIPI</span></div>`;
  const ref = new URLSearchParams(location.search).get('ref'); if (ref && /^[A-Z0-9]{4,12}$/i.test(ref)) store.set('ref', ref.toUpperCase());
  document.title = APPS[APP].title;
  document.querySelector('link[rel=manifest]')?.setAttribute('href', '/app.webmanifest?a=' + APP);
  const [, ...mods] = await Promise.all([api.init(), ...MODULES[APP].map(m => import(m))]);
  if (api.mode === 'server' && 'serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const tok = store.get(SESSION_KEY, null); if (tok) { api.setToken(tok); await refreshMe(); }
  // a login made for another app is never accepted here (the server refuses it for this app's data too)
  if (S.me && S.me.app && S.me.app !== APP) logout();
  try { [S.zones, S.config] = await Promise.all([api.get('/api/zones'), api.get('/api/config', { zone: S.zoneId })]); } catch (x) { toast(x.message, 'err'); }
  const a = S.me?.user?.addresses?.find(x => x.id === S.addressId);
  if (!a) S.addressId = null;
  if (S.here && (a || !S.zones.find(z => z.id === S.here.zoneId && z.active))) { S.here = a ? S.here : null; if (!S.here) store.del('here'); }
  if (!S.zoneId || !S.zones.find(z => z.id === S.zoneId && z.active)) S.zoneId = a?.zoneId || S.here?.zoneId || S.zones.find(z => z.active)?.id || null;
  if (APP === 'customer') api.post('/api/events', { type: 'app_open', zoneId: S.zoneId }).catch(() => {});
  const start = useHash() ? (location.hash.slice(1) || HOME) : HOME;
  await render(start === '/' && APP !== 'customer' ? HOME : start);
  if (APP === 'customer' && cur !== '/login') locationGate().catch(() => {});
})();
export { render };
