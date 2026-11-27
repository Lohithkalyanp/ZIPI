// Shop / restaurant console: live orders, menu & stock, earnings, settings.
import { api } from './api.js';
import { S, route, section, nav, live, refreshMe } from './state.js';
import { $, esc, rs, icon, pic, vegMark, toast, sheet, confirmBox, ask, field, busy, empty, skel, fmtTime, fmtDT, fmtDate, ago, statusPill, beep, readFile, cols, bars } from './ui.js';
import { setBadge } from './main.js';

section('vendor', { title: 'Shop console', home: '/vendor', items: [['/vendor', 'Orders', 'bell', 'vnew'], ['/vendor/menu', 'Menu & stock', 'box', 'vlow'], ['/vendor/insights', 'Insights', 'chart'], ['/vendor/earnings', 'Earnings', 'wallet'], ['/vendor/settings', 'Shop settings', 'gear'], ['/vendor/help', 'Help', 'info']] });
const opt = { shell: 'p', section: 'vendor', auth: true, role: 'vendor' };
const alive = el => document.body.contains(el);
let lastNew = null;

async function guard(el) {
  try { return await api.get('/api/vendor/me'); }
  catch (e) { el.innerHTML = empty('Your shop is not live yet', e.message, 'store') + '<div style="text-align:center"><a class="btn go" href="/#/partner">See application status in the ZIPI app</a></div>'; return null; }
}
const onlineBar = (v, me) => `<div class="online ${v.online ? 'on' : ''}"><span class="grow"><b>${v.online ? 'You are open for orders' : 'You are closed'}</b><br><span class="small mute">${v.online ? `Customers in ${esc(S.zones.find(z => z.id === v.zoneId)?.name || '')} can order now` : 'Customers can see your menu but not order'}</span></span><button class="switch" id="onl" aria-pressed="${v.online}" aria-label="Open for orders"></button></div>`;
async function toggleOnline(el, v) { try { const n = await api.patch('/api/vendor/me', { online: !v.online }); v.online = n.online; toast(n.online ? 'You are open for orders' : 'Shop closed', 'ok'); return true; } catch (x) { toast(x.message, 'err'); return false; } }

/* ---------- live orders board ---------- */
route('/vendor', async el => {
  el.innerHTML = skel(1, 80) + `<div class="kpis" style="margin-top:16px">${skel(4, 80)}</div>`;
  const me = await guard(el); if (!me) return;
  const v = me.vendor, acceptMins = 5;
  let showPast = false;
  async function draw(ev) {
    const [stats, liveOs, past] = await Promise.all([api.get('/api/vendor/me'), api.get('/api/vendor/orders', { scope: 'live' }), showPast ? api.get('/api/vendor/orders', { scope: 'past' }) : Promise.resolve([])]);
    if (!alive(el)) return;
    const s = stats.stats, nw = liveOs.filter(o => o.status === 'placed');
    setBadge('vnew', nw.length); setBadge('vlow', s.lowStock);
    if (lastNew !== null && nw.length > lastNew) { beep(); navigator.vibrate?.(200); toast(`New order ${nw[0].code} · ${rs(nw[0].subtotal)}`, 'ok'); }
    lastNew = nw.length;
    const lane = (title, st, list, hint) => `<div class="lane"><h3>${title}<span class="pill ${st === 'placed' && list.length ? 't' : 'g'}">${list.length}</span></h3>${list.length ? list.map(oc).join('') : `<p class="small mute">${hint}</p>`}</div>`;
    el.innerHTML = `<div class="phead"><div><h1>${esc(v.name)}</h1><p>${fmtDate(Date.now())} · ${me.commissionPct}% commission · prep ${v.prepMins} min</p></div><button class="btn sm" id="past">${showPast ? 'Hide' : 'Show'} completed orders</button></div>
      ${onlineBar(stats.vendor)}
      <div class="kpis" style="margin-top:14px"><div class="kpi"><small>Orders today</small><b>${s.ordersToday}</b><span>${s.live} live</span></div><div class="kpi"><small>Sales today</small><b class="num">${rs(s.salesToday)}</b><span>${s.deliveredToday} delivered</span></div><div class="kpi"><small>You earn today</small><b class="num">${rs(s.netToday)}</b><span>after commission</span></div><div class="kpi ${s.lowStock ? 'alert' : ''}"><small>Low stock items</small><b>${s.lowStock}</b>${s.lowStock ? '<span data-go="/vendor/menu" style="cursor:pointer">Restock now ›</span>' : '<span>All good</span>'}</div>${s.rejectedToday ? `<div class="kpi alert"><small>Missed or rejected</small><b>${s.rejectedToday}</b><span style="color:var(--red)">Hurts your ranking</span></div>` : ''}</div>
      <div class="board">${lane('New', 'placed', nw, `Accept within ${acceptMins} minutes or the order is cancelled.`)}${lane(v.type === 'store' ? 'Packing' : 'Preparing', 'accepted', liveOs.filter(o => o.status === 'accepted'), 'Accepted orders appear here.')}${lane('Ready for pickup', 'ready', liveOs.filter(o => o.status === 'ready'), 'Mark orders ready when packed.')}${lane('Out for delivery', 'picked', liveOs.filter(o => o.status === 'picked'), 'Picked-up orders.')}</div>
      ${liveOs.some(o => o.status === 'scheduled') ? `<h2 style="margin:24px 0 10px">${icon('cal', 20)} Scheduled for later</h2><div class="tbl"><table><thead><tr><th>Order</th><th>Deliver at</th><th>Comes to you at</th><th>Items</th><th class="r">You earn</th></tr></thead><tbody>${liveOs.filter(o => o.status === 'scheduled').sort((a, b) => a.scheduleAt - b.scheduleAt).map(o => `<tr><td><b>${esc(o.code)}</b></td><td class="num">${fmtDT(o.scheduleAt)}</td><td class="num">${fmtTime(o.releaseAt)}</td><td>${o.items.map(l => `${esc(l.name)} ×${l.qty}`).join(', ')}</td><td class="r">${rs(o.vendorNet)}</td></tr>`).join('')}</tbody></table></div><p class="small mute">Stock is already set aside. Each order moves to New at the time shown so it arrives on time.</p>` : ''}
      ${showPast ? `<h2 style="margin:24px 0 10px">Completed and cancelled</h2>${past.length ? `<div class="tbl"><table><thead><tr><th>Order</th><th>Time</th><th>Items</th><th>Status</th><th class="r">Items value</th><th class="r">You earn</th></tr></thead><tbody>${past.map(o => `<tr><td>${esc(o.code)}</td><td class="num">${fmtDT(o.createdAt)}</td><td>${o.items.map(l => `${esc(l.name)} ×${l.qty}`).join(', ')}</td><td>${statusPill(o.status)}</td><td class="r">${rs(o.subtotal)}</td><td class="r">${o.status === 'delivered' ? rs(o.vendorNet) : '–'}</td></tr>`).join('')}</tbody></table></div>` : empty('No completed orders yet')}` : ''}`;
    tick();
  }
  const oc = o => `<div class="ocard ${o.status === 'placed' ? 'new' : ''}"><div class="row between"><b>${esc(o.code)}</b>${o.status === 'placed' ? `<span class="timer" data-dl="${o.createdAt + acceptMins * 60000}"></span>` : `<span class="small mute">${ago(o.createdAt)}</span>`}</div>
    <div class="small mute">${esc(o.customer?.name || 'Customer')} · ${esc(o.address?.area || '')} · ${o.payment === 'COD' ? 'Cash' : 'Prepaid'}</div>
    ${o.groupSize > 1 ? `<div class="small" style="margin-top:4px"><span class="pill b">${icon('bag', 12)} Multi-shop order ${esc(o.groupCode)}</span> ${(o.legStops || []).length > 1 ? `The rider also collects from ${(o.legStops.length - 1)} other shop${o.legStops.length > 2 ? 's' : ''}.${o.status === 'placed' ? ' Accept quickly so they are not kept waiting.' : ' Pack it on time so they are not kept waiting.'}` : 'Your part goes with its own rider.'}</div>` : ''}
    <div class="its">${o.items.map(l => `<div><span>${vegMark(l.veg)} ${esc(l.name)}</span><b>× ${l.qty}</b></div>`).join('')}</div>${o.note ? `<div class="saved" style="background:var(--mariTint);color:inherit;font-weight:500;animation:none">${icon('info', 16)} ${esc(o.note)}</div>` : ''}
    <div class="row between" style="margin-top:8px"><span class="small">Items <b class="num">${rs(o.subtotal)}</b> · you earn <b class="num">${rs(o.vendorNet)}</b></span></div>
    ${o.status === 'placed' ? `<div class="row" style="margin-top:10px"><button class="btn sm danger" data-rej="${o.id}">Reject</button><button class="btn go grow" data-acc="${o.id}">Accept order</button></div>`
    : o.status === 'accepted' ? `<div class="small mute" style="margin-top:6px">${o.rider ? `${icon('bike', 14)} ${esc(o.rider.name)} assigned${o.autoAssigned ? ' (nearest rider)' : ''}` : 'Finding the nearest rider…'}</div><button class="btn go block" style="margin-top:8px" data-ready="${o.id}">Mark ready for pickup</button>`
    : o.status === 'ready' ? `<div class="small" style="margin-top:6px">${o.rider ? `${icon('bike', 14)} <b>${esc(o.rider.name)}</b> is coming. Hand over after they show order ${esc(o.code)}.` : '<span class="pill w">Waiting for a rider</span>'}</div>`
    : `<div class="small mute" style="margin-top:6px">${icon('bike', 14)} With ${esc(o.rider?.name || 'rider')}</div>`}</div>`;
  function tick() { el.querySelectorAll('[data-dl]').forEach(t => { const s = Math.max(0, Math.round((+t.dataset.dl - Date.now()) / 1000)); t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; t.classList.toggle('warn', s < 90); }); }
  const iv = setInterval(() => { if (!alive(el)) return clearInterval(iv); tick(); }, 1000);
  const poll = setInterval(() => { if (!alive(el)) return clearInterval(poll); draw(); }, 30000);
  el.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'onl') { if (await toggleOnline(el, v)) draw(); }
    if (t.id === 'past') { showPast = !showPast; draw(); }
    if (t.dataset.acc) { const r = await ask('Accept order', field('prepMins', v.type === 'store' ? 'Ready to pick up in' : 'Food ready in', { options: [5, 10, 15, 20, 25, 30, 40].map(m => [m, `${m} minutes`]), value: [5, 10, 15, 20, 25, 30, 40].reduce((a, b) => Math.abs(b - v.prepMins) < Math.abs(a - v.prepMins) ? b : a) }), { ok: 'Accept' });
      if (!r) return; try { await api.post(`/api/vendor/orders/${t.dataset.acc}/accept`, r); toast('Order accepted. A rider is being assigned.', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); draw(); } }
    if (t.dataset.rej) { const r = await ask('Reject order', field('reason', 'Reason', { options: [['Item out of stock', 'Item out of stock'], ['Kitchen too busy', 'Too busy right now'], ['Closing soon', 'Closing soon'], ['Other', 'Other']] }) + '<p class="small mute">Rejections lower your ranking. If one item is missing, mark it out of stock in Menu & stock instead.</p>', { ok: 'Reject order', danger: true });
      if (!r) return; try { await api.post(`/api/vendor/orders/${t.dataset.rej}/reject`, r); toast('Order rejected'); draw(); } catch (x) { toast(x.message, 'err'); } }
    if (t.dataset.ready) { busy(t, true); try { await api.post(`/api/vendor/orders/${t.dataset.ready}/ready`); toast('Marked ready', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); busy(t, false); } }
  });
  live(draw); await draw();
}, { ...opt, title: 'Orders' });

/* ---------- menu & stock (shared with zone managers) ---------- */
export function itemForm(it, v, sections) {
  const veg = it?.veg === true ? 'veg' : it?.veg === false ? 'nonveg' : 'na';
  return `<div class="row" style="gap:12px"><div class="thumb" style="width:72px;height:72px" id="ipv">${pic(it || { art: v.art }, v.art, 'square')}</div><label class="upl grow" style="position:relative">${icon('upload', 20)}<span>Photo (optional)</span><input type="file" accept="image/*" id="iimg"></label></div>
    ${field('name', 'Item name', { req: true, value: it?.name })}<div class="grid2">${field('price', 'Selling price (₹)', { req: true, type: 'number', value: it?.price, attrs: 'min="1"' })}${field('mrp', 'MRP (₹, optional)', { type: 'number', value: it?.mrp ?? '', attrs: 'min="1"' })}</div>
    <div class="grid2">${field('section', v.type === 'store' ? 'Aisle' : 'Menu section', { value: it?.section || sections[0] || 'Menu', attrs: 'list="secs"' })}${field('unit', v.type === 'store' ? 'Pack size' : 'Portion (optional)', { value: it?.unit, ph: v.type === 'store' ? '1 kg, 500 ml' : 'Serves 1' })}</div><datalist id="secs">${sections.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <div class="grid2">${field('stock', 'Stock on hand', { type: 'number', value: it ? it.stock ?? '' : v.type === 'store' ? 10 : '', attrs: 'min="0"', hint: v.type === 'store' ? 'Goes down with every order' : 'Leave blank if you cook to order' })}${field('lowStockAt', 'Alert me when stock falls to', { type: 'number', value: it?.lowStockAt ?? 5, attrs: 'min="0"' })}</div>
    ${v.type === 'restaurant' ? field('veg', 'Type', { options: [['veg', 'Veg'], ['nonveg', 'Non-veg']], value: veg }) : field('category', 'Category customers find it under', { options: GCATS, value: it?.category || '', hint: 'Customers shop groceries by category first, so pick the closest match' })}${field('desc', 'Description', { type: 'textarea', value: it?.desc, ph: 'What makes it good' })}
    <label class="check"><input type="checkbox" name="bestseller" ${it?.bestseller ? 'checked' : ''}> Show as bestseller</label><label class="check"><input type="checkbox" name="available" ${!it || it.available !== false ? 'checked' : ''}> Available to order</label>`;
}
const GCATS = [['', 'Choose automatically'], ['vegetables', 'Vegetables'], ['fruits', 'Fruits'], ['dairy', 'Dairy, bread & eggs'], ['staples', 'Atta, rice, dal & oil'], ['snacks', 'Snacks & biscuits'], ['beverages', 'Drinks & juices'],
  ['frozen', 'Frozen foods'], ['bakery', 'Bakery & sweets'], ['stationery', 'Stationery & office'], ['fancy', 'Fancy & gift items'], ['personal', 'Personal care'], ['household', 'Cleaning & household'], ['medicines', 'Medicines & health'], ['other', 'Other essentials']];
export function itemPayload(f, img) { return { name: f.name, ...(f.category !== undefined ? { category: f.category } : {}), price: f.price, mrp: f.mrp || null, section: f.section, unit: f.unit, stock: f.stock === '' ? null : f.stock, lowStockAt: f.lowStockAt || 0, veg: f.veg === undefined ? undefined : f.veg === 'veg', desc: f.desc, bestseller: f.bestseller, available: f.available, ...(img ? { image: img } : {}) }; }
export function editItemSheet(it, v, sections, save) {
  return new Promise(res => {
    let img = null;
    const s = sheet(`<form id="itf">${itemForm(it, v, sections)}<div class="row" style="margin-top:16px">${it ? '<button type="button" class="btn danger" id="idel">Remove</button>' : ''}<button class="btn go grow big">${it ? 'Save changes' : 'Add item'}</button></div></form>`, { title: it ? 'Edit item' : 'Add item', onClose: () => res(null) });
    s.el.querySelector('#iimg').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const d = await readFile(f, 900); const { url } = await api.post('/api/upload', { dataUrl: d }); img = url; s.el.querySelector('#ipv').innerHTML = `<img src="${esc(url)}" alt="">`; } catch (x) { toast(x.message, 'err'); } };
    s.el.querySelector('#idel')?.addEventListener('click', async () => { if (await confirmBox(`Remove ${it.name} from your ${v.type === 'store' ? 'catalogue' : 'menu'}?`, { ok: 'Remove', danger: true })) { await save(null, true); res(true); s.close(); } });
    s.el.querySelector('#itf').onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true); const f = {}; for (const x of e.target.elements) if (x.name) f[x.name] = x.type === 'checkbox' ? x.checked : x.value;
      try { await save(itemPayload(f, img)); res(true); s.close(); } catch (x) { toast(x.message, 'err'); busy(b, false); } };
  });
}
export function stockTable(items, v, { onPatch, onEdit }) {
  return `<div class="tbl"><table><thead><tr><th>Item</th><th class="r">Price</th><th class="r">Stock</th><th>Status</th><th>Available</th><th></th></tr></thead><tbody>${items.map(it => {
    const low = it.stock != null && it.stock <= it.lowStockAt, out = it.stock === 0 || !it.available;
    return `<tr><td><div class="row"><div class="thumb">${pic(it, v.art, 'square')}</div><span><b>${vegMark(it.veg)} ${esc(it.name)}</b><br><span class="small mute">${esc(it.section)}${it.unit ? ' · ' + esc(it.unit) : ''}</span></span></div></td>
      <td class="r"><input class="stockin" type="number" min="1" value="${it.price}" data-price="${it.id}" aria-label="Price of ${esc(it.name)}"></td>
      <td class="r"><div class="row" style="justify-content:flex-end;gap:4px"><button class="iconbtn" style="width:34px;height:34px" data-sd="${it.id}" aria-label="Less">${icon('minus', 16)}</button><input class="stockin" type="number" min="0" placeholder="∞" value="${it.stock ?? ''}" data-stock="${it.id}" aria-label="Stock of ${esc(it.name)}"><button class="iconbtn" style="width:34px;height:34px" data-su="${it.id}" aria-label="More">${icon('plus', 16)}</button></div></td>
      <td>${out ? '<span class="pill r">Out of stock</span>' : low ? `<span class="pill w">Low · ${it.stock} left</span>` : it.stock == null ? '<span class="pill g">Made to order</span>' : '<span class="pill">In stock</span>'}</td>
      <td><button class="switch" data-av="${it.id}" aria-pressed="${it.available}" aria-label="Available"></button></td><td><button class="iconbtn" data-edit="${it.id}" aria-label="Edit ${esc(it.name)}">${icon('edit', 18)}</button></td></tr>`; }).join('')}</tbody></table></div>`;
}
export function bindStock(el, getItems, patch, redraw, onEdit) {
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return; const items = getItems();
    const id = b.dataset.sd || b.dataset.su || b.dataset.av || b.dataset.edit; if (!id) return; const it = items.find(x => x.id === id);
    try {
      if (b.dataset.av) { await patch(id, { available: !it.available }); toast(it.available ? `${it.name} hidden from customers` : `${it.name} is back on`, 'ok'); }
      if (b.dataset.su) await patch(id, { stock: (it.stock ?? 0) + 1, available: true });
      if (b.dataset.sd) { if (it.stock == null || it.stock <= 0) return; await patch(id, { stock: it.stock - 1 }); }
      if (b.dataset.edit) return onEdit(it);
      redraw();
    } catch (x) { toast(x.message, 'err'); }
  });
  el.addEventListener('change', async e => {
    const t = e.target; const id = t.dataset.stock || t.dataset.price; if (!id) return;
    try { if (t.dataset.stock) await patch(id, { stock: t.value === '' ? null : Math.max(0, +t.value), ...(+t.value > 0 ? { available: true } : {}) }); else await patch(id, { price: +t.value }); toast('Saved', 'ok'); redraw(); } catch (x) { toast(x.message, 'err'); redraw(); }
  });
}
route('/vendor/menu', async el => {
  el.innerHTML = skel(5, 60); const me = await guard(el); if (!me) return;
  const v = me.vendor; let items = [], q = '', flt = 'all';
  const sections = () => [...new Set(items.map(i => i.section))];
  async function load() { items = await api.get('/api/vendor/items'); draw(); }
  function draw() {
    if (!alive(el)) return;
    const low = items.filter(i => i.stock != null && i.stock <= i.lowStockAt && i.stock > 0), out = items.filter(i => i.stock === 0 || !i.available);
    setBadge('vlow', low.length + items.filter(i => i.stock === 0).length);
    const list = items.filter(i => (!q || i.name.toLowerCase().includes(q)) && (flt === 'all' || (flt === 'low' && low.includes(i)) || (flt === 'out' && out.includes(i))));
    el.querySelector('#tbl').innerHTML = list.length ? stockTable(list, v, {}) : empty('No items here', flt === 'all' ? 'Add your first item.' : 'Nothing in this filter.', 'box');
    el.querySelector('#counts').innerHTML = [['all', `All ${items.length}`], ['low', `Low stock ${low.length}`], ['out', `Out of stock ${out.length}`]].map(([k, t]) => `<button class="chip" data-flt="${k}" aria-pressed="${flt === k}">${t}</button>`).join('');
  }
  el.innerHTML = `<div class="phead"><div><h1>${v.type === 'store' ? 'Catalogue & stock' : 'Menu & stock'}</h1><p>Stock goes down with every order and comes back if an order is cancelled. Customers see “Only 3 left” when stock is low.</p></div><button class="btn go" id="add">${icon('plus', 18)} Add item</button></div>
    <div class="row wrap" style="margin-bottom:12px"><div class="search" style="box-shadow:none;max-width:340px;min-height:44px">${icon('search', 18)}<input id="iq" placeholder="Search items" aria-label="Search items"></div><div class="chips" id="counts"></div></div><div id="tbl"></div>`;
  const patch = async (id, b) => { const n = await api.patch('/api/vendor/items/' + id, b); items = items.map(i => i.id === id ? n : i); };
  const edit = async it => { await editItemSheet(it, v, sections(), async (payload, del) => { if (del) await api.del('/api/vendor/items/' + it.id); else await api.patch('/api/vendor/items/' + it.id, payload); toast(del ? 'Removed' : 'Saved', 'ok'); }); load(); };
  bindStock(el.querySelector('#tbl'), () => items, patch, draw, edit);
  el.querySelector('#iq').oninput = e => { q = e.target.value.toLowerCase(); draw(); };
  el.querySelector('#counts').onclick = e => { const b = e.target.closest('[data-flt]'); if (b) { flt = b.dataset.flt; draw(); } };
  el.querySelector('#add').onclick = async () => { await editItemSheet(null, v, sections(), async payload => { await api.post('/api/vendor/items', payload); toast('Item added', 'ok'); }); load(); };
  live(load); await load();
}, { ...opt, title: 'Menu & stock' });

/* ---------- earnings ---------- */
route('/vendor/earnings', async el => {
  el.innerHTML = `<div class="kpis">${skel(4, 90)}</div>`; const me = await guard(el); if (!me) return;
  const e = await api.get('/api/vendor/earnings');
  el.innerHTML = `<div class="phead"><div><h1>Earnings</h1><p>Payouts go to ${esc(me.vendor.upi || ('bank ••••' + (me.vendor.accountNo || '').slice(-4)))} every week.</p></div></div>
    <div class="kpis"><div class="kpi"><small>Next payout</small><b class="num">${rs(e.due)}</b><span>Pending settlement</span></div><div class="kpi"><small>Total earned</small><b class="num">${rs(e.earned)}</b><span>${e.orders} delivered orders</span></div><div class="kpi"><small>Paid so far</small><b class="num">${rs(e.paid)}</b></div><div class="kpi"><small>Gross sales</small><b class="num">${rs(e.gross)}</b><span>Commission ${e.commissionPct}% = ${rs(e.commission)}</span></div></div>
    <div class="g2 wide-l"><div class="card"><h3>Last 14 days</h3><p class="small mute" style="margin:2px 0 0">What you earned each day after commission</p>${cols(e.days.map(d => Math.round(d.amount)), e.days.map(d => new Date(d.day).getDate()), { peakTop: 1 })}</div>
    <div class="card"><h3>Payouts</h3>${e.payouts.length ? e.payouts.map(p => `<div class="li"><span>${fmtDate(p.at)}<br><span class="small mute">${esc(p.ref)}</span></span><b class="num">${rs(p.amount)}</b></div>`).join('') : '<p class="mute small">No payouts yet.</p>'}</div></div>
    <h2 style="margin:22px 0 10px">Recent orders</h2><div class="tbl"><table><thead><tr><th>Order</th><th>Date</th><th class="r">Items value</th><th class="r">Commission</th><th class="r">You earn</th></tr></thead><tbody>${e.recent.map(o => `<tr><td>${esc(o.code)}</td><td class="num">${fmtDT(o.at)}</td><td class="r">${rs(o.subtotal)}</td><td class="r">−${rs(o.commission)}</td><td class="r"><b>${rs(o.net)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="mute">No delivered orders yet.</td></tr>'}</tbody></table></div>`;
}, { ...opt, title: 'Earnings' });

/* ---------- insights: what sells, when, and how the shop is doing on speed and ratings ---------- */
route('/vendor/insights', async el => {
  el.innerHTML = `<div class="kpis">${skel(4, 90)}</div>`; const me = await guard(el); if (!me) return;
  let days = 30;
  async function draw() {
    const a = await api.get('/api/vendor/analytics', { days }); if (!alive(el)) return;
    const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], best = a.weekdays.indexOf(Math.max(...a.weekdays)), peak = a.hours.indexOf(Math.max(...a.hours));
    const tips = [];
    if (a.avgPrep && a.avgPrep > a.promisedPrep + 3) tips.push(`Orders take ${a.avgPrep} min to get ready but your card promises ${a.promisedPrep}. Update your prep time in Shop settings so ETAs stay honest.`);
    if (a.lostRate > 5) tips.push(`${a.lostRate}% of orders were rejected or missed. Mark sold-out items unavailable instead of rejecting, and keep the console open at peak time.`);
    if (a.notSelling.length) tips.push(`${a.notSelling.length} item${a.notSelling.length > 1 ? 's' : ''} had no orders. Try a photo, a better name or a small price drop on ${esc(a.notSelling.slice(0, 2).join(' and '))}.`);
    if (a.repeatRate < 25 && a.customers > 10) tips.push('Few customers come back. A shop offer like "Free dessert above ₹399" on your card helps repeat orders.');
    if (Math.max(...a.hours) > 0) tips.push(`Your busiest hour is ${peak % 12 || 12} ${peak < 12 ? 'am' : 'pm'} and your best day is ${WD[best]}. Have stock and staff ready then.`);
    el.innerHTML = `<div class="phead"><div><h1>Insights</h1><p>How ${esc(me.vendor.name)} did in the last ${days} days.</p></div><div class="chips">${[7, 30, 90].map(n => `<button class="chip" data-days="${n}" aria-pressed="${days === n}">${n} days</button>`).join('')}</div></div>
      <div class="kpis"><div class="kpi"><small>Delivered orders</small><b>${a.delivered}</b><span>of ${a.orders} placed</span></div><div class="kpi"><small>Sales</small><b class="num">${rs(a.revenue)}</b><span>you earned ${rs(a.net)}</span></div><div class="kpi"><small>Average order</small><b class="num">${rs(a.aov)}</b></div>
        <div class="kpi"><small>Rating</small><b>${a.rating ? a.rating + ' ★' : '–'}</b><span>${a.ratingSplit.reduce((x, r) => x + r.n, 0)} ratings</span></div><div class="kpi ${a.avgPrep && a.avgPrep > a.promisedPrep + 3 ? 'alert' : ''}"><small>Avg prep time</small><b>${a.avgPrep ? a.avgPrep + ' min' : '–'}</b><span>promised ${a.promisedPrep} min</span></div>
        <div class="kpi ${a.lostRate > 5 ? 'alert' : ''}"><small>Rejected or missed</small><b>${a.lostRate}%</b><span>${a.lost} orders</span></div><div class="kpi"><small>Repeat customers</small><b>${a.repeatRate}%</b><span>of ${a.customers} customers</span></div></div>
      ${tips.length ? `<div class="card tips"><h3>${icon('spark', 18)} What to do next</h3><ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul></div>` : ''}
      <div class="g2 wide-l" style="margin-top:16px"><div class="card"><h3>Orders by hour</h3>${cols(a.hours, a.hours.map((_, h) => h % 3 ? '' : (h % 12 || 12) + (h < 12 ? 'a' : 'p')), { peakTop: 3 })}</div>
        <div class="card"><h3>Sales by day of week</h3>${bars(a.weekdays.map((n, i) => ({ k: WD[i], n })), { fmt: rs })}</div></div>
      <div class="g2 wide-l" style="margin-top:16px"><div class="card"><h3>Best sellers</h3>${a.topItems.length ? `<div class="tbl" style="box-shadow:none;border:0"><table><thead><tr><th>Item</th><th class="r">Sold</th><th class="r">Sales</th></tr></thead><tbody>${a.topItems.map(i => `<tr><td>${esc(i.k)}</td><td class="r">${i.n}</td><td class="r">${rs(i.rev)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mute small">No sales yet.</p>'}
          ${a.notSelling.length ? `<h3 style="margin-top:14px">Not selling</h3><p class="small mute" style="margin:2px 0 0">${a.notSelling.map(esc).join(' · ')}</p>` : ''}</div>
        <div class="card"><h3>Ratings</h3>${bars(a.ratingSplit, { cls: 'mari' })}<h3 style="margin-top:14px">Latest reviews</h3>${a.reviews.length ? a.reviews.map(r => `<div class="li"><span><b>${r.rating} ★</b> ${esc(r.review)}<br><span class="small mute">${fmtDate(r.at)}</span></span></div>`).join('') : '<p class="mute small">No written reviews yet.</p>'}</div></div>`;
  }
  el.addEventListener('click', e => { const b = e.target.closest('[data-days]'); if (b) { days = +b.dataset.days; draw(); } });
  await draw();
}, { ...opt, title: 'Insights' });

/* ---------- settings ---------- */
route('/vendor/settings', async el => {
  const me = await guard(el); if (!me) return; const v = me.vendor;
  el.innerHTML = `<div class="phead"><div><h1>Shop settings</h1><p>What customers see about ${esc(v.name)}.</p></div></div>
    <div class="g2"><form class="card" id="sf">${onlineBar(v)}${field('prepMins', v.type === 'store' ? 'Minutes to pack an order' : 'Usual preparation time (minutes)', { type: 'number', value: v.prepMins, attrs: 'min="3" max="90"' })}${field('hours', 'Opening hours', { value: v.hours })}${field('offer', 'Offer shown on your card', { value: v.offer, ph: 'e.g. Free dessert above ₹499', hint: 'You fund this offer yourself' })}
      <div class="f"><span>Cover photo</span><label class="upl" style="position:relative">${v.image ? `<img src="${esc(v.image)}" alt="">` : icon('upload', 24)}<span>${v.image ? 'Replace photo' : 'Upload a photo of your best dish or shop'}</span><input type="file" accept="image/*" id="cover"></label></div>
      <button class="btn go block" style="margin-top:16px">Save</button></form>
    <div class="card"><h3>Business details</h3><p class="small mute">To change these, contact your zone manager.</p><dl class="dl"><dt>Type</dt><dd>${v.type === 'store' ? 'Shop' : 'Restaurant'}</dd><dt>Address</dt><dd>${esc(v.address)}</dd><dt>Owner</dt><dd>${esc(v.ownerName)}</dd><dt>PAN</dt><dd>${esc((v.pan || '').slice(0, 2))}••••••${esc((v.pan || '').slice(-2))}</dd><dt>${v.storeCategory === 'pharmacy' ? 'Drug licence' : 'FSSAI'}</dt><dd>${esc(v.storeCategory === 'pharmacy' ? v.drugLicense : v.fssai)}</dd><dt>GSTIN</dt><dd>${esc(v.gst || 'Not registered')}</dd><dt>Payout</dt><dd>${esc(v.upi || 'Bank ••••' + (v.accountNo || '').slice(-4))}</dd><dt>Commission</dt><dd>${me.commissionPct}% of item value</dd></dl></div></div>`;
  el.querySelector('#onl').onclick = async e => { e.preventDefault(); if (await toggleOnline(el, v)) nav('/vendor/settings', { replace: true }); };
  el.querySelector('#cover').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const d = await readFile(f); const { url } = await api.post('/api/upload', { dataUrl: d }); await api.patch('/api/vendor/me', { image: url }); toast('Cover photo updated', 'ok'); nav('/vendor/settings', { replace: true }); } catch (x) { toast(x.message, 'err'); } };
  el.querySelector('#sf').onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true); try { await api.patch('/api/vendor/me', Object.fromEntries(new FormData(e.target))); toast('Saved', 'ok'); } catch (x) { toast(x.message, 'err'); } busy(b, false); };
}, { ...opt, title: 'Settings' });
