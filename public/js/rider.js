// Delivery partner app: go online, take orders, pick up, deliver with OTP, see earnings.
import { api } from './api.js';
import { S, route, section, live } from './state.js';
import { esc, rs, icon, toast, confirmBox, busy, empty, skel, fmtTime, fmtDT, fmtDate, ago, beep, cols, statusPill, confetti } from './ui.js';
import { setBadge } from './main.js';
import { directionsUrl } from './map.js';

section('rider', { title: 'Rider app', home: '/rider', items: [['/rider', 'Deliveries', 'bike', 'ravail'], ['/rider/shifts', 'Shifts', 'cal'], ['/rider/earnings', 'Earnings', 'wallet'], ['/rider/history', 'History', 'clock'], ['/rider/help', 'Help', 'info']] });

/* ---------- live GPS: shared with customers and managers while online (needs https or localhost) ---------- */
const gps = { watch: null, last: null, sentAt: 0, state: 'off' };
const gpsOk = () => !!navigator.geolocation && isSecureContext;
function startGPS() {
  if (gps.watch !== null || !gpsOk()) { if (!gpsOk()) gps.state = 'unavailable'; return; }
  gps.state = 'waiting';
  gps.watch = navigator.geolocation.watchPosition(p => {
    const ll = { lat: p.coords.latitude, lng: p.coords.longitude }, t = Date.now();
    const moved = !gps.last || Math.hypot((ll.lat - gps.last.lat) * 111000, (ll.lng - gps.last.lng) * 102000) > 40;
    gps.state = 'on'; document.querySelectorAll('[data-gps]').forEach(e => { e.className = 'pill'; e.innerHTML = '<span class="live"></span> GPS sharing'; });
    if ((moved && t - gps.sentAt > 5000) || t - gps.sentAt > 20000) { gps.last = ll; gps.sentAt = t; api.post('/api/rider/location', { ...ll, accuracy: p.coords.accuracy }).catch(() => {}); }
  }, err => { gps.state = err.code === 1 ? 'denied' : 'error'; stopGPS(false); document.querySelectorAll('[data-gps]').forEach(e => { e.className = 'pill r'; e.textContent = gps.state === 'denied' ? 'Location blocked' : 'GPS error'; }); },
  { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
function stopGPS(reset = true) { if (gps.watch !== null) navigator.geolocation.clearWatch(gps.watch); gps.watch = null; if (reset) gps.state = 'off'; }
const gpsPill = () => ({ on: '<span class="pill" data-gps><span class="live"></span> GPS sharing</span>', waiting: '<span class="pill w" data-gps>Finding GPS…</span>', denied: '<span class="pill r" data-gps>Location blocked</span>',
  unavailable: `<span class="pill g" data-gps title="Browsers only share location over https">GPS needs https</span>`, error: '<span class="pill r" data-gps>GPS error</span>' }[gps.state] || '');
const opt = { shell: 'p', section: 'rider', auth: true, role: 'rider' };
const alive = el => document.body.contains(el);
const VEH = { bike: 'Bike', scooter: 'Scooter', ev: 'EV scooter', cycle: 'Bicycle' };
let lastAvail = null;

async function guard(el) {
  try { return await api.get('/api/rider/me'); }
  catch (e) { el.innerHTML = empty('Your rider account is not active yet', e.message, 'bike') + '<div style="text-align:center"><a class="btn go" href="/#/partner">See application status in the ZIPI app</a></div>'; return null; }
}

route('/rider', async el => {
  el.innerHTML = skel(1, 80) + skel(2, 160);
  if (!(await guard(el))) return;
  const otps = {};
  // orders of one multi-shop trip travel together: one card, every pickup listed, one OTP at the door
  const trips = list => { const m = new Map(); for (const o of list) { const k = o.legId || o.id; if (!m.has(k)) m.set(k, []); m.get(k).push(o); }
    return [...m.values()].map(os => os.sort((a, b) => (a.legStops || []).indexOf(a.vendorId) - (a.legStops || []).indexOf(b.vendorId))); };
  async function draw() {
    const me = await api.get('/api/rider/me'); const r = me.rider, s = me.stats;
    const avail = r.online ? await api.get('/api/rider/available') : [];
    if (!alive(el)) return;
    if (r.online) startGPS(); else stopGPS();
    const nAvail = trips(avail).length; setBadge('ravail', nAvail);
    if (lastAvail !== null && nAvail > lastAvail) { beep(); navigator.vibrate?.([120, 80, 120]); }
    lastAvail = nAvail;
    const bonusPct = Math.min(100, s.tripsToday / s.bonusAt * 100);
    el.innerHTML = `<div class="phead"><div><h1>Hi ${esc(r.name.split(' ')[0])}</h1><p>${esc(VEH[r.vehicle])} · ${esc(S.zones.find(z => z.id === r.zoneId)?.name || '')} · ${r.rating} ★</p></div>${r.online ? gpsPill() : ''}</div>
      <button class="bigtoggle ${r.online ? 'on' : 'off'}" id="onl" aria-pressed="${r.online}">${r.online ? '<span class="live"></span> You are online' : 'Go online'}</button>
      <div class="kpis" style="margin-top:14px"><div class="kpi"><small>Earned today</small><b class="num">${rs(s.earnedToday)}</b><span>${s.tripsToday} trips</span></div><div class="kpi"><small>Daily bonus</small><b>${s.tripsToday}/${s.bonusAt}</b><div style="height:6px;border-radius:3px;background:var(--sunk);margin-top:6px;overflow:hidden"><i style="display:block;height:100%;width:${bonusPct}%;background:var(--mari);transition:width .8s"></i></div><span>${rs(s.bonus)} at ${s.bonusAt} trips</span></div><div class="kpi ${s.cashInHand > 2000 ? 'alert' : ''}"><small>Cash in hand</small><b class="num">${rs(s.cashInHand)}</b><span>${s.cashInHand > 2000 ? 'Deposit with your manager today' : 'From cash orders'}</span></div></div>
      ${me.active.length ? `<h2 style="margin:6px 0 10px">Your deliveries</h2><div class="g2">${trips(me.active).map(os => os.length > 1 ? tripCard(os) : activeCard(os[0])).join('')}</div>` : ''}
      ${r.online && !me.active.length ? '<div id="staging"></div>' : ''}
      <h2 style="margin:22px 0 10px">Orders near you</h2>${!r.online ? empty('You are offline', 'Go online to see orders from shops in your zone.', 'bike') : avail.length ? `<div class="g2 stag">${trips(avail).map((os, i) => availCard(os, i, trips(me.active).length)).join('')}</div>` : empty('No orders waiting', 'Stay near busy shops. New orders appear here with a sound.', 'clock')}`;
    const sb = el.querySelector('#staging');
    if (sb) api.get('/api/rider/staging').then(st => { if (!st.spot || !alive(el)) return;
      sb.innerHTML = `<div class="card stagecard">${icon('pin', 22)}<div class="grow"><b>Best place to wait: near ${esc(st.spot.name)}</b><br><span class="small mute">${st.spot.riderKm != null ? `${st.spot.riderKm} km from you · ` : ''}With ${st.riders} free rider${st.riders === 1 ? '' : 's'} placed like this, every open shop is within about ${st.radiusKm} km of a rider, so orders reach you fastest.</span></div><a class="btn sm" href="${directionsUrl(st.spot.ll, gps.last)}" target="_blank" rel="noopener">${icon('nav', 14)} Go</a></div>`; }).catch(() => {});
    el.querySelectorAll('[data-otp]').forEach(i => { i.value = otps[i.dataset.otp] || ''; i.oninput = () => { i.value = i.value.replace(/\D/g, '').slice(0, 4); otps[i.dataset.otp] = i.value; }; });
  }
  const availCard = (os, i, busyN) => { const o = os[0], multi = os.length > 1, sum = k => os.reduce((a, x) => a + (x[k] || 0), 0), allReady = os.every(x => x.status === 'ready');
    return `<div class="card ${multi ? 'trip' : ''}" style="--i:${i}"><div class="row between"><b>${multi ? `${os.length} pickups` : esc(o.vendor.name)}</b><span class="pill ${allReady ? '' : 'b'}">${allReady ? 'Ready now' : 'Being prepared'}</span></div>
    <p class="small mute" style="margin:4px 0 10px">${os.map((x, k) => `${icon('store', 14)} ${multi ? `${k + 1}. <b>${esc(x.vendor.name)}</b>, ` : ''}${esc(x.vendor.address)}`).join('<br>')}<br>${icon('pin', 14)} Drop at ${esc(o.address.area)} · ${o.dist} km${multi && o.legKg ? ` · about ${o.legKg} kg` : ''}</p>
    <div class="row between"><span><b class="num" style="font-size:22px">${rs(sum('riderPay'))}</b> <span class="small mute">for this trip · ${os.reduce((a, x) => a + x.items.reduce((b, l) => b + l.qty, 0), 0)} items${o.payment === 'COD' ? ` · collect ${rs(sum('total'))}` : ''}</span></span><button class="btn go" data-claim="${o.id}" ${busyN >= 2 ? 'disabled' : ''}>Accept${multi ? ' trip' : ''}</button></div></div>`; };
  const tripCard = os => {
    const o = os[0], left = os.filter(x => x.status !== 'picked'), atShops = left.length > 0, sum = k => os.reduce((a, x) => a + (x[k] || 0), 0);
    const nav = ll => ll ? `<a class="btn sm" href="${directionsUrl(ll, gps.last)}" target="_blank" rel="noopener">${icon('nav', 14)} Directions</a>` : '';
    const nextId = left[0]?.id;
    return `<div class="card trip" style="border-color:var(--go);box-shadow:0 0 0 2px var(--goTint)"><div class="row between"><b>Trip · ${os.length} shops</b><span class="row" style="gap:6px">${o.autoAssigned ? '<span class="pill b">Assigned to you</span>' : ''}<span class="pill w">Earn ${rs(sum('riderPay'))}</span></span></div>
      <p class="small mute" style="margin:4px 0 0">${esc(o.groupCode || '')} · one customer, one OTP. Keep each shop's bag separate and check the order code on it.</p>
      <ul class="tl" style="margin-top:12px">${os.map((x, k) => { const done = x.status === 'picked', now = x.id === nextId;
        return `<li class="${done ? 'done' : now ? 'now' : ''}"><i>${done ? icon('check', 14) : ''}</i><span><b>${k + 1}. Pick up from ${esc(x.vendor.name)}</b><small>Bag ${esc(x.code)} · ${esc(x.vendor.address)}</small>
          ${!done ? `<div class="small" style="margin-top:6px">${x.items.map(l => `${esc(l.name)} × ${l.qty}`).join(', ')}</div><div class="row wrap" style="margin-top:8px"><a class="btn sm" href="tel:+91${esc(x.vendor.phone)}">${icon('phone', 14)} Call shop</a>${now ? nav(x.vendor.ll) : ''}${x.status === 'ready' ? `<button class="btn sm go" data-pick="${x.id}">Picked up</button>` : `<span class="pill b">Packing · ready ~${fmtTime((x.acceptedAt || x.createdAt) + (x.prepMins || 15) * 60000)}</span>`}</div>` : ''}</span></li>`; }).join('')}
      <li class="${atShops ? '' : 'now'}"><i></i><span><b>Deliver everything to ${esc(o.customer?.name || 'customer')}</b><small>${esc(o.address.line || '')} ${esc(o.address.area)}${o.address.landmark ? ' · ' + esc(o.address.landmark) : ''}</small>
        ${!atShops ? `<div class="row wrap" style="margin-top:8px"><a class="btn sm" href="tel:+91${esc(o.customer?.phone || '')}">${icon('phone', 14)} ${esc(o.customer?.phone || '')}</a>${nav(o.address.ll)}</div>${o.payment === 'COD' ? `<div class="saved" style="margin-top:10px;background:var(--mariTint);color:inherit;animation:none">${icon('cash', 18)} Collect <b class="num">${rs(sum('total'))}</b> in cash for all ${os.length} bags</div>` : '<div class="saved" style="margin-top:10px;animation:none">Prepaid. Do not collect cash.</div>'}
          <form class="row" style="margin-top:10px" data-deliver="${o.id}"><input class="in" data-otp="${o.id}" inputmode="numeric" maxlength="4" placeholder="OTP" aria-label="Customer OTP" style="max-width:150px;letter-spacing:.2em;font-weight:700"><button class="btn go grow">Hand over all ${os.length} bags</button></form>` : ''}</span></li></ul>
      ${o.autoAssigned && os.every(x => x.status !== 'picked') ? `<button class="btn sm ghost" data-decline="${o.id}" style="margin-top:8px">Can't take this trip</button>` : ''}</div>`;
  };
  const activeCard = o => {
    const atShop = o.status !== 'picked';
    const nav = ll => ll ? `<a class="btn sm" href="${directionsUrl(ll, gps.last)}" target="_blank" rel="noopener">${icon('nav', 14)} Directions</a>` : '';
    return `<div class="card" style="border-color:var(--go);box-shadow:0 0 0 2px var(--goTint)"><div class="row between"><b>${esc(o.code)}</b><span class="row" style="gap:6px">${o.autoAssigned ? '<span class="pill b">Assigned to you</span>' : ''}<span class="pill w">Earn ${rs(o.riderPay)}</span></span></div>
      <ul class="tl" style="margin-top:12px"><li class="${atShop ? 'now' : 'done'}"><i>${atShop ? '' : icon('check', 14)}</i><span><b>Pick up from ${esc(o.vendor.name)}</b><small>${esc(o.vendor.address)}</small>
        ${atShop ? `<div class="small" style="margin-top:6px">${o.items.map(l => `${esc(l.name)} × ${l.qty}`).join(', ')}</div><div class="row wrap" style="margin-top:8px"><a class="btn sm" href="tel:+91${esc(o.vendor.phone)}">${icon('phone', 14)} Call shop</a>${nav(o.vendor.ll)}${o.autoAssigned ? `<button class="btn sm ghost" data-decline="${o.id}">Can't take it</button>` : ''}${o.status === 'ready' ? `<button class="btn sm go" data-pick="${o.id}">Picked up order</button>` : `<span class="pill b">Shop is preparing · ready ~${fmtTime((o.acceptedAt || o.createdAt) + (o.prepMins || 15) * 60000)}</span>`}</div>` : ''}</span></li>
      <li class="${atShop ? '' : 'now'}"><i></i><span><b>Deliver to ${esc(o.customer?.name || 'customer')}</b><small>${esc(o.address.line || '')} ${esc(o.address.area)}${o.address.landmark ? ' · ' + esc(o.address.landmark) : ''}</small>
        ${!atShop ? `<div class="row wrap" style="margin-top:8px"><a class="btn sm" href="tel:+91${esc(o.customer?.phone || '')}">${icon('phone', 14)} ${esc(o.customer?.phone || '')}</a>${nav(o.address.ll)}</div>${o.payment === 'COD' ? `<div class="saved" style="margin-top:10px;background:var(--mariTint);color:inherit;animation:none">${icon('cash', 18)} Collect <b class="num">${rs(o.total)}</b> in cash</div>` : '<div class="saved" style="margin-top:10px;animation:none">Prepaid. Do not collect cash.</div>'}
          <form class="row" style="margin-top:10px" data-deliver="${o.id}"><input class="in" data-otp="${o.id}" inputmode="numeric" maxlength="4" placeholder="OTP" aria-label="Customer OTP" style="max-width:150px;letter-spacing:.2em;font-weight:700"><button class="btn go grow">Complete delivery</button></form>` : ''}</span></li></ul></div>`;
  };
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'onl') { const on = b.getAttribute('aria-pressed') !== 'true'; busy(b, true); try { await api.patch('/api/rider/me', { online: on }); toast(on ? 'You are online. Orders will ring here.' : 'You are offline', 'ok'); } catch (x) { toast(x.message, 'err'); } draw(); }
    if (b.dataset.claim) { busy(b, true); try { await api.post(`/api/rider/orders/${b.dataset.claim}/claim`); toast('Order is yours. Head to the shop.', 'ok'); } catch (x) { toast(x.message, 'err'); } draw(); }
    if (b.dataset.decline) { if (!(await confirmBox('Pass this order to the next nearest rider?', { ok: 'Pass it on', title: 'Decline order' }))) return; try { await api.post(`/api/rider/orders/${b.dataset.decline}/decline`); toast('Order passed on'); } catch (x) { toast(x.message, 'err'); } draw(); }
    if (b.dataset.pick) { if (!(await confirmBox('Did you check the order number and item count with the shop?', { ok: 'Yes, picked up', title: 'Confirm pickup' }))) return; try { await api.post(`/api/rider/orders/${b.dataset.pick}/pickup`); toast('Picked up. Drive safe!', 'ok'); } catch (x) { toast(x.message, 'err'); } draw(); }
  });
  el.addEventListener('submit', async e => {
    const f = e.target.closest('[data-deliver]'); if (!f) return; e.preventDefault(); const id = f.dataset.deliver; const b = e.submitter; busy(b, true);
    try { await api.post(`/api/rider/orders/${id}/deliver`, { otp: otps[id] || '' }); delete otps[id]; confetti(); toast('Delivered! Earnings added.', 'ok'); } catch (x) { toast(x.message, 'err'); busy(b, false); return; } draw();
  });
  const poll = setInterval(() => { if (!alive(el)) return clearInterval(poll); draw(); }, 20000);
  live(draw); await draw();
}, { ...opt, title: 'Deliveries' });

/* ---------- shifts: book slots for the week; the plan shows where riders are needed most ---------- */
route('/rider/shifts', async el => {
  el.innerHTML = skel(3, 120); if (!(await guard(el))) return;
  let d = await api.get('/api/rider/shifts');
  function draw() {
    if (!alive(el)) return;
    const mine = d.days.reduce((a, x) => a + x.slots.filter(s => s.mine).length, 0);
    el.innerHTML = `<div class="phead"><div><h1>Shifts</h1><p>Book the slots you will ride. Slots marked <b>needs riders</b> are where you'll get the most orders.</p></div><span class="pill">${mine} booked this week</span></div>
      <div class="shiftgrid">${d.days.map((day, i) => `<div class="card"><h3>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(day.at).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
        ${day.slots.map(s => { const short = s.booked < s.needed; return `<button class="shift ${s.mine ? 'on' : ''}" data-day="${day.day}" data-slot="${s.slot}" aria-pressed="${s.mine}" ${s.over ? 'disabled' : ''}>
          <span class="grow"><b>${esc(d.slots[s.slot][2])}</b><small>${s.over ? 'Over' : `${s.booked}/${s.needed} riders · ~${s.expected} orders expected`}</small></span>${s.over ? '' : s.mine ? `<span class="pill">${icon('check', 12)} Booked</span>` : short ? '<span class="pill t">Needs riders</span>' : '<span class="pill g">Covered</span>'}</button>`; }).join('')}</div>`).join('')}</div>`;
  }
  el.addEventListener('click', async e => { const b = e.target.closest('[data-slot]'); if (!b) return; busy(b, true);
    try { d = await api.post('/api/rider/shifts', { day: b.dataset.day, slot: b.dataset.slot, on: b.getAttribute('aria-pressed') !== 'true' }); toast(b.getAttribute('aria-pressed') !== 'true' ? 'Shift booked' : 'Shift removed', 'ok'); } catch (x) { toast(x.message, 'err'); } draw(); });
  draw();
}, { ...opt, title: 'Shifts' });

route('/rider/earnings', async el => {
  el.innerHTML = `<div class="kpis">${skel(4, 90)}</div>`; if (!(await guard(el))) return;
  const e = await api.get('/api/rider/earnings');
  el.innerHTML = `<div class="phead"><div><h1>Earnings</h1><p>Paid every week to your UPI or bank.</p></div></div>
    <div class="kpis"><div class="kpi"><small>Next payout</small><b class="num">${rs(e.due)}</b><span>Unpaid earnings</span></div><div class="kpi"><small>This week</small><b class="num">${rs(e.week)}</b><span>${e.weekTrips} trips</span></div><div class="kpi"><small>All time</small><b class="num">${rs(e.earned)}</b><span>${e.trips} trips · ${e.km} km</span></div><div class="kpi ${e.cashInHand > 2000 ? 'alert' : ''}"><small>Cash to deposit</small><b class="num">${rs(e.cashInHand)}</b><span>Hand over to your zone manager</span></div></div>
    <div class="g2 wide-l"><div class="card"><h3>Last 14 days</h3>${cols(e.days.map(d => Math.round(d.amount)), e.days.map(d => new Date(d.day).getDate()), { peakTop: 1 })}</div>
    <div class="card"><h3>Payouts</h3>${e.payouts.length ? e.payouts.map(p => `<div class="li"><span>${fmtDate(p.at)}<br><span class="small mute">${esc(p.ref)}</span></span><b class="num">${rs(p.amount)}</b></div>`).join('') : '<p class="small mute">No payouts yet.</p>'}
      <h3 style="margin-top:16px">Cash deposits</h3>${e.deposits.length ? e.deposits.map(d => `<div class="li"><span>${fmtDT(d.at)}</span><b class="num">${rs(d.amount)}</b></div>`).join('') : '<p class="small mute">No deposits recorded yet.</p>'}</div></div>
    <div class="card" style="margin-top:16px"><h3>How each trip is paid</h3><div class="kv"><span>Base fare</span><b>₹20</b></div><div class="kv"><span>Distance</span><b>₹6 per km</b></div><div class="kv"><span>Daily bonus</span><b>₹150 at 18 trips</b></div></div>`;
}, { ...opt, title: 'Earnings' });

route('/rider/history', async el => {
  el.innerHTML = skel(4, 60); if (!(await guard(el))) return;
  const os = await api.get('/api/rider/orders');
  el.innerHTML = `<div class="phead"><div><h1>Delivery history</h1><p>Your last ${os.length} deliveries.</p></div></div>${os.length ? `<div class="tbl"><table><thead><tr><th>Order</th><th>Date</th><th>From</th><th>To</th><th class="r">Distance</th><th>Payment</th><th class="r">You earned</th></tr></thead><tbody>${os.map(o => `<tr><td>${esc(o.code)}</td><td class="num">${fmtDT(o.createdAt)}</td><td>${esc(o.vendor.name)}</td><td>${esc(o.address.area)}</td><td class="r">${o.dist} km</td><td>${o.payment === 'COD' ? `<span class="pill w">Cash ${rs(o.total)}</span>` : '<span class="pill">Prepaid</span>'}</td><td class="r"><b>${rs(o.riderPay)}</b></td></tr>`).join('')}</tbody></table></div>` : empty('No deliveries yet', 'Go online to take your first order.', 'bike')}`;
}, { ...opt, title: 'History' });
