// Customer app: discover, cart, checkout, live tracking, orders, account.
import { api, newKey } from './api.js';
import { S, store, route, nav, back, live, user, getCart, setQty, qtyOf, canAdd, cartShops, MAX_SHOPS, cartCount, cartTotal, clearCart, setCartMeta, onCart, refreshMe, logout, notifyOn } from './state.js';
import { $, $$, esc, rs, icon, art, pic, vegMark, toast, sheet, confirmBox, field, busy, empty, skel, fmtTime, fmtDT, fmtDate, ago, statusPill, confetti, flyTo, initials, colorFor, reduced } from './ui.js';
import { updateCustomerBar, zoneSheet, themeSeg } from './main.js';
import { makeMap, pin, glide, curve, along, kmBetween, locLL } from './map.js';

const alive = el => document.body.contains(el);
const FOOD_CATS = [['Biryani', 'biryani'], ['Pizza', 'pizza'], ['Thali', 'thali'], ['South Indian', 'dosa'], ['Burgers', 'burger'], ['Desserts', 'cake'], ['Breakfast', 'poha'], ['Chinese', 'noodles']];
const SHOP_CATS = [['Staples', 'basket'], ['Fruits & veg', 'veg'], ['Dairy', 'dairy'], ['Snacks', 'basket'], ['Medicines', 'meds'], ['Bakery', 'cake'], ['Household', 'basket']];
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const locQ = () => (S.addressId ? { address: S.addressId } : S.here ? { lat: S.here.lat, lng: S.here.lng } : {});

const isFav = id => !!S.me?.user?.favs?.includes(id);
const favBtn = (id, name, cls = 'fav') => `<button class="${cls}" data-fav="${id}" aria-pressed="${isFav(id)}" aria-label="${isFav(id) ? 'Remove' : 'Save'} ${esc(name)} ${isFav(id) ? 'from' : 'to'} favourites">${icon(isFav(id) ? 'heartOn' : 'heart', 18)}</button>`;
export function vendorCard(v, i = 0) {
  return `<div class="vcard" data-go="/v/${v.id}" role="link" tabindex="0" aria-label="${esc(v.name)}" style="--i:${typeof i === 'number' ? i : 0}"><div class="pic">${pic(v)}${v.offer ? `<div class="offer">${esc(v.offer)}</div>` : ''}${v.open ? '' : `<div class="closed">Closed now · schedule for later</div>`}${favBtn(v.id, v.name)}</div>
    <h3>${esc(v.name)}</h3><div class="meta">${v.rating ? `<span class="star">${icon('star', 12)} ${v.rating}</span>` : '<span class="star new">New</span>'}<span>·</span><span>${v.eta}–${v.eta + 5} mins</span></div>
    <div class="tags">${esc(v.tags.join(', '))} · ${v.dist} km${v.veg ? ' · Pure veg' : ''}</div></div>`;
}
/* favourites: capture phase so the heart never opens the card underneath it */
document.addEventListener('click', async e => {
  const f = e.target.closest('[data-fav]'); if (!f) return;
  e.preventDefault(); e.stopPropagation();
  if (!S.me) { toast('Log in to save favourites'); S.after = S.path; return nav('/login'); }
  const id = f.dataset.fav, on = !isFav(id);
  try { S.me = await api.post('/api/me/favourites', { vendorId: id, on }); document.querySelectorAll(`[data-fav="${id}"]`).forEach(b => { b.setAttribute('aria-pressed', on); b.innerHTML = icon(on ? 'heartOn' : 'heart', 18); b.classList.remove('b'); void b.offsetWidth; b.classList.add('b'); });
    toast(on ? 'Saved to favourites' : 'Removed from favourites', on ? 'ok' : ''); } catch (x) { toast(x.message, 'err'); }
}, true);
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=link][data-go]')) { e.preventDefault(); e.target.click(); } });

/* ---------- home ---------- */
route('/', async el => {
  if (!S.zoneId) { el.innerHTML = empty('Choose your area', 'Pick where we should deliver.', 'pin') + '<div style="text-align:center"><button class="btn go" data-act="zone">Choose area</button></div>'; return; }
  let type = store.get('ctype', 'restaurant'), tag = null, flt = new Set(), vendors = [], gcats = [], sort = store.get('csort', 'rel'), view = store.get('cview', 'list'), vmap = null;
  const zone = S.zones.find(z => z.id === S.zoneId);
  const coupons = () => (S.config?.coupons || []).filter(c => !c.vendorType || c.vendorType === type);
  const cats = () => type === 'restaurant' ? FOOD_CATS : SHOP_CATS;
  const banners = [['#ff5a36', 'pizza'], ['#0b7a43', 'basket'], ['#6b3fa0', 'cake'], ['#b5531a', 'thali']];
  el.innerHTML = `<section class="hello"><p class="mute" style="margin:0">${greet()}${user()?.name ? ', ' + esc(user().name.split(' ')[0]) : ''}</p><h1 id="htitle"></h1></section>
    <button class="search" data-go="/search">${icon('search')}<span id="ph" style="transition:opacity .3s">Search for “biryani”</span></button>
    <div class="row between wrap" style="margin-top:16px"><div class="seg" id="seg"><i></i><button data-t="restaurant">${icon('fire', 16)} Food</button><button data-t="store">${icon('bag', 16)} Grocery</button></div><span class="small mute">${esc(zone?.name || '')} · ${esc(zone?.city || '')}</span></div>
    <div id="body"></div>`;
  const seg = el.querySelector('#seg');
  const moveSeg = () => { const b = seg.querySelector(`[data-t="${type}"]`), i = seg.querySelector('i'); seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); i.style.left = b.offsetLeft + 'px'; i.style.width = b.offsetWidth + 'px'; };
  seg.onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.t === type) return; type = b.dataset.t; store.set('ctype', type); tag = null; flt.clear(); moveSeg(); load(); };
  const words = ['biryani', 'pizza', 'milk', 'paneer', 'poha', 'cake', 'atta', 'dosa']; let wi = 0;
  const tick = setInterval(() => { if (!alive(el)) return clearInterval(tick); const p = el.querySelector('#ph'); p.style.opacity = 0; setTimeout(() => { wi = (wi + 1) % words.length; p.textContent = `Search for “${words[wi]}”`; p.style.opacity = 1; }, 300); }, 2600);
  const body = el.querySelector('#body');
  function draw() {
    el.querySelector('#htitle').textContent = type === 'restaurant' ? 'What are you craving today?' : 'Groceries from shops near you';
    let list = vendors.filter(v => !tag || v.tags.some(t => t.toLowerCase().includes(tag.toLowerCase()) || tag.toLowerCase().includes(t.toLowerCase())));
    if (flt.has('rating')) list = list.filter(v => (v.rating || 0) >= 4.3);
    if (flt.has('fast')) list = list.filter(v => v.eta <= 25);
    if (flt.has('veg')) list = list.filter(v => v.veg);
    if (flt.has('offer')) list = list.filter(v => v.offer);
    if (flt.has('open')) list = list.filter(v => v.open);
    if (flt.has('fav')) list = list.filter(v => isFav(v.id));
    const by = { rating: (a, b) => (b.rating || 0) - (a.rating || 0), eta: (a, b) => a.eta - b.eta, dist: (a, b) => a.dist - b.dist, cost: (a, b) => a.costForTwo - b.costForTwo, costd: (a, b) => b.costForTwo - a.costForTwo }[sort];
    if (by) list = [...list].sort((a, b) => (b.open - a.open) || by(a, b));
    const favs = vendors.filter(v => isFav(v.id));
    const sg = S.config?.surge;
    const cs = coupons();
    body.innerHTML = `${cs.length ? `<div class="carousel" id="car">${cs.map((c, i) => { const [col, k] = banners[i % banners.length]; return `<button class="banner" data-coupon="${esc(c.code)}" style="background:${col}"><svg class="bg" viewBox="0 0 300 150" preserveAspectRatio="xMaxYMid slice" aria-hidden="true"><circle cx="250" cy="20" r="80" fill="#fff" opacity=".1"/><circle cx="300" cy="150" r="60" fill="#000" opacity=".1"/><g transform="translate(170 18) scale(1.2)">${art(k, col, { ratio: 'square' }).replace(/<rect[^>]*\/>/g, '').replace('<svg ', '<svg width="100" height="100" ')}</g></svg><b>${esc(c.title)}</b><span>${esc(c.desc)}</span><code>${esc(c.code)}</code></button>`; }).join('')}</div><div class="dots" id="dots">${cs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
      ${type === 'restaurant' ? `<section class="sec"><h2>${esc(user()?.name?.split(' ')[0] || 'Hey')}, what's on your mind?</h2><div class="cats">${cats().map(([t, k]) => `<button class="cat" data-tag="${esc(t)}" aria-pressed="${tag === t}"><div class="ring">${art(k, colorFor(k), { ratio: 'square' })}</div>${esc(t)}</button>`).join('')}</div></section>`
      : `<section class="sec"><form class="search gsearch" id="gsf" style="box-shadow:none">${icon('search')}<input name="q" placeholder="Search all groceries: milk, notebook, ice cream…" aria-label="Search groceries"></form>
        <div class="row between wrap" style="margin-top:18px"><h2>Shop by category</h2><span class="small mute">Only what can be delivered to ${esc(S.me?.user?.addresses?.find(a => a.id === S.addressId)?.area || zone?.name || 'you')} right now</span></div>
        <div class="gcats">${gcats.map((g, i) => `<button class="gcat ${g.items ? '' : 'empty'}" data-go="/g/${g.k}" style="--i:${i}" ${g.items ? '' : 'disabled'}><div class="gpic">${art(g.art, colorFor(g.art), { ratio: 'square' })}</div><b>${esc(g.label)}</b><small>${g.items ? `${g.items} item${g.items === 1 ? '' : 's'} · ${g.shops} shop${g.shops === 1 ? '' : 's'}` : 'Not available here yet'}</small></button>`).join('')}</div></section>`}
      ${favs.length && !flt.has('fav') ? `<section class="sec"><h2>Your favourites</h2><div class="hscroll">${favs.map(v => `<div class="favcard" data-go="/v/${v.id}" role="link" tabindex="0"><div class="thumb">${pic(v)}</div><span><b>${esc(v.name)}</b><small class="mute">${v.open ? `${v.eta} min` : 'Closed now'}</small></span></div>`).join('')}</div></section>` : ''}
      <section class="sec"><div class="chips">${[['rating', 'Rating 4.3+'], ['fast', 'Under 25 min'], ...(type === 'restaurant' ? [['veg', 'Pure veg']] : []), ['offer', 'Offers'], ['open', 'Open now'], ...(S.me ? [['fav', 'Favourites']] : [])].map(([k, t]) => `<button class="chip" data-f="${k}" aria-pressed="${flt.has(k)}">${k === 'fav' ? icon('heart', 14) : ''}${t}${flt.has(k) ? icon('x', 14) : ''}</button>`).join('')}</div>
      <div class="row between wrap" style="margin:14px 0 12px"><h2>${type === 'restaurant' ? `${list.length} restaurants delivering to you` : `Or shop from a store you know (${list.length})`}</h2>
        <div class="row" style="gap:8px"><label class="sortsel">${icon('filter', 16)}<span class="sr">Sort by</span><select id="sort" aria-label="Sort by">${[['rel', 'Relevance'], ['rating', 'Rating'], ['eta', 'Delivery time'], ['dist', 'Distance'], ...(type === 'restaurant' ? [['cost', 'Cost: low to high'], ['costd', 'Cost: high to low']] : [])].map(([k, t]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="seg sm" role="group" aria-label="View"><button data-view="list" aria-pressed="${view === 'list'}">${icon('list', 16)}<span class="sr">List</span></button><button data-view="map" aria-pressed="${view === 'map'}">${icon('map', 16)}<span class="sr">Map</span></button></div></div></div>
      ${!list.length ? empty('Nothing matches these filters', 'Try removing a filter.', 'filter') : view === 'map' ? '<div class="lmap tall" id="vmap"></div>' : `<div class="vgrid stag">${list.map(vendorCard).join('')}</div>`}</section>
      <section class="sec card" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:var(--brand);color:#fff;border:0"><div class="grow"><h3 style="color:var(--mari)">Own a shop or ride a bike?</h3><p style="margin:4px 0 0;opacity:.9">Earn with ZIPI. List your shop for free or deliver in your own neighbourhood.</p></div><button class="btn mari" data-go="/partner">Partner with us</button></section>`;
    if (sg?.fee) body.insertAdjacentHTML('afterbegin', `<div class="surge">${icon('bolt', 18)}<span><b>Busy right now: +${rs(sg.fee)} surge fee</b><small>${esc(sg.reasons.join(' · '))}. Most of it goes to riders so your order still arrives fast.</small></span></div>`);
    body.querySelector('#sort')?.addEventListener('change', e => { sort = e.target.value; store.set('csort', sort); draw(); });
    if (view === 'map' && list.length) drawMap(list);
    body.querySelector('#gsf')?.addEventListener('submit', e => { e.preventDefault(); const q = e.target.q.value.trim(); if (q.length < 2) return; S.gq = q; nav('/g/all'); });
    const car = body.querySelector('#car');
    if (car) { const dots = body.querySelectorAll('#dots i'); let k = 0;
      car.onscroll = () => { const i = Math.round(car.scrollLeft / (car.firstElementChild.offsetWidth + 12)); dots.forEach((d, j) => d.classList.toggle('on', j === i)); k = i; };
      const auto = setInterval(() => { if (!alive(car)) return clearInterval(auto); if (reduced()) return; k = (k + 1) % cs.length; car.scrollTo({ left: k * (car.firstElementChild.offsetWidth + 12), behavior: 'smooth' }); }, 4200); }
  }
  async function drawMap(list) {
    const host = body.querySelector('#vmap'); if (!host) return;
    const a = S.me?.user?.addresses?.find(x => x.id === S.addressId);
    try {
      const { L, m } = await makeMap(host, { center: { lat: zone.lat, lng: zone.lng }, zoom: 14 }); vmap = m;
      const pts = [];
      for (const v of list) { if (!v.ll) continue; pts.push([v.ll.lat, v.ll.lng]);
        L.marker([v.ll.lat, v.ll.lng], { icon: pin(L, 'shop', { color: v.color, dim: !v.open }), title: v.name }).addTo(m)
          .bindPopup(`<div class="mpop"><b>${esc(v.name)}</b><span>${v.rating ? '★ ' + v.rating + ' · ' : ''}${v.open ? `${v.eta}–${v.eta + 5} min` : 'Closed now'} · ${v.dist} km</span><button class="btn sm go" data-go="/v/${v.id}">View ${v.type === 'store' ? 'shop' : 'menu'}</button></div>`); }
      if (a) { const ll = a.lat ? a : locLL(S.zones.find(z => z.id === a.zoneId), a.loc); if (ll) { L.marker([ll.lat, ll.lng], { icon: pin(L, 'home'), title: 'You' }).addTo(m); pts.push([ll.lat, ll.lng]); } }
      if (pts.length > 1) m.fitBounds(pts, { padding: [30, 30] });
    } catch { host.outerHTML = `<div class="vgrid stag">${list.map(vendorCard).join('')}</div>`; toast('Map is unavailable right now. Showing the list.'); }
  }
  async function load() {
    body.innerHTML = `<div class="sk" style="height:150px;margin-top:16px;border-radius:20px"></div><div class="vgrid" style="margin-top:24px">${skel(6, 230)}</div>`;
    try { [vendors, S.config, gcats] = await Promise.all([api.get('/api/vendors', { zone: S.zoneId, type, ...locQ() }), api.get('/api/config', { zone: S.zoneId }).catch(() => S.config), type === 'store' ? api.get('/api/grocery/categories', { zone: S.zoneId }).catch(() => []) : []]); draw(); } catch (e) { body.innerHTML = empty('Could not load shops', e.message, 'alert'); }
  }
  body.onclick = e => {
    const vw = e.target.closest('[data-view]'); if (vw) { view = vw.dataset.view; store.set('cview', view); draw(); return; }
    const c = e.target.closest('[data-tag]'); if (c) { tag = tag === c.dataset.tag ? null : c.dataset.tag; draw(); return; }
    const f = e.target.closest('[data-f]'); if (f) { flt.has(f.dataset.f) ? flt.delete(f.dataset.f) : flt.add(f.dataset.f); draw(); return; }
    const b = e.target.closest('[data-coupon]'); if (b) { navigator.clipboard?.writeText(b.dataset.coupon).catch(() => {}); toast(`Use code ${b.dataset.coupon} at checkout`, 'ok'); setCartMeta({ coupon: b.dataset.coupon }); }
  };
  requestAnimationFrame(moveSeg); addEventListener('resize', moveSeg, { once: true });
  load();
}, { title: 'Home' });

/* ---------- add-to-cart control shared by menu, search ---------- */
const addCtl = it => { const q = qtyOf(it.id); return q ? `<div class="stp"><button data-dec="${it.id}" aria-label="Remove one ${esc(it.name)}">−</button><span>${q}</span><button data-inc="${it.id}" aria-label="Add one ${esc(it.name)}">+</button></div>` : it.available ? `<button class="add" data-inc="${it.id}">ADD</button>` : '<span class="pill g">Sold out</span>'; };
async function changeQty(vendor, it, d, btn) {
  const q = qtyOf(it.id) + d;
  if (d > 0 && it.stock != null && q > it.stock) { toast(`Only ${it.stock} left in stock`, 'err'); return false; }
  if (!setQty(vendor, it, q)) {
    const why = canAdd(vendor), cv = getCart().vendor;
    if (why === 'too-many') { toast(`One order can include up to ${MAX_SHOPS} shops. Check out these first.`, 'err'); return false; }
    const msg = why === 'mixed' ? `Food and groceries are delivered separately. Your cart has ${cv.type === 'store' ? 'groceries' : 'food from ' + cv.name}. Start a new cart with ${vendor.name}?`
      : `Food comes from one restaurant per order. Your cart has items from ${cv.name}. Start a new cart with ${vendor.name}?`;
    const ok = await confirmBox(msg, { ok: 'Start new cart', title: 'Replace cart?' });
    if (!ok) return false; clearCart(); setQty(vendor, it, q);
  }
  if (d > 0) { flyTo(btn, '#cartbar'); if (q === 1) api.post('/api/events', { type: 'add_cart', ref: vendor.id, zoneId: S.zoneId }).catch(() => {}); }
  return true;
}
function cartBarHTML(vendorId) {
  const c = getCart(); if (!c.vendorId || (vendorId && !c.shops[vendorId]) || !cartCount()) return '';
  const n = cartShops().length, label = n > 1 ? `From ${n} shops · one delivery` : c.vendor.name;
  return `<button class="cartbar" id="cartbar" data-go="/cart"><span>${cartCount()} item${cartCount() > 1 ? 's' : ''} · <span class="num">${rs(cartTotal())}</span><small>${esc(label)}</small></span><span class="row">View cart ${icon('chevR', 18)}</span></button>`;
}
function mountCartBar(el, vendorId) {
  let wrap = el.querySelector('#cbw'); if (!wrap) { wrap = document.createElement('div'); wrap.id = 'cbw'; el.appendChild(wrap); }
  const draw = () => { if (!alive(el)) return off(); const had = !!wrap.firstElementChild; wrap.innerHTML = cartBarHTML(vendorId); if (had && wrap.firstElementChild) { wrap.firstElementChild.style.animation = 'none'; wrap.firstElementChild.classList.add('b'); } };
  const off = onCart(draw); draw();
}

/* ---------- vendor page ---------- */
route('/v/:id', async (el, { id }) => {
  el.innerHTML = `<div class="sk" style="height:200px;margin:0 -16px"></div><div class="sk" style="height:140px;margin-top:-30px"></div>${skel(4, 120)}`;
  const { vendor: v, items } = await api.get('/api/vendors/' + id, locQ());
  api.post('/api/events', { type: 'view_vendor', ref: id, zoneId: S.zoneId }).catch(() => {});
  let vegOnly = false, q = '', warnedClosed = false;
  const isStore = v.type === 'store';
  const coupons = (S.config?.coupons || []).filter(c => !c.vendorType || c.vendorType === v.type);
  const sections = [...new Set(items.map(i => i.section))];
  el.innerHTML = `<div class="vhero">${pic(v)}<button class="back" data-back aria-label="Back">${icon('chevL', 22)}</button></div>
    <div class="vhead"><div class="row between" style="align-items:flex-start"><div><h1 style="font-size:28px">${esc(v.name)}</h1><p class="mute" style="margin:2px 0 0">${esc(v.tags.join(' · '))}${v.veg ? ' · <span style="color:#0b8a3e;font-weight:700">Pure veg</span>' : ''}</p><p class="small mute" style="margin:2px 0 0">${icon('pin', 14)} ${esc(v.address)} · ${v.dist} km</p></div><div class="row" style="gap:6px">${v.rating ? `<span class="star" style="font-size:15px;padding:4px 8px">${icon('star', 14)} ${v.rating}</span>` : '<span class="star new">New</span>'}${favBtn(v.id, v.name, 'fav inline')}</div></div>
      <div class="vstats"><div><b>${v.rating ? v.rating + ' ★' : 'New'}</b>${v.ratingCount ? (v.ratingCount > 999 ? (v.ratingCount / 1000).toFixed(1) + 'k' : v.ratingCount) + ' ratings' : 'No ratings yet'}</div><div><b>${v.eta}–${v.eta + 5} min</b>Delivery</div><div><b>${isStore ? v.itemCount + ' items' : rs(v.costForTwo)}</b>${isStore ? 'In stock' : 'For two'}</div></div>
      ${!v.open ? `<div class="saved" style="background:var(--redTint);color:var(--red);margin-top:12px">${icon('clock', 18)} Closed right now (${esc(v.hours)}). You can still order and schedule delivery for later.</div>` : ''}</div>
    ${(v.offer || coupons.length) ? `<div class="offers">${v.offer ? `<div class="ofr"><span class="ic">${icon('tag', 18)}</span><span><b>${esc(v.offer)}</b><small>Shop offer</small></span></div>` : ''}${coupons.map(c => `<div class="ofr"><span class="ic">${icon('gift', 18)}</span><span><b>${esc(c.title)}</b><small>Use ${esc(c.code)}</small></span></div>`).join('')}</div>` : ''}
    <div class="menuhead"><div class="search" style="flex:1;min-width:200px;box-shadow:none;min-height:44px">${icon('search', 18)}<input id="mq" placeholder="Search in ${esc(v.name)}" aria-label="Search menu"></div>${isStore ? '' : `<button class="chip" id="vego" aria-pressed="false">${vegMark(true)} Veg only</button>`}<button class="chip" id="secbtn">${icon('menu', 16)} ${isStore ? 'Aisles' : 'Menu'}</button></div>
    <div id="menu"></div>`;
  const menu = el.querySelector('#menu');
  const itemRow = it => `<div class="item ${it.available ? '' : 'off'}" id="i-${it.id}"><div class="txt">${vegMark(it.veg)} ${it.bestseller ? `<span class="best">${icon('star', 12)} Bestseller</span>` : ''}<h4>${esc(it.name)}</h4><div class="price num">${rs(it.price)}${it.mrp && it.mrp > it.price ? `<s>${rs(it.mrp)}</s>` : ''}</div>${it.stock != null && it.stock > 0 && it.stock <= 5 ? `<div class="low">Only ${it.stock} left</div>` : ''}${it.desc ? `<p>${esc(it.desc)}</p>` : ''}</div>
    <div class="pic">${pic(it, v.art, 'square')}<div class="addw" data-w="${it.id}">${addCtl(it)}</div></div></div>`;
  const prodCard = it => `<div class="prod ${it.available ? '' : 'off'}" id="i-${it.id}">${it.mrp && it.mrp > it.price ? `<span class="disc">${Math.round(100 * (it.mrp - it.price) / it.mrp)}% OFF</span>` : ''}<div class="pic">${pic(it, v.art, 'square')}</div><b>${esc(it.name)}</b><span class="u">${esc(it.unit)}</span>${it.stock != null && it.stock > 0 && it.stock <= 5 ? `<span class="low">Only ${it.stock} left</span>` : ''}
    <div class="bot"><span class="num"><b>${rs(it.price)}</b>${it.mrp && it.mrp > it.price ? ` <s class="small mute">${rs(it.mrp)}</s>` : ''}</span><span data-w="${it.id}">${addCtl(it)}</span></div></div>`;
  const draw = () => {
    const ql = q.toLowerCase();
    const list = items.filter(i => (!vegOnly || i.veg === true) && (!ql || i.name.toLowerCase().includes(ql)));
    const secs = sections.filter(s => list.some(i => i.section === s));
    menu.innerHTML = secs.length ? secs.map(s => { const its = list.filter(i => i.section === s).sort((a, b) => b.available - a.available); return `<section class="msec" id="s-${esc(s.replace(/\W/g, ''))}"><h3>${esc(s)} <span class="mute small">(${its.length})</span></h3>${isStore ? `<div class="pgrid stag" style="margin-top:12px">${its.map(prodCard).join('')}</div>` : `<div class="items">${its.map(itemRow).join('')}</div>`}</section>`; }).join('')
      : empty(`No items match “${q}”`, 'Try another word.', 'search');
  };
  draw();
  el.querySelector('#mq').oninput = e => { q = e.target.value; draw(); };
  el.querySelector('#vego')?.addEventListener('click', e => { vegOnly = !vegOnly; e.currentTarget.setAttribute('aria-pressed', vegOnly); draw(); });
  el.querySelector('#secbtn').onclick = () => { const s = sheet(`<div class="stack">${sections.map(x => `<button class="btn block" style="justify-content:space-between" data-sec="${esc(x.replace(/\W/g, ''))}"><span>${esc(x)}</span><span class="mute">${items.filter(i => i.section === x).length}</span></button>`).join('')}</div>`, { title: isStore ? 'Aisles' : 'Menu' });
    s.el.onclick = e => { const b = e.target.closest('[data-sec]'); if (b) { s.close(); setTimeout(() => el.querySelector('#s-' + b.dataset.sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 260); } }; };
  el.querySelector('[data-back]').onclick = () => back('/');
  menu.addEventListener('click', async e => {
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'); const b = inc || dec; if (!b) return;
    if (!v.open && inc && !warnedClosed) { warnedClosed = true; toast(`${v.name} is closed now. Pick a delivery time at checkout.`); }
    const it = items.find(i => i.id === (inc ? inc.dataset.inc : dec.dataset.dec));
    if (await changeQty(v, it, inc ? 1 : -1, b)) { const w = menu.querySelector(`[data-w="${it.id}"]`); w.innerHTML = addCtl(it); const sp = w.querySelector('.stp span'); if (sp) { sp.classList.remove('b'); void sp.offsetWidth; sp.classList.add('b'); } }
  });
  mountCartBar(el, v.id);
}, { title: 'Shop' });

/* ---------- grocery: one category, items from every nearby open shop ---------- */
route('/g/:cat', async (el, { cat }) => {
  if (!S.zoneId) return nav('/');
  let q = S.gq || '', shop = '', sort = 'rel', data = null; S.gq = '';
  const cats = await api.get('/api/grocery/categories', { zone: S.zoneId }).catch(() => []);
  const meta = cats.find(x => x.k === cat) || { k: 'all', label: 'All groceries', art: 'basket' };
  el.innerHTML = `<div class="row" style="margin:6px 0 10px"><button class="iconbtn" data-back aria-label="Back">${icon('chevL', 22)}</button><div class="thumb" style="width:44px;height:44px">${art(meta.art, colorFor(meta.art), { ratio: 'square' })}</div><div class="grow"><h1 style="font-size:26px">${esc(meta.label)}</h1><span class="small mute" id="gsub"></span></div></div>
    <div class="gtabs" id="gtabs">${[{ k: 'all', label: 'All' }, ...cats.filter(x => x.items)].map(x => `<button class="chip" data-cat="${x.k}" aria-pressed="${x.k === cat}">${esc(x.label)}</button>`).join('')}</div>
    <div class="menuhead"><div class="search" style="flex:1;min-width:200px;box-shadow:none;min-height:44px">${icon('search', 18)}<input id="gq" placeholder="Search in ${esc(meta.label.toLowerCase())}" value="${esc(q)}" aria-label="Search items"></div>
      <label class="sortsel">${icon('filter', 16)}<select id="gsort" aria-label="Sort">${[['rel', 'Popular'], ['price', 'Price: low to high'], ['priced', 'Price: high to low'], ['discount', 'Biggest discount']].map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label></div>
    <div class="chips" id="gshops" style="margin:4px 0 12px"></div><div id="glist">${skel(2, 160)}</div>`;
  el.querySelector('[data-back]').onclick = () => back('/');
  const list = el.querySelector('#glist');
  const card = it => `<div class="prod ${it.available ? '' : 'off'}" id="i-${it.id}">${it.mrp && it.mrp > it.price ? `<span class="disc">${Math.round(100 * (it.mrp - it.price) / it.mrp)}% OFF</span>` : ''}<div class="pic">${pic(it, it.art, 'square')}</div><b>${esc(it.name)}</b><span class="u">${esc(it.unit)}</span>
    <span class="gshop" data-go="/v/${it.vendor.id}">${icon('store', 12)} ${esc(it.vendor.name)} · ${it.vendor.eta} min</span>${it.stock != null && it.stock > 0 && it.stock <= 5 ? `<span class="low">Only ${it.stock} left</span>` : ''}
    <div class="bot"><span class="num"><b>${rs(it.price)}</b>${it.mrp && it.mrp > it.price ? ` <s class="small mute">${rs(it.mrp)}</s>` : ''}</span><span data-w="${it.id}">${addCtl(it)}</span></div></div>`;
  function draw() {
    if (!alive(el) || !data) return;
    const items = data.items, cart = getCart();
    el.querySelector('#gsub').textContent = `${items.length} item${items.length === 1 ? '' : 's'} from ${data.shops.length} shop${data.shops.length === 1 ? '' : 's'} near you`;
    el.querySelector('#gshops').innerHTML = data.shops.length > 1 ? [`<button class="chip" data-shop="" aria-pressed="${!shop}">All shops</button>`, ...data.shops.map(v => `<button class="chip" data-shop="${v.id}" aria-pressed="${shop === v.id}">${esc(v.name)} · ${v.eta} min</button>`)].join('') : '';
    const shown = shop ? items.filter(i => i.vendorId === shop) : items;
    // group by aisle so similar things sit together
    const groups = new Map(); for (const it of shown) { const k = it.section || 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    list.innerHTML = (cart.vendor?.type === 'store' && shown.some(i => !cart.shops[i.vendorId]) && data.shops.length > 1 ? `<div class="saved" style="margin-bottom:12px;animation:none">${icon('info', 16)} Add from any shop here. You check out once and ZIPI decides whether one delivery partner can bring it all or sends two to get it to you sooner.</div>` : '')
      + (shown.length ? [...groups].map(([sec, its]) => `<section class="msec"><h3>${esc(sec)} <span class="mute small">(${its.length})</span></h3><div class="pgrid stag" style="margin-top:12px">${its.map(card).join('')}</div></section>`).join('')
        : empty(q ? `Nothing matches “${q}”` : 'Nothing here right now', q ? 'Try another word or category. We note what people look for to bring more shops on.' : 'Shops near you have run out. Check back soon.', 'search'));
  }
  async function load() {
    try { data = await api.get('/api/grocery/items', { zone: S.zoneId, category: cat === 'all' ? '' : cat, q, sort, ...locQ() }); if (shop && !data.shops.some(v => v.id === shop)) shop = ''; draw(); }
    catch (e) { list.innerHTML = empty('Could not load items', e.message, 'alert'); }
  }
  let t; el.querySelector('#gq').oninput = e => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); load(); }, 300); };
  el.querySelector('#gsort').onchange = e => { sort = e.target.value; load(); };
  el.addEventListener('click', async e => {
    const c = e.target.closest('[data-cat]'); if (c) { if (c.dataset.cat !== cat) { S.gq = q; nav('/g/' + c.dataset.cat, { replace: true }); } return; }
    const sh = e.target.closest('[data-shop]'); if (sh) { shop = sh.dataset.shop; draw(); return; }
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'), b = inc || dec; if (!b || !data) return;
    const it = data.items.find(i => i.id === (inc ? inc.dataset.inc : dec.dataset.dec));
    if (await changeQty(it.vendor, it, inc ? 1 : -1, b)) { const w = list.querySelector(`[data-w="${it.id}"]`); if (w) w.innerHTML = addCtl(it); draw(); }
  });
  live(() => load()); await load(); mountCartBar(el);
}, { title: 'Groceries' });

/* ---------- search ---------- */
route('/search', async el => {
  const recent = store.get('recent', []);
  el.innerHTML = `<div class="row" style="margin:6px 0 14px"><button class="iconbtn" data-back aria-label="Back">${icon('chevL', 22)}</button><div class="search grow" style="box-shadow:none">${icon('search')}<input id="sq" placeholder="Search dishes, shops or groceries" aria-label="Search" autocomplete="off"><button class="iconbtn" id="clr" aria-label="Clear" hidden>${icon('x', 18)}</button></div></div><div id="res"></div>`;
  const inp = el.querySelector('#sq'), res = el.querySelector('#res'), clr = el.querySelector('#clr');
  el.querySelector('[data-back]').onclick = () => back('/');
  let t1, t2, lastLogged = '', data = null;
  const idle = () => {
    res.innerHTML = `${recent.length ? `<h3 style="margin:8px 0 10px">Recent searches</h3><div class="chips wrap" style="flex-wrap:wrap">${recent.map(r => `<button class="chip" data-q="${esc(r)}">${icon('clock', 14)} ${esc(r)}</button>`).join('')}</div>` : ''}
      <h3 style="margin:22px 0 10px">Popular near you</h3><div class="cats">${[...FOOD_CATS.slice(0, 5), ['Milk', 'dairy'], ['Vegetables', 'veg'], ['Atta', 'basket']].map(([t, k]) => `<button class="cat" data-q="${esc(t)}"><div class="ring">${art(k, colorFor(k), { ratio: 'square' })}</div>${esc(t)}</button>`).join('')}</div>`;
  };
  const show = (qq) => {
    if (!data) return;
    const { vendors, items } = data;
    if (!vendors.length && !items.length) { res.innerHTML = `<div class="empty">${icon('search', 44)}<b>No shop near you has “${esc(qq)}” yet</b>We've noted your search. ZIPI uses what people look for to decide which shops to bring on next.<div style="margin-top:14px"><button class="btn" data-act="zone">Check another area</button></div></div>`; return; }
    res.innerHTML = `${vendors.length ? `<h3 style="margin:6px 0 12px">Shops</h3><div class="vgrid stag">${vendors.slice(0, 6).map(vendorCard).join('')}</div>` : ''}
      ${items.length ? `<h3 style="margin:24px 0 4px">Dishes and products</h3><div class="items">${items.map(it => `<div class="item ${it.available && it.vendor.open ? '' : 'off'}"><div class="txt">${vegMark(it.veg)}<h4>${esc(it.name)}</h4><div class="price num">${rs(it.price)}</div><p><a href="#/v/${it.vendor.id}" data-go="/v/${it.vendor.id}">${esc(it.vendor.name)}</a> · ${it.vendor.eta} min${it.vendor.open ? '' : ' · closed'}</p></div><div class="pic">${pic(it, it.vendor.art, 'square')}<div class="addw" data-w="${it.id}">${it.vendor.open ? addCtl(it) : '<span class="pill g">Closed</span>'}</div></div></div>`).join('')}</div>` : ''}`;
  };
  const run = async (qq, log) => {
    try { data = await api.get('/api/search', { zone: S.zoneId, q: qq, log: log ? 1 : 0, ...locQ() }); if (inp.value.trim() === qq) show(qq); } catch (e) { toast(e.message, 'err'); }
    if (log && !recent.includes(qq)) { recent.unshift(qq); recent.length = Math.min(recent.length, 6); store.set('recent', recent); }
  };
  inp.oninput = () => {
    const qq = inp.value.trim(); clr.hidden = !qq; clearTimeout(t1); clearTimeout(t2);
    if (qq.length < 2) { idle(); return; }
    res.innerHTML = `<div class="vgrid">${skel(2, 200)}</div>`;
    t1 = setTimeout(() => run(qq, false), 280);
    t2 = setTimeout(() => { if (qq !== lastLogged) { lastLogged = qq; run(qq, true); } }, 1400);
  };
  inp.onkeydown = e => { if (e.key === 'Enter') { const qq = inp.value.trim(); if (qq.length > 1 && qq !== lastLogged) { clearTimeout(t2); lastLogged = qq; run(qq, true); } } };
  clr.onclick = () => { inp.value = ''; inp.oninput(); inp.focus(); };
  res.addEventListener('click', async e => {
    const c = e.target.closest('[data-q]'); if (c) { inp.value = c.dataset.q; inp.oninput(); return; }
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'); const b = inc || dec; if (!b || !data) return;
    const it = data.items.find(i => i.id === (inc ? inc.dataset.inc : dec.dataset.dec));
    if (await changeQty(it.vendor, it, inc ? 1 : -1, b)) res.querySelector(`[data-w="${it.id}"]`).innerHTML = addCtl(it);
  });
  idle(); inp.focus(); mountCartBar(el);
}, { title: 'Search' });

/* ---------- cart & checkout ---------- */
function addressForm(vendorZone, a = {}) {
  const lbl = a.label || 'Home', std = ['Home', 'Work', 'Other'].includes(lbl);
  return `<form id="af"><div class="search addrsearch" style="box-shadow:none;min-height:44px">${icon('search', 18)}<input id="asq" placeholder="Search your area, street or building" autocomplete="off" aria-label="Search address"></div><div id="asr" class="asr"></div>
    <div class="pickmap" id="pmw"><div class="lmap" id="pm"></div><div class="pincenter" aria-hidden="true">${icon('pin', 40)}</div>
      <button type="button" class="btn sm gpsbtn" id="gps">${icon('locate', 16)} Use my location</button></div>
    <p class="small mute" id="pmhint" style="margin:6px 0 0">Move the map so the pin sits on your door. Riders use it to find you.</p><input type="hidden" name="lat"><input type="hidden" name="lng">
    <div class="row wrap" style="gap:8px;margin-top:10px">${['Home', 'Work', 'Other'].map(l => `<label class="chip"><input type="radio" name="labelPick" value="${l}" ${(std ? lbl : 'Other') === l ? 'checked' : ''} style="accent-color:#0b7a43"> ${l}</label>`).join('')}
      <input class="in" name="labelOther" placeholder="Name it, e.g. Mom's place" value="${std ? '' : esc(lbl)}" style="flex:1;min-width:160px;min-height:38px" ${std && lbl !== 'Other' ? 'hidden' : ''} maxlength="24" aria-label="Address name"></div>
    ${field('line', 'House / flat no. and street', { req: true, ph: 'Flat 302, Scheme 54', value: a.line || '' })}
    <div class="grid2">${field('building', 'Building / society (optional)', { ph: 'Shubh Residency', value: a.building || '' })}${field('floor', 'Floor (optional)', { ph: '3rd', value: a.floor || '' })}</div>
    <div class="grid2">${field('area', 'Area / locality', { req: true, ph: 'Vijay Nagar', value: a.area || '' })}${field('landmark', 'Landmark (optional)', { ph: 'Near C21 Mall', value: a.landmark || '' })}</div>
    ${field('instructions', 'Instructions for the rider (optional)', { ph: 'e.g. Ring twice, leave with the guard', value: a.instructions || '' })}
    <details class="refbox" ${a.receiverName ? 'open' : ''}><summary class="small">Someone else will receive it?</summary><div class="grid2">${field('receiverName', 'Their name', { value: a.receiverName || '' })}${field('receiverPhone', 'Their phone', { type: 'tel', ph: '10 digits', value: a.receiverPhone || '' })}</div></details>
    ${field('zoneId', 'Delivery zone', { options: S.zones.filter(z => z.active).map(z => [z.id, `${z.name}, ${z.city}`]), value: a.zoneId || vendorZone || S.zoneId })}
    <label class="check"><input type="checkbox" name="makeDefault" ${a.id && S.me?.user?.defaultAddress === a.id ? 'checked disabled' : ''}> Make this my default address</label>
    <button class="btn go block big" style="margin-top:12px">${a.id ? 'Save changes' : 'Save address'}</button></form>`;
}
export function addAddressSheet(vendorZone, existing = null) {
  return new Promise(res => {
    const fromHere = !existing && S.here && (!vendorZone || S.here.zoneId === vendorZone) ? S.here : null; // start at the detected location
    const s = sheet(addressForm(vendorZone, existing || (fromHere ? { area: fromHere.area, zoneId: fromHere.zoneId } : {})), { title: existing ? 'Edit address' : 'Add delivery address', onClose: () => res(null) });
    const form = s.el.querySelector('#af'), zsel = form.querySelector('[name=zoneId]'), zoneOf = id => S.zones.find(z => z.id === id);
    let pm = null, revT = null, typed = !!existing;
    form.addEventListener('input', e => { if (['line', 'area'].includes(e.target.name)) typed = true; });
    form.addEventListener('change', e => { if (e.target.name === 'labelPick') form.labelOther.hidden = e.target.value !== 'Other'; });
    const setLL = ll => { form.lat.value = ll.lat.toFixed(6); form.lng.value = ll.lng.toFixed(6);
      const z = zoneOf(zsel.value), far = z?.lat != null && kmBetween(ll, z) > 8; form.querySelector('#pmhint').innerHTML = far ? `<span style="color:var(--red)">${icon('alert', 14)} This pin is outside ${esc(z.name)}. Move it closer or pick another zone.</span>` : 'Move the map so the pin sits on your door. Riders use it to find you.';
      // fill the area from the pin while the person has not typed their own
      clearTimeout(revT); revT = setTimeout(async () => { if (typed) return; const r = await api.get('/api/maps/reverse', ll).catch(() => null); if (r?.area && !typed) { form.area.value = r.area; if (r.road && !form.line.value) form.line.placeholder = r.road; } }, 700); };
    (async () => {
      const exact = existing?.lat ? existing : fromHere, start = exact || zoneOf(zsel.value); if (!start?.lat) { form.querySelector('#pmw').hidden = true; return; }
      if (fromHere?.line && !form.line.value) form.line.placeholder = fromHere.line;
      try { const { m } = await makeMap(form.querySelector('#pm'), { center: { lat: start.lat, lng: start.lng }, zoom: exact ? 17 : 15 }); pm = m; setLL(m.getCenter()); m.on('moveend', () => setLL(m.getCenter())); }
      catch { form.querySelector('#pmw').hidden = true; form.querySelector('#pmhint').hidden = true; }
    })();
    zsel.onchange = () => { const z = zoneOf(zsel.value); if (pm && z?.lat) pm.setView([z.lat, z.lng], 15); };
    // address search (OpenStreetMap), biased to the chosen zone
    const sq = s.el.querySelector('#asq'), sr = s.el.querySelector('#asr'); let sT = null;
    sq.oninput = () => { clearTimeout(sT); const q = sq.value.trim(); if (q.length < 3) { sr.innerHTML = ''; return; }
      sT = setTimeout(async () => { const list = await api.get('/api/maps/search', { q, zone: zsel.value }).catch(() => []);
        sr.innerHTML = list.length ? list.map((r, i) => `<button type="button" class="li" data-res="${i}">${icon('pin', 16)}<span class="small">${esc(r.label)}</span></button>`).join('') : '<p class="small mute">No matches. Move the pin on the map instead.</p>'; sr._list = list; }, 450); };
    sr.onclick = e => { const b = e.target.closest('[data-res]'); if (!b) return; const r = sr._list[+b.dataset.res];
      const near = S.zones.filter(z => z.active && z.lat != null).map(z => [z, kmBetween(r, z)]).sort((a, b) => a[1] - b[1])[0]; if (near && near[1] <= 8) zsel.value = near[0].id;
      if (r.area) form.area.value = r.area; if (r.road && !form.line.value) form.line.value = r.road; typed = true; pm?.setView([r.lat, r.lng], 17); sr.innerHTML = ''; sq.value = ''; };
    form.querySelector('#gps').onclick = e => {
      if (!navigator.geolocation) return toast('Location is not available on this device', 'err');
      const b = e.currentTarget; busy(b, true);
      navigator.geolocation.getCurrentPosition(p => { busy(b, false); const ll = { lat: p.coords.latitude, lng: p.coords.longitude };
        const near = S.zones.filter(z => z.active && z.lat != null).map(z => [z, kmBetween(ll, z)]).sort((a, b) => a[1] - b[1])[0];
        if (near && near[1] <= 8) zsel.value = near[0].id; else toast(near ? `You're ${near[1].toFixed(1)} km from ${near[0].name}, outside our delivery zones` : 'Outside our delivery zones', 'err');
        typed = false; pm?.setView([ll.lat, ll.lng], 17); },
      err => { busy(b, false); toast(err.code === 1 ? 'Allow location access to use this' : isSecureContext ? 'Could not get your location' : 'Location needs a secure (https) connection', 'err'); }, { enableHighAccuracy: true, timeout: 10000 });
    };
    form.onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true);
      const f = Object.fromEntries(new FormData(form)); f.label = f.labelPick === 'Other' ? (f.labelOther || 'Other') : f.labelPick; delete f.labelPick; delete f.labelOther; f.makeDefault = form.makeDefault.checked;
      try { const r = existing ? await api.patch('/api/me/addresses/' + existing.id, f) : await api.post('/api/me/addresses', f); S.me = { ...S.me, user: r.user }; toast(existing ? 'Address updated' : 'Address saved', 'ok'); res(r.address); s.close(); }
      catch (x) { toast(x.message, 'err'); busy(b, false); } };
  });
}
route('/cart', async el => {
  const c = getCart();
  if (!cartCount()) { el.innerHTML = `<h1 style="margin:14px 0">Cart</h1>${empty('Your cart is empty', 'Good food and groceries are a few taps away.', 'bag')}<div style="text-align:center"><button class="btn go" data-go="/">Browse shops</button></div>`; return; }
  const loggedIn = !!S.me;
  if (cartShops().length > 1) return basketCheckout(el, loggedIn);
  let pay = store.get('pay', 'UPI'), quote = null, addr = null, useCoins = store.get('coins', true), when = 'now', slot = '';
  const addrs = () => (S.me?.user?.addresses || []);
  const pickAddr = () => { const all = addrs(), def = S.me?.user?.defaultAddress; addr = all.find(a => a.id === S.addressId && a.zoneId === c.vendor?.zoneId) || all.find(a => a.id === def && a.zoneId === c.vendor?.zoneId) || all.find(a => a.zoneId === c.vendor?.zoneId) || all.find(a => a.id === S.addressId) || all[0] || null; };
  let idemKey = newKey(); // one key per checkout: a double tap or a retry on bad network cannot create two orders
  let vend = null; try { vend = (await api.get('/api/vendors/' + c.vendorId)).vendor; c.vendor.zoneId = vend.zoneId; } catch { }
  pickAddr();
  if (loggedIn) api.post('/api/events', { type: 'checkout', ref: c.vendorId, zoneId: S.zoneId }).catch(() => {});
  el.innerHTML = `<div class="row" style="margin:6px 0 14px"><button class="iconbtn" data-back aria-label="Back">${icon('chevL', 22)}</button><h1 style="font-size:28px">Checkout</h1></div><div class="cgrid"><div id="left"></div><div class="side" id="right"></div></div>`;
  el.querySelector('[data-back]').onclick = () => back('/v/' + c.vendorId);
  const L = el.querySelector('#left'), R = el.querySelector('#right');
  const lines = () => Object.values(getCart().lines);
  async function requote() {
    if (!loggedIn) return draw();
    try { quote = await api.post('/api/orders/quote', { vendorId: c.vendorId, items: lines().map(l => ({ itemId: l.id, qty: l.qty })), coupon: getCart().coupon, addressId: addr?.id, useCoins });
      if (!quote.open && when === 'now') { when = 'later'; slot = slot || slots()[0]?.[0] || ''; } }
    catch (e) { toast(e.message, 'err'); quote = null; }
    draw();
  }
  function draw() {
    if (!alive(el)) return;
    const cc = getCart(); if (!cartCount()) { nav('/cart', { replace: true }); return; }
    const q = quote, unavailable = q ? q.lines.filter(l => !l.available) : [];
    L.innerHTML = `<div class="card"><div class="row" style="margin-bottom:6px"><div class="thumb">${pic(cc.vendor)}</div><div class="grow"><b>${esc(cc.vendor.name)}</b><div class="small mute">${vend ? `${vend.eta}–${vend.eta + 5} min · ${vend.dist} km` : ''}</div></div></div>
      ${lines().map(l => { const bad = unavailable.find(u => u.itemId === l.id); return `<div class="li"><span class="grow">${vegMark(l.veg)} ${esc(l.name)}${bad ? `<br><span class="low">${bad.stockLeft ? `Only ${bad.stockLeft} left` : 'Sold out'}</span>` : ''}</span><div class="stp" style="min-width:90px;animation:none"><button data-dec="${l.id}" aria-label="Remove one">−</button><span>${l.qty}</span><button data-inc="${l.id}" aria-label="Add one">+</button></div><b class="num" style="width:64px;text-align:right">${rs(l.qty * l.price)}</b></div>`; }).join('')}
      <label class="f"><span>Note for the ${cc.vendor.type === 'store' ? 'shop' : 'kitchen'}</span><textarea class="in" id="note" placeholder="${cc.vendor.type === 'store' ? 'e.g. Pick ripe bananas' : 'e.g. Less spicy, no onion'}" maxlength="200">${esc(cc.note || '')}</textarea></label>
      <button class="btn ghost sm" data-go="/v/${cc.vendorId}" style="margin-top:8px">${icon('plus', 16)} Add more items</button></div>`;
    if (!loggedIn) {
      R.innerHTML = `<div class="bill"><div class="kv"><span>Item total</span><span class="num">${rs(cartTotal())}</span></div><p class="small mute">Delivery fee and offers are worked out after you log in.</p><button class="btn go big block" data-act="login-to-order">Log in to place order</button></div>`;
      R.querySelector('[data-act]').onclick = () => { S.after = '/cart'; nav('/login'); }; return;
    }
    const zoneBad = addr && vend && addr.zoneId !== vend.zoneId;
    R.innerHTML = `<div class="stack">
      <button class="coupon" id="cpn">${icon('gift', 22)}<span class="grow"><b>${q?.couponApplied ? `${esc(q.couponApplied)} applied` : 'Apply a coupon'}</b><br><span class="small">${q?.couponApplied ? `You save ${rs(q.discount)}` : q?.couponError ? esc(q.couponError) : 'See offers for this order'}</span></span>${q?.couponApplied ? `<span class="btn sm ghost" data-rmc>Remove</span>` : icon('chevR', 18)}</button>
      ${q?.discount ? `<div class="saved">${icon('spark', 18)} You're saving ${rs(q.discount)} on this order</div>` : ''}
      <div class="card"><div class="row between"><b>Deliver to</b><button class="btn ghost sm" id="chaddr">${addr ? 'Change' : 'Add address'}</button></div>${addr ? `<div class="row" style="margin-top:6px;align-items:flex-start">${icon(addr.label === 'Work' ? 'store' : 'home', 20)}<span><b>${esc(addr.label)}</b><br><span class="small mute">${esc(addr.line)}, ${esc(addr.area)}${addr.landmark ? ' · ' + esc(addr.landmark) : ''}</span></span></div>` : '<p class="small mute" style="margin:6px 0 0">Add where we should deliver.</p>'}
        ${zoneBad ? `<div class="err">${esc(cc.vendor.name)} does not deliver to ${esc(addr.area)}. Choose an address in ${esc(S.zones.find(z => z.id === vend.zoneId)?.name || 'its zone')}.</div>` : ''}</div>
      <div class="card"><div class="row between"><b>Delivery time</b>${q && !q.open ? '<span class="pill r">Shop closed now</span>' : ''}</div>
        <div class="payopt" style="margin-top:8px"><button data-when="now" aria-pressed="${when === 'now'}" ${q && !q.open ? 'disabled' : ''}><b>${icon('bolt', 16)} Now</b><span class="small mute">${vend ? `${vend.eta}–${vend.eta + 5} min` : 'As soon as possible'}</span></button><button data-when="later" aria-pressed="${when === 'later'}"><b>${icon('cal', 16)} Schedule</b><span class="small mute">Up to ${S.config?.scheduleDays || 2} days ahead</span></button></div>
        ${when === 'later' ? `<label class="f" style="margin-top:8px"><span>Deliver at</span><select class="in" id="slot">${slots().map(([v, t]) => `<option value="${v}" ${String(v) === String(slot) ? 'selected' : ''}>${t}</option>`).join('')}</select></label><div class="hint">We send it to the shop in time to arrive at this slot. You can cancel any time before then.</div>` : ''}</div>
      ${q?.coinsAvailable ? `<div class="card row coins"><span class="iconbtn" style="background:var(--mariTint);color:light-dark(#7a5300,#ffd36b)">${icon('coin', 22)}</span><span class="grow"><b>Use ZIPI coins</b><br><span class="small mute">${q.coinsAvailable} coins available${useCoins && q.coinsUsed ? ` · saving ${rs(q.coinsUsed)}` : ` · save up to ${rs(Math.min(q.coinsAvailable, Math.floor(q.subtotal * (S.config?.coinsMaxPct ?? 20) / 100)))}`}</span></span><button class="switch" id="usecoins" aria-pressed="${useCoins}" aria-label="Use ZIPI coins"></button></div>` : ''}
      <div class="card"><b>Pay with</b><div class="payopt" style="margin-top:8px">${[['UPI', 'UPI', 'GPay, PhonePe, Paytm'], ['COD', 'Cash', 'Pay the rider']].map(([k, t, d]) => `<button data-pay="${k}" aria-pressed="${pay === k}"><b>${t}</b><span class="small mute">${d}</span></button>`).join('')}</div></div>
      <div class="bill"><b>Bill details</b>${q ? `<div class="kv" style="margin-top:8px"><span>Item total</span><span class="num">${rs(q.subtotal)}</span></div>
        <div class="kv"><span>Delivery fee · ${q.dist} km</span><span class="num">${q.deliveryFee ? rs(q.deliveryFee) : '<b style="color:var(--goText)">FREE</b>'}</span></div>
        ${q.deliveryFee && S.config ? `<div class="small mute">Free delivery on orders above ${rs(S.config.freeDeliveryAbove)}</div>` : ''}
        ${q.smallOrderFee ? `<div class="kv"><span>Small order fee</span><span class="num">${rs(q.smallOrderFee)}</span></div>` : ''}<div class="kv"><span>Platform fee</span><span class="num">${rs(q.platformFee)}</span></div>
        ${q.surgeFee ? `<div class="kv"><span>${icon('bolt', 14)} Surge fee · ${esc(q.surgeReasons.join(', '))}</span><span class="num">${rs(q.surgeFee)}</span></div>` : ''}
        ${q.discount ? `<div class="kv" style="color:var(--goText)"><span>Coupon ${esc(q.couponApplied)}</span><span class="num">−${rs(q.discount)}</span></div>` : ''}${q.coinsUsed ? `<div class="kv" style="color:var(--goText)"><span>ZIPI coins</span><span class="num">−${rs(q.coinsUsed)}</span></div>` : ''}<div class="kv tot"><span>To pay</span><span class="num">${rs(q.total)}</span></div>
        ${q.coinsEarn ? `<div class="small" style="margin-top:6px;color:light-dark(#7a5300,#ffd36b)">${icon('coin', 14)} You'll earn ${q.coinsEarn} coins when this order is delivered</div>` : ''}` : '<div class="sk" style="height:120px;margin-top:8px"></div>'}</div>
      ${unavailable.length ? `<div class="err">${icon('alert', 14)} Remove or reduce sold-out items to continue.</div>` : ''}
      <button class="btn go big block" id="place" ${!q || !addr || zoneBad || unavailable.length || (!q.open && when === 'now') || (when === 'later' && !slot) ? 'disabled' : ''}>${when === 'later' ? `Schedule order${q ? ' · ' + rs(q.total) : ''}` : `Place order${q ? ' · ' + rs(q.total) : ''}`}</button>
      <p class="small mute" style="text-align:center;margin:0">${pay === 'UPI' ? 'UPI is simulated in this build. Connect Razorpay or Cashfree before launch.' : 'Keep exact change ready if you can.'}</p></div>`;
  }
  function slots() {
    const out = [], step = 30 * 60000, start = Math.ceil((Date.now() + 45 * 60000) / step) * step, end = Date.now() + (S.config?.scheduleDays || 2) * 86400000;
    const today = new Date().toDateString(), tmr = new Date(Date.now() + 86400000).toDateString();
    for (let t = start; t <= end && out.length < 160; t += step) { const d = new Date(t), h = d.getHours(); if (h < 7 || h >= 23) continue;
      const day = d.toDateString() === today ? 'Today' : d.toDateString() === tmr ? 'Tomorrow' : fmtDate(t); out.push([t, `${day}, ${fmtTime(t)}`]); }
    return out;
  }
  el.addEventListener('change', e => { if (e.target.id === 'slot') { slot = e.target.value; draw(); } });
  el.addEventListener('click', async e => {
    const w = e.target.closest('[data-when]'); if (w) { when = w.dataset.when; if (when === 'later' && !slot) slot = String(slots()[0]?.[0] || ''); draw(); return; }
    if (e.target.closest('#usecoins')) { useCoins = !useCoins; store.set('coins', useCoins); requote(); return; }
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
    if (inc || dec) { const l = getCart().lines[(inc || dec).dataset[inc ? 'inc' : 'dec']]; const max = quote?.lines.find(x => x.itemId === l.id)?.stockLeft;
      if (inc && max != null && l.qty + 1 > max) return toast(`Only ${max} left`, 'err'); setQty(getCart().vendor, { ...l, stock: l.max }, l.qty + (inc ? 1 : -1)); requote(); return; }
    const p = e.target.closest('[data-pay]'); if (p) { pay = p.dataset.pay; store.set('pay', pay); draw(); return; }
    if (e.target.closest('[data-rmc]')) { e.stopPropagation(); setCartMeta({ coupon: '' }); requote(); return; }
    if (e.target.closest('#cpn')) { const cs = (S.config?.coupons || []).filter(x => !x.vendorType || x.vendorType === getCart().vendor.type);
      const s = sheet(`<form id="cf" class="row"><input class="in" name="code" placeholder="Enter coupon code" style="text-transform:uppercase" aria-label="Coupon code"><button class="btn go">Apply</button></form><div class="stack" style="margin-top:14px">${cs.map(x => `<div class="cpn"><div class="grow"><code>${esc(x.code)}</code><b style="display:block;margin-top:6px">${esc(x.title)}</b><span class="small mute">${esc(x.desc)}</span></div><button class="btn sm go" data-code="${esc(x.code)}">Apply</button></div>`).join('')}</div>`, { title: 'Offers for you' });
      const apply = async code => { setCartMeta({ coupon: code.toUpperCase() }); await requote(); if (quote?.couponError) toast(quote.couponError, 'err'); else if (quote?.couponApplied) { toast(`${quote.couponApplied} applied. You save ${rs(quote.discount)}!`, 'ok'); confetti(); } s.close(); };
      s.el.querySelector('#cf').onsubmit = ev => { ev.preventDefault(); const v = ev.target.code.value.trim(); if (v) apply(v); };
      s.el.querySelectorAll('[data-code]').forEach(b => b.onclick = () => apply(b.dataset.code)); return; }
    if (e.target.closest('#chaddr')) {
      const all = addrs();
      if (!all.length) { const a = await addAddressSheet(vend?.zoneId); if (a) { addr = a; S.addressId = a.id; store.set('addr', a.id); updateCustomerBar(); requote(); } return; }
      const s = sheet(`<div class="stack">${all.map(a => `<button class="addr" data-a="${a.id}" aria-pressed="${a.id === addr?.id}">${icon(a.label === 'Work' ? 'store' : 'home', 22)}<span class="grow"><b>${esc(a.label)}</b><br><span class="small mute">${esc(a.line)}, ${esc(a.area)}</span></span>${vend && a.zoneId !== vend.zoneId ? '<span class="pill g">Out of range</span>' : ''}</button>`).join('')}<button class="btn block" data-new>${icon('plus', 18)} Add new address</button></div>`, { title: 'Choose address' });
      s.el.onclick = async ev => { const b = ev.target.closest('[data-a]'); if (b) { addr = all.find(a => a.id === b.dataset.a); S.addressId = addr.id; S.zoneId = addr.zoneId; store.set('addr', addr.id); store.set('zone', addr.zoneId); updateCustomerBar(); s.close(); requote(); }
        if (ev.target.closest('[data-new]')) { s.close(); const a = await addAddressSheet(vend?.zoneId); if (a) { addr = a; S.addressId = a.id; store.set('addr', a.id); updateCustomerBar(); requote(); } } }; return; }
    if (e.target.closest('#place')) {
      const b = e.target.closest('#place'); busy(b, true);
      try {
        const o = await api.post('/api/orders', { vendorId: c.vendorId, items: lines().map(l => ({ itemId: l.id, qty: l.qty })), coupon: getCart().coupon || undefined, addressId: addr.id, payment: pay, note: el.querySelector('#note')?.value || '',
          useCoins: useCoins && !!quote?.coinsUsed, scheduleAt: when === 'later' ? +slot : undefined, idempotencyKey: idemKey });
        clearCart(); successOverlay(o);
      } catch (x) { toast(x.message, 'err'); busy(b, false); requote(); }
    }
  });
  el.addEventListener('change', e => { if (e.target.id === 'note') setCartMeta({ note: e.target.value }); });
  draw(); requote();
}, { title: 'Checkout' });

/* ---------- multi-shop grocery checkout: one bill, ZIPI decides how many delivery partners ---------- */
const planHTML = (p, compact) => !p ? '' : `<div class="card plan"><div class="row" style="gap:10px"><span class="iconbtn" style="background:var(--goTint);color:var(--goText)">${icon('bike', 22)}</span>
  <div class="grow"><b>${p.riders === 1 ? '1 delivery partner' : `${p.riders} delivery partners`} · about ${p.etaMins} min</b><div class="small mute">${esc(p.why || '')}</div></div></div>
  ${compact ? '' : `<ol class="legs">${p.legs.map((l, i) => `<li><span class="legn">${p.riders > 1 ? i + 1 : icon('bike', 14)}</span><span class="grow"><b>${l.shops.map(esc).join(' → ')}</b> → you<br><span class="small mute">${l.km} km · ${l.kg} kg · ready in about ${l.mins} min</span></span></li>`).join('')}</ol>
  ${p.riders > 1 && p.oneRiderMins ? `<div class="small mute">One partner visiting every shop would take about ${p.oneRiderMins} min.</div>` : ''}`}</div>`;

async function basketCheckout(el, loggedIn) {
  let pay = store.get('pay', 'UPI'), quote = null, addr = null, useCoins = store.get('coins', true), idemKey = newKey();
  const zone = getCart().vendor?.zoneId || S.zoneId, addrs = () => (S.me?.user?.addresses || []);
  const all = addrs(), def = S.me?.user?.defaultAddress;
  addr = all.find(a => a.id === S.addressId && a.zoneId === zone) || all.find(a => a.id === def && a.zoneId === zone) || all.find(a => a.zoneId === zone) || all[0] || null;
  el.innerHTML = `<div class="row" style="margin:6px 0 14px"><button class="iconbtn" data-back aria-label="Back">${icon('chevL', 22)}</button><div><h1 style="font-size:28px">Checkout</h1><span class="small mute">${cartShops().length} shops · one order · one delivery fee</span></div></div><div class="cgrid"><div id="left"></div><div class="side" id="right"></div></div>`;
  el.querySelector('[data-back]').onclick = () => back('/g/all');
  const L = el.querySelector('#left'), R = el.querySelector('#right');
  const lines = () => Object.values(getCart().lines);
  const body = () => ({ items: lines().map(l => ({ itemId: l.id, qty: l.qty })), coupon: getCart().coupon || undefined, addressId: addr?.id, useCoins });
  async function requote() {
    if (!loggedIn) return draw();
    try { quote = await api.post('/api/baskets/quote', body()); } catch (e) { toast(e.message, 'err'); quote = null; }
    draw();
  }
  function draw() {
    if (!alive(el)) return;
    const cc = getCart(); if (!cartCount()) { nav('/cart', { replace: true }); return; }
    if (cartShops().length < 2) { nav('/cart', { replace: true }); return; } // back to the normal one-shop checkout
    const q = quote;
    L.innerHTML = `${planHTML(q?.plan)}${cartShops().map(v => { const qs = q?.shops.find(x => x.vendor.id === v.id), mine = lines().filter(l => l.vendorId === v.id);
      return `<div class="card"><div class="row" style="margin-bottom:6px"><div class="thumb">${pic(v)}</div><div class="grow"><b>${esc(v.name)}</b><div class="small mute">${qs ? `${rs(qs.subtotal)} · about ${qs.kg} kg` : ''}${qs && !qs.vendor.open ? ' · <span style="color:var(--red)">Closed now</span>' : ''}</div></div></div>
      ${mine.map(l => { const bad = qs?.lines.find(u => u.itemId === l.id && !u.available); return `<div class="li"><span class="grow">${esc(l.name)}${l.unit ? ` <span class="small mute">${esc(l.unit)}</span>` : ''}${bad ? `<br><span class="low">${bad.stockLeft ? `Only ${bad.stockLeft} left` : 'Sold out'}</span>` : ''}</span><div class="stp" style="min-width:90px;animation:none"><button data-dec="${l.id}" aria-label="Remove one">−</button><span>${l.qty}</span><button data-inc="${l.id}" aria-label="Add one">+</button></div><b class="num" style="width:64px;text-align:right">${rs(l.qty * l.price)}</b></div>`; }).join('')}
      <input class="in" data-note="${v.id}" placeholder="Note for ${esc(v.name)} (optional)" maxlength="200" value="${esc(cc.notes?.[v.id] || '')}" style="margin-top:8px;min-height:40px"></div>`; }).join('')}
      <button class="btn ghost sm" data-go="/g/all">${icon('plus', 16)} Add more items</button>`;
    if (!loggedIn) { R.innerHTML = `<div class="bill"><div class="kv"><span>Item total</span><span class="num">${rs(cartTotal())}</span></div><p class="small mute">Delivery fee and the delivery plan are worked out after you log in.</p><button class="btn go big block" id="lg">Log in to place order</button></div>`;
      R.querySelector('#lg').onclick = () => { S.after = '/cart'; nav('/login'); }; return; }
    const unavailable = q ? q.shops.flatMap(s => s.lines.filter(l => !l.available)) : [], closed = q ? q.shops.filter(s => !s.vendor.open) : [];
    R.innerHTML = `<div class="stack">
      <button class="coupon" id="cpn">${icon('gift', 22)}<span class="grow"><b>${q?.couponApplied ? `${esc(q.couponApplied)} applied` : 'Apply a coupon'}</b><br><span class="small">${q?.couponApplied ? `You save ${rs(q.discount)}` : q?.couponError ? esc(q.couponError) : 'One coupon for the whole order'}</span></span>${q?.couponApplied ? `<span class="btn sm ghost" data-rmc>Remove</span>` : icon('chevR', 18)}</button>
      <div class="card"><div class="row between"><b>Deliver to</b><button class="btn ghost sm" id="chaddr">${addr ? 'Change' : 'Add address'}</button></div>${addr ? `<div class="row" style="margin-top:6px;align-items:flex-start">${icon(addr.label === 'Work' ? 'store' : 'home', 20)}<span><b>${esc(addr.label)}</b><br><span class="small mute">${esc(addr.line)}, ${esc(addr.area)}</span></span></div>` : '<p class="small mute" style="margin:6px 0 0">Add where we should deliver.</p>'}</div>
      ${q?.coinsAvailable ? `<div class="card row coins"><span class="iconbtn" style="background:var(--mariTint);color:light-dark(#7a5300,#ffd36b)">${icon('coin', 22)}</span><span class="grow"><b>Use ZIPI coins</b><br><span class="small mute">${q.coinsAvailable} coins available${useCoins && q.coinsUsed ? ` · saving ${rs(q.coinsUsed)}` : ''}</span></span><button class="switch" id="usecoins" aria-pressed="${useCoins}" aria-label="Use ZIPI coins"></button></div>` : ''}
      <div class="card"><b>Pay with</b><div class="payopt" style="margin-top:8px">${[['UPI', 'UPI', 'GPay, PhonePe, Paytm'], ['COD', 'Cash', 'Pay the rider']].map(([k, t, d]) => `<button data-pay="${k}" aria-pressed="${pay === k}"><b>${t}</b><span class="small mute">${d}</span></button>`).join('')}</div>
        ${pay === 'COD' && q?.plan.riders > 1 ? `<div class="hint">Each delivery partner collects cash for the part they bring.</div>` : ''}</div>
      <div class="bill"><b>Bill details</b>${q ? `${q.shops.map(s => `<div class="kv" style="margin-top:6px"><span>${esc(s.vendor.name)}</span><span class="num">${rs(s.subtotal)}</span></div>`).join('')}
        <div class="kv" style="margin-top:6px;border-top:1px dashed var(--line);padding-top:6px"><span>Item total</span><span class="num">${rs(q.subtotal)}</span></div>
        <div class="kv"><span>Delivery fee · ${q.shops.length} shops</span><span class="num">${q.deliveryFee ? rs(q.deliveryFee) : '<b style="color:var(--goText)">FREE</b>'}</span></div>
        ${q.smallOrderFee ? `<div class="kv"><span>Small order fee</span><span class="num">${rs(q.smallOrderFee)}</span></div>` : ''}<div class="kv"><span>Platform fee</span><span class="num">${rs(q.platformFee)}</span></div>
        ${q.surgeFee ? `<div class="kv"><span>${icon('bolt', 14)} Surge fee</span><span class="num">${rs(q.surgeFee)}</span></div>` : ''}
        ${q.discount ? `<div class="kv" style="color:var(--goText)"><span>Coupon ${esc(q.couponApplied)}</span><span class="num">−${rs(q.discount)}</span></div>` : ''}${q.coinsUsed ? `<div class="kv" style="color:var(--goText)"><span>ZIPI coins</span><span class="num">−${rs(q.coinsUsed)}</span></div>` : ''}
        <div class="kv tot"><span>To pay</span><span class="num">${rs(q.total)}</span></div>` : '<div class="sk" style="height:120px;margin-top:8px"></div>'}</div>
      ${closed.length ? `<div class="err">${icon('alert', 14)} ${closed.map(s => esc(s.vendor.name)).join(', ')} ${closed.length > 1 ? 'are' : 'is'} closed right now. Remove ${closed.length > 1 ? 'their' : 'its'} items to order from the others.</div>` : ''}
      ${unavailable.length ? `<div class="err">${icon('alert', 14)} Remove or reduce sold-out items to continue.</div>` : ''}
      <button class="btn go big block" id="place" ${!q || !addr || unavailable.length || closed.length ? 'disabled' : ''}>Place order${q ? ' · ' + rs(q.total) : ''}</button></div>`;
  }
  el.addEventListener('input', e => { const n = e.target.closest('[data-note]'); if (n) setCartMeta({ notes: { ...getCart().notes, [n.dataset.note]: n.value } }); });
  el.addEventListener('click', async e => {
    if (e.target.closest('#usecoins')) { useCoins = !useCoins; store.set('coins', useCoins); requote(); return; }
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
    if (inc || dec) { const cc = getCart(), l = cc.lines[(inc || dec).dataset[inc ? 'inc' : 'dec']]; const max = quote?.shops.flatMap(s => s.lines).find(x => x.itemId === l.id)?.stockLeft;
      if (inc && max != null && l.qty + 1 > max) return toast(`Only ${max} left`, 'err'); setQty(cc.shops[l.vendorId], { ...l, stock: l.max }, l.qty + (inc ? 1 : -1)); requote(); return; }
    const p = e.target.closest('[data-pay]'); if (p) { pay = p.dataset.pay; store.set('pay', pay); draw(); return; }
    if (e.target.closest('[data-rmc]')) { e.stopPropagation(); setCartMeta({ coupon: '' }); requote(); return; }
    if (e.target.closest('#cpn')) { const cs = (S.config?.coupons || []).filter(x => x.vendorType !== 'restaurant');
      const s = sheet(`<form id="cf" class="row"><input class="in" name="code" placeholder="Enter coupon code" style="text-transform:uppercase" aria-label="Coupon code"><button class="btn go">Apply</button></form><div class="stack" style="margin-top:14px">${cs.map(x => `<div class="cpn"><div class="grow"><code>${esc(x.code)}</code><b style="display:block;margin-top:6px">${esc(x.title)}</b><span class="small mute">${esc(x.desc)}</span></div><button class="btn sm go" data-code="${esc(x.code)}">Apply</button></div>`).join('')}</div>`, { title: 'Offers for you' });
      const apply = async code => { setCartMeta({ coupon: code.toUpperCase() }); await requote(); if (quote?.couponError) toast(quote.couponError, 'err'); else if (quote?.couponApplied) { toast(`${quote.couponApplied} applied. You save ${rs(quote.discount)}!`, 'ok'); confetti(); } s.close(); };
      s.el.querySelector('#cf').onsubmit = ev => { ev.preventDefault(); const v = ev.target.code.value.trim(); if (v) apply(v); };
      s.el.querySelectorAll('[data-code]').forEach(b => b.onclick = () => apply(b.dataset.code)); return; }
    if (e.target.closest('#chaddr')) {
      const list = addrs(), useA = a => { addr = a; S.addressId = a.id; S.zoneId = a.zoneId; store.set('addr', a.id); store.set('zone', a.zoneId); updateCustomerBar(); requote(); };
      if (!list.length) { const a = await addAddressSheet(zone); if (a) useA(a); return; }
      const s = sheet(`<div class="stack">${list.map(a => `<button class="addr" data-a="${a.id}" aria-pressed="${a.id === addr?.id}">${icon(a.label === 'Work' ? 'store' : 'home', 22)}<span class="grow"><b>${esc(a.label)}</b><br><span class="small mute">${esc(a.line)}, ${esc(a.area)}</span></span>${a.zoneId !== zone ? '<span class="pill g">Out of range</span>' : ''}</button>`).join('')}<button class="btn block" data-new>${icon('plus', 18)} Add new address</button></div>`, { title: 'Choose address' });
      s.el.onclick = async ev => { const b = ev.target.closest('[data-a]'); if (b) { s.close(); useA(list.find(a => a.id === b.dataset.a)); }
        if (ev.target.closest('[data-new]')) { s.close(); const a = await addAddressSheet(zone); if (a) useA(a); } }; return; }
    if (e.target.closest('#place')) {
      const b = e.target.closest('#place'); busy(b, true);
      try {
        const bk = await api.post('/api/baskets', { ...body(), useCoins: useCoins && !!quote?.coinsUsed, payment: pay, notes: getCart().notes, idempotencyKey: idemKey });
        clearCart(); basketSuccess(bk);
      } catch (x) { toast(x.message, 'err'); busy(b, false); requote(); }
    }
  });
  draw(); requote();
}
function basketSuccess(bk) {
  const d = document.createElement('div'); d.className = 'success';
  d.innerHTML = `<div><svg width="120" height="120" viewBox="0 0 70 70" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><circle cx="35" cy="35" r="30"/><path d="M22 36l9 9 17-19"/></svg><h1>Order placed!</h1><p style="opacity:.9">${bk.orders.length} shops are packing your items. ${bk.plan.riders === 1 ? 'One delivery partner will bring everything.' : `${bk.plan.riders} delivery partners will bring it.`}</p></div>`;
  document.body.appendChild(d); setTimeout(confetti, 450);
  setTimeout(() => { d.style.transition = 'opacity .3s'; d.style.opacity = 0; setTimeout(() => d.remove(), 300); nav('/basket/' + bk.id, { replace: true }); }, 1900);
}

/* ---------- multi-shop order tracking ---------- */
const BK_STEPS = [['placed', 'Shops confirming'], ['accepted', 'Packing'], ['picked', 'On the way'], ['delivered', 'Delivered']];
route('/basket/:id', async (el, { id }) => {
  el.innerHTML = skel(3, 120);
  const load = async () => {
    let bk; try { bk = await api.get('/api/baskets/' + id); } catch (e) { el.innerHTML = empty('Order not found', e.message, 'alert'); return; }
    if (!alive(el)) return;
    const si = Math.max(0, BK_STEPS.findIndex(s => s[0] === bk.status)), done = bk.status === 'delivered', gone = bk.status === 'cancelled';
    const legs = new Map(); for (const o of bk.orders) { const k = o.legId || o.id; if (!legs.has(k)) legs.set(k, []); legs.get(k).push(o); }
    const canCancel = bk.orders.some(o => ['placed', 'scheduled'].includes(o.status));
    el.innerHTML = `<div class="row" style="margin:6px 0 14px"><button class="iconbtn" data-back aria-label="Back">${icon('chevL', 22)}</button><div class="grow"><h1 style="font-size:26px">${gone ? 'Order cancelled' : done ? 'Delivered. Enjoy!' : BK_STEPS[si][1]}</h1><span class="small mute">${esc(bk.code)} · ${bk.orders.length} shops · ${fmtDT(bk.createdAt)}</span></div></div>
      ${!gone && !done ? `<div class="otp" style="margin-bottom:12px"><span><span style="font-weight:700">Delivery code</span><br><span class="small mute">Share with ${bk.plan.riders > 1 ? 'each delivery partner' : 'the delivery partner'} at your door</span></span><b class="num">${esc(bk.otp || '')}</b></div>` : ''}
      ${!gone ? `<div class="bksteps">${BK_STEPS.map((s, i) => `<span class="${i < si || done ? 'ok' : i === si ? 'on' : ''}">${s[1]}</span>`).join('')}</div>` : ''}
      ${planHTML(bk.plan, true)}
      <div class="stack">${[...legs.values()].map((os, li) => { const rider = os.find(o => o.rider)?.rider;
        return `<div class="card"><div class="row between"><b>${legs.size > 1 ? `Delivery ${li + 1}` : 'Your delivery'}</b><span class="small mute">${rider ? `${icon('bike', 14)} ${esc(rider.name)}` : 'Assigning a delivery partner'}</span></div>
          ${os.map(o => `<button class="li bkpart" data-go="/order/${o.id}"><div class="thumb" style="width:40px;height:40px">${pic(o.vendor)}</div><span class="grow"><b>${esc(o.vendor.name)}</b><br><span class="small mute">${o.items.map(l => `${esc(l.name)} × ${l.qty}`).join(', ')}</span></span>${statusPill(o.status)}</button>`).join('')}</div>`; }).join('')}</div>
      <div class="bill" style="margin-top:12px"><div class="kv"><span>Item total</span><span class="num">${rs(bk.subtotal)}</span></div><div class="kv"><span>Delivery fee</span><span class="num">${bk.deliveryFee ? rs(bk.deliveryFee) : 'FREE'}</span></div>${bk.discount ? `<div class="kv"><span>Discount</span><span class="num">−${rs(bk.discount)}</span></div>` : ''}<div class="kv tot"><span>${bk.payment === 'COD' ? 'Pay on delivery' : 'Paid'}</span><span class="num">${rs(bk.total)}</span></div></div>
      ${canCancel ? '<button class="btn block" id="bkc" style="margin-top:12px">Cancel order</button>' : ''}`;
    el.querySelector('[data-back]').onclick = () => back('/orders');
    el.querySelector('#bkc')?.addEventListener('click', async e => {
      if (!(await confirmBox('Cancel this order? Parts that a shop has already started packing will still come.', { ok: 'Cancel order', title: 'Cancel order?' }))) return;
      busy(e.currentTarget, true); try { const r = await api.post(`/api/baskets/${id}/cancel`); toast(r.message, 'ok'); load(); } catch (x) { toast(x.message, 'err'); busy(e.currentTarget, false); } });
  };
  live(() => load()); await load();
}, { title: 'Order', auth: true });

function successOverlay(o) {
  const d = document.createElement('div'); d.className = 'success';
  d.innerHTML = `<div><svg width="120" height="120" viewBox="0 0 70 70" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><circle cx="35" cy="35" r="30"/><path d="M22 36l9 9 17-19"/></svg><h1>${o.scheduleAt ? 'Order scheduled!' : 'Order placed!'}</h1><p style="opacity:.9">${o.scheduleAt ? `Arriving ${esc(fmtDT(o.scheduleAt))}. We'll send it to ${esc(o.vendor.name)} in time.` : `${esc(o.vendor.name)} will confirm in a moment.`}</p></div>`;
  document.body.appendChild(d); setTimeout(confetti, 450);
  setTimeout(() => { d.style.transition = 'opacity .3s'; d.style.opacity = 0; setTimeout(() => d.remove(), 300); nav('/order/' + o.id, { replace: true }); }, 1900);
}

/* ---------- live tracking ---------- */
const TITLES = { scheduled: o => `Scheduled for ${fmtDT(o.scheduleAt)}`, placed: o => `Waiting for ${o.vendor.name} to accept`, accepted: o => o.vendorType === 'store' ? `${o.vendor.name} is packing your items` : `${o.vendor.name} is preparing your food`,
  ready: o => o.rider ? `${o.rider.name.split(' ')[0]} is picking up your order` : 'Packed, assigning a delivery partner', picked: o => `${o.rider.name.split(' ')[0]} is on the way`, delivered: () => 'Delivered. Enjoy!',
  cancelled: o => 'Order cancelled', rejected: o => `${o.vendor.name} couldn't take this order` };
function mapSVG(o, t) {
  const W = 340, H = 190, sc = 52, cx = W / 2, cy = H / 2;
  const P = p => ({ x: Math.max(24, Math.min(W - 24, cx + (p?.x || 0) * sc)), y: Math.max(24, Math.min(H - 24, cy + (p?.y || 0) * sc)) });
  const a = P(o.vendor.loc), b = P(o.address.loc || { x: .5, y: .3 });
  if (Math.hypot(a.x - b.x, a.y - b.y) < 60) { b.x = Math.min(W - 24, a.x + 90); b.y = Math.min(H - 24, a.y + 40); }
  const m = { x: (a.x + b.x) / 2 + (b.y - a.y) * .3, y: (a.y + b.y) / 2 - (b.x - a.x) * .3 };
  const q = k => ({ x: (1 - k) ** 2 * a.x + 2 * (1 - k) * k * m.x + k * k * b.x, y: (1 - k) ** 2 * a.y + 2 * (1 - k) * k * m.y + k * k * b.y });
  const r = q(t);
  const roads = Array.from({ length: 6 }, (_, i) => `<path d="M0 ${20 + i * 32}H${W}" stroke="var(--card)" stroke-width="${i % 2 ? 4 : 8}"/><path d="M${30 + i * 60} 0V${H}" stroke="var(--card)" stroke-width="${i % 2 ? 4 : 8}"/>`).join('');
  return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Delivery route map"><rect width="${W}" height="${H}" fill="var(--sunk)"/>${roads}
    <path d="M${a.x} ${a.y}Q${m.x} ${m.y} ${b.x} ${b.y}" stroke="var(--go)" stroke-width="4" fill="none" stroke-dasharray="2 9" stroke-linecap="round"/>
    <g transform="translate(${a.x} ${a.y})"><circle r="16" fill="${o.vendor.color || '#0b7a43'}" stroke="#fff" stroke-width="3"/><path d="M-6-3l1.5-5h9L6-3M-6-3v8h12v-8M-6-3h12" stroke="#fff" stroke-width="2" fill="none"/></g>
    <g transform="translate(${b.x} ${b.y})"><circle r="16" fill="#14201a" stroke="#fff" stroke-width="3"/><path d="M-7 1L0-6 7 1V7H-7z" fill="#fff"/></g>
    ${o.rider && !['cancelled', 'rejected'].includes(o.status) ? `<g id="rdot" transform="translate(${r.x} ${r.y})"><circle r="18" fill="#ffc23d" opacity=".35"><animate attributeName="r" values="14;22;14" dur="1.6s" repeatCount="indefinite"/></circle><circle r="12" fill="#ffc23d" stroke="#14201a" stroke-width="2"/><circle cx="-4" cy="3" r="2.5" fill="#14201a"/><circle cx="4" cy="3" r="2.5" fill="#14201a"/><path d="M-4 3l3-6h3" stroke="#14201a" stroke-width="2" fill="none"/></g>` : ''}</svg>`;
}
route('/order/:id', async (el, { id }) => {
  let o = await api.get('/api/orders/' + id), raf = null, rating = { food: 0, rider: 0, nps: null };
  const isCustomer = o.customerId === user()?.id;
  /* real map: one Leaflet instance that survives redraws (the host node is moved into each new render) */
  const mapHost = document.createElement('div'); mapHost.className = 'lmap'; mapHost.setAttribute('role', 'img'); mapHost.setAttribute('aria-label', 'Live delivery map');
  let M = null, mk = {}, line = null, mapFailed = false, mapLoading = false;
  const livePos = () => { const p = o.rider?.pos; return p && Date.now() - p.at < 120000 ? p : null; };
  function riderLL(pts) { return livePos() || (o.status === 'picked' ? along(pts, progressOf(o)) : along(pts, 0)); }
  function updateMap() {
    if (!M || !o.vendor?.ll || !o.address?.ll) return; const { L, m } = M, a = o.vendor.ll, b = o.address.ll, pts = roadPts || curve(a, b);
    if (!line) { line = L.polyline(pts, { color: '#0b7a43', weight: 4, dashArray: '2 9', lineCap: 'round' }).addTo(m);
      mk.v = L.marker([a.lat, a.lng], { icon: pin(L, 'shop', { color: o.vendor.color }), title: o.vendor.name }).addTo(m).bindTooltip(o.vendor.name);
      mk.h = L.marker([b.lat, b.lng], { icon: pin(L, 'home'), title: 'Delivery address' }).addTo(m).bindTooltip('You');
      m.fitBounds([[a.lat, a.lng], [b.lat, b.lng]], { padding: [40, 40] }); }
    if (o.rider && ['accepted', 'ready', 'picked'].includes(o.status)) {
      const p = riderLL(pts);
      if (!mk.r) mk.r = L.marker([p.lat, p.lng], { icon: pin(L, 'rider', { pulse: true }), zIndexOffset: 500, title: o.rider.name }).addTo(m).bindTooltip(o.rider.name.split(' ')[0]); else glide(mk.r, p);
    } else if (mk.r) { mk.r.remove(); mk.r = null; }
    const badge = el.querySelector('#gpsb'); if (badge) badge.hidden = !livePos();
  }
  let roadPts = null;
  async function ensureMap() {
    if (M || mapFailed || mapLoading || !o.vendor?.ll) return; mapLoading = true;
    try { M = await makeMap(mapHost, { center: o.vendor.ll, zoom: 14 }); updateMap();
      api.get(`/api/orders/${id}/route`).then(rt => { if (rt.coords?.length > 1 && M) { roadPts = rt.coords; if (line) { line.setLatLngs(roadPts); line.setStyle({ dashArray: null, opacity: .75 }); } updateMap(); } }).catch(() => {}); }
    catch { mapFailed = true; draw(); } finally { mapLoading = false; }
  }
  const offPos = api.on(ev => { if (!alive(el)) return offPos(); if (ev.type === 'rider_pos' && ev.orders?.includes(id) && o.rider) { o.rider.pos = ev.pos; updateMap(); } });
  const progressOf = o => {
    if (o.status === 'picked') { const st = o.pickedAt || Date.now(), dur = (o.dist * 4 + 3) * 60000; return Math.min(.95, (Date.now() - st) / dur); }
    return o.status === 'delivered' ? 1 : 0;
  };
  function draw() {
    if (!alive(el)) return;
    const liveO = !['delivered', 'cancelled', 'rejected'].includes(o.status), step = { scheduled: 0, placed: 0, accepted: 1, ready: 2, picked: 3, delivered: 4 }[o.status] ?? 0;
    const due = o.scheduleAt || (o.createdAt + o.eta * 60000), left = Math.max(1, Math.round((due - Date.now()) / 60000));
    const T = s => o.timeline.find(x => x.status === s)?.at;
    const steps = [['placed', 'Order placed', `${o.vendor.name} received your order`], ['accepted', o.vendorType === 'store' ? 'Packing' : 'Preparing', 'Accepted by the shop'], ['ready', 'Ready for pickup', o.rider ? `${o.rider.name} assigned` : 'Finding a delivery partner'], ['picked', 'On the way', o.rider ? `${o.rider.name} has your order` : ''], ['delivered', 'Delivered', '']];
    el.innerHTML = `<div class="row" style="margin:6px 0 14px"><button class="iconbtn" data-go="/orders" aria-label="Back to orders">${icon('chevL', 22)}</button><div class="grow"><h1 style="font-size:24px">Order ${esc(o.code)}</h1><span class="small mute">${fmtDT(o.createdAt)} · ${esc(o.vendor.name)}</span></div>${statusPill(o.status)}</div>
    ${o.groupId && o.groupSize > 1 && isCustomer ? `<button class="saved" style="width:100%;text-align:left;margin-bottom:12px;animation:none" data-go="/basket/${o.groupId}">${icon('bag', 16)} Part of ${esc(o.groupCode)}, your order from ${o.groupSize} shops. See the whole order ${icon('chevR', 14)}</button>` : ''}
    <div class="track"><div class="stack">
      <div class="tstat"><div class="row between" style="align-items:flex-start"><div><h2>${esc(TITLES[o.status]?.(o) || o.status)}</h2><p style="margin:6px 0 0;opacity:.85">${o.status === 'scheduled' ? `Goes to ${esc(o.vendor.name)} at ${fmtTime(o.releaseAt)}. Cancel free until then.` : liveO ? `Arriving by ${fmtTime(due)}` : o.status === 'delivered' ? `Delivered at ${fmtTime(T('delivered'))}` : esc(o.cancelReason || '')}</p></div>${liveO && o.status !== 'scheduled' ? `<div style="text-align:right"><div class="eta">${left}</div><span style="opacity:.85">min</span></div>` : ''}</div>
        ${liveO ? `<div class="bar"><i style="width:${Math.max(8, step * 25)}%"></i></div>` : ''}${o.refund ? `<p style="margin:10px 0 0">${rs(o.refund)} refund started to your UPI.</p>` : ''}</div>
      ${liveO || o.status === 'delivered' ? (mapFailed ? mapSVG(o, progressOf(o)) : `<div class="mapwrap"><div id="mapslot"></div><span class="pill gps" id="gpsb" hidden><span class="live"></span> Live GPS</span></div>`) : ''}
      ${o.coinsEarn && o.status === 'delivered' ? `<div class="saved" style="background:var(--mariTint);color:inherit">${icon('coin', 18)} You earned ${o.coinsEarn} ZIPI coins on this order</div>` : ''}
      ${isCustomer && liveO && o.otp ? `<div class="otp"><span><b class="num">${esc(o.otp)}</b><br><span class="small">Share this code with the rider at your door</span></span>${icon('shield', 34)}</div>` : ''}
      ${o.rider && liveO ? `<div class="card row"><div class="avatar">${esc(initials(o.rider.name))}</div><div class="grow"><b>${esc(o.rider.name)}</b><div class="small mute">${esc({ bike: 'Bike', scooter: 'Scooter', ev: 'EV scooter', cycle: 'Bicycle' }[o.rider.vehicle] || '')} · ${o.rider.rating || 5} ★</div></div><a class="btn sm" href="tel:+91${esc(o.rider.phone)}">${icon('phone', 16)} ${esc(o.rider.phone)}</a></div>` : ''}
      ${o.status === 'delivered' && isCustomer && !o.rating ? rateCard(o) : ''}${o.rating ? `<div class="card"><b>You rated this order ${o.rating} ★</b>${o.review ? `<p class="mute" style="margin:4px 0 0">${esc(o.review)}</p>` : ''}</div>` : ''}
    </div><div class="stack">
      <div class="card"><ul class="tl">${steps.map(([s, t, d], i) => { const at = T(s); const done = at && (i < step || o.status === 'delivered'); const now = liveO && i === step;
        if (['cancelled', 'rejected'].includes(o.status) && !at) return ''; return `<li class="${done ? 'done' : now ? 'now' : ''}"><i>${done ? icon('check', 14) : ''}</i><span><b>${t}</b><small>${at ? fmtTime(at) : ''}${d && (done || now) ? ' · ' + esc(d) : ''}</small></span></li>`; }).join('')}
        ${['cancelled', 'rejected'].includes(o.status) ? `<li class="done"><i style="background:var(--red);border-color:var(--red)">${icon('x', 14)}</i><span><b>${o.status === 'cancelled' ? 'Cancelled' : 'Rejected by shop'}</b><small>${esc(o.cancelReason || '')}</small></span></li>` : ''}</ul></div>
      <div class="bill"><b>${esc(o.vendor.name)}</b>${o.items.map(l => `<div class="kv"><span>${vegMark(l.veg)} ${esc(l.name)} × ${l.qty}</span><span class="num">${rs(l.price * l.qty)}</span></div>`).join('')}
        <div class="kv" style="border-top:1px solid var(--line);margin-top:6px;padding-top:8px"><span>Item total</span><span class="num">${rs(o.subtotal)}</span></div><div class="kv"><span>Delivery</span><span class="num">${o.deliveryFee ? rs(o.deliveryFee) : 'FREE'}</span></div>${o.smallOrderFee ? `<div class="kv"><span>Small order fee</span><span class="num">${rs(o.smallOrderFee)}</span></div>` : ''}<div class="kv"><span>Platform fee</span><span class="num">${rs(o.platformFee || 0)}</span></div>${o.surgeFee ? `<div class="kv"><span>Surge fee</span><span class="num">${rs(o.surgeFee)}</span></div>` : ''}${o.discount ? `<div class="kv" style="color:var(--goText)"><span>${esc(o.coupon)}</span><span class="num">−${rs(o.discount)}</span></div>` : ''}${o.coinsUsed ? `<div class="kv" style="color:var(--goText)"><span>ZIPI coins</span><span class="num">−${rs(o.coinsUsed)}</span></div>` : ''}
        <div class="kv tot"><span>${o.payment === 'UPI' ? 'Paid by UPI' : 'Cash on delivery'}</span><span class="num">${rs(o.total)}</span></div>
        <p class="small mute" style="margin:10px 0 0">${icon('pin', 14)} ${esc(o.address.label)}: ${esc(o.address.line || '')} ${esc(o.address.area)}</p>${o.note ? `<p class="small mute" style="margin:4px 0 0">Note: ${esc(o.note)}</p>` : ''}</div>
      ${isCustomer && ['placed', 'scheduled'].includes(o.status) ? `<button class="btn danger block" id="cancel">Cancel ${o.status === 'scheduled' ? 'scheduled ' : ''}order</button>` : ''}
      ${isCustomer && o.status === 'delivered' ? `<button class="btn block" id="reorder">${icon('refresh', 18)} Order again</button>` : ''}
      ${isCustomer ? `<button class="btn block" id="gethelp">${icon('info', 18)} Get help with this order</button>` : ''}<p class="small mute" style="text-align:center">Urgent? Call ZIPI support at ${esc(S.config?.supportPhone || '+91 90000 00000')}</p></div></div>`;
    const slotEl = el.querySelector('#mapslot');
    if (slotEl) { slotEl.replaceWith(mapHost); if (M) { M.m.invalidateSize(); updateMap(); } else ensureMap(); }
    animateRider();
  }
  function rateCard() {
    return `<form class="card" id="rate"><h3>How was your order?</h3><p class="small mute" style="margin:2px 0 8px">Your rating helps ${esc(o.vendor.name)} and helps us improve.</p>
      <b class="small">${o.vendorType === 'store' ? 'Shop' : 'Food'}</b><div class="stars" data-k="food">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n} stars" class="${rating.food >= n ? 'on' : ''}">${icon('star', 34)}</button>`).join('')}</div>
      ${o.rider ? `<b class="small">Delivery by ${esc(o.rider.name.split(' ')[0])}</b><div class="stars" data-k="rider">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n} stars" class="${rating.rider >= n ? 'on' : ''}">${icon('star', 28)}</button>`).join('')}</div>` : ''}
      <label class="f"><span>Anything to tell the ${o.vendorType === 'store' ? 'shop' : 'kitchen'}?</span><textarea class="in" name="review" maxlength="300" placeholder="Optional"></textarea></label>
      <div class="f"><span>How likely are you to recommend ZIPI to a friend?</span><div class="nps">${Array.from({ length: 11 }, (_, n) => `<button type="button" data-nps="${n}" aria-pressed="${rating.nps === n}">${n}</button>`).join('')}</div><div class="row between small mute" style="margin-top:4px"><span>Not likely</span><span>Very likely</span></div></div>
      <label class="f"><span>What else should ZIPI deliver in your area?</span><input class="in" name="wish" maxlength="200" placeholder="e.g. momos, late-night medicines"></label>
      <button class="btn go block" style="margin-top:14px">Submit rating</button></form>`;
  }
  function animateRider() {
    clearTimeout(raf); if (o.status !== 'picked' || reduced()) return;
    const loop = () => { if (!alive(el)) return; if (M) { if (!livePos()) updateMap(); raf = setTimeout(loop, 1500); return; } const svg = el.querySelector('.map'); if (svg) { const tmp = document.createElement('div'); tmp.innerHTML = mapSVG(o, progressOf(o)); const nd = tmp.querySelector('#rdot'), od = svg.querySelector('#rdot'); if (nd && od) od.setAttribute('transform', nd.getAttribute('transform')); } raf = setTimeout(() => requestAnimationFrame(loop), 1000); };
    loop();
  }
  el.addEventListener('click', async e => {
    const st = e.target.closest('.stars [data-n]'); if (st) { const k = st.closest('.stars').dataset.k; rating[k] = +st.dataset.n; st.closest('.stars').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.n <= rating[k])); return; }
    const np = e.target.closest('[data-nps]'); if (np) { rating.nps = +np.dataset.nps; el.querySelectorAll('[data-nps]').forEach(b => b.setAttribute('aria-pressed', b === np)); return; }
    if (e.target.closest('#gethelp')) { const { newTicketSheet } = await import('./support.js'); const t = await newTicketSheet({ order: o }); if (t) nav('/help/' + t.id); return; }
    if (e.target.closest('#cancel')) { if (await confirmBox(`Cancel this order? ${o.payment === 'UPI' ? 'Your UPI payment will be refunded in full.' : 'You will not be charged.'}${o.coinsUsed ? ' Your coins come back too.' : ''}`, { ok: 'Cancel order', danger: true })) { try { o = await api.post(`/api/orders/${id}/cancel`); toast('Order cancelled'); draw(); } catch (x) { toast(x.message, 'err'); } } }
    if (e.target.closest('#reorder')) {
      try { const { vendor, items } = await api.get('/api/vendors/' + o.vendorId); let added = 0; clearCart();
        for (const l of o.items) { const it = items.find(i => i.id === l.itemId); if (it?.available) { setQty(vendor, it, Math.min(l.qty, it.stock ?? l.qty)); added++; } }
        if (!added) return toast('These items are not available right now', 'err'); toast(added < o.items.length ? 'Some items are unavailable and were skipped' : 'Added to your cart', 'ok'); nav('/cart');
      } catch (x) { toast(x.message, 'err'); }
    }
  });
  el.addEventListener('submit', async e => {
    if (e.target.id !== 'rate') return; e.preventDefault();
    if (!rating.food) return toast('Tap the stars to rate', 'err');
    const b = e.submitter; busy(b, true);
    try { o = await api.post(`/api/orders/${id}/rate`, { rating: rating.food, riderRating: rating.rider || undefined, nps: rating.nps ?? undefined, review: e.target.review.value, wish: e.target.wish.value }); toast('Thanks for the feedback!', 'ok'); confetti(); draw(); }
    catch (x) { toast(x.message, 'err'); busy(b, false); }
  });
  live(async ev => { if (ev.id === id) { const prev = o.status; o = await api.get('/api/orders/' + id); if (o.status !== prev) { draw(); if (o.status === 'delivered') confetti(); } } });
  const poll = setInterval(async () => { if (!alive(el)) return clearInterval(poll); if (!['delivered', 'cancelled', 'rejected'].includes(o.status)) { o = await api.get('/api/orders/' + id).catch(() => o); draw(); } }, 30000);
  draw();
}, { title: 'Track order', auth: true });

/* ---------- orders ---------- */
route('/orders', async el => {
  el.innerHTML = `<h1 style="margin:14px 0">Your orders</h1><div class="stack">${skel(3, 110)}</div>`;
  let older = [];
  el.addEventListener('click', async e => { const b = e.target.closest('#older'); if (!b) return; busy(b, true);
    const all = [...lastOs, ...older], more = await api.get('/api/orders/mine', { before: all.at(-1).createdAt }).catch(x => { toast(x.message, 'err'); return null; });
    if (more) { older = older.concat(more); draw(true); } else busy(b, false); });
  let lastOs = [];
  const draw = async (keep) => {
    if (!keep) lastOs = await api.get('/api/orders/mine');
    const os = [...lastOs, ...older], hasMore = (older.length ? older.length % 30 === 0 : lastOs.length === 30);
    if (!alive(el)) return;
    const isLive = o => ['scheduled', 'placed', 'accepted', 'ready', 'picked'].includes(o.status);
    // orders from one multi-shop checkout show as one card
    const rows = [], seenG = new Map();
    for (const o of os) { if (!o.groupId || o.groupSize < 2) { rows.push(o); continue; } let g = seenG.get(o.groupId); if (!g) { g = { group: true, id: o.groupId, code: o.groupCode, createdAt: o.createdAt, parts: [] }; seenG.set(o.groupId, g); rows.push(g); } g.parts.push(o); }
    const liveOs = rows.filter(o => o.group ? o.parts.some(isLive) : isLive(o)), past = rows.filter(o => !liveOs.includes(o));
    const card = (o, i) => o.group ? `<button class="card" style="width:100%;text-align:left;--i:${i}" data-go="/basket/${o.id}"><div class="row"><div class="thumbs">${o.parts.slice(0, 3).map(p => `<div class="thumb">${pic(p.vendor)}</div>`).join('')}</div><div class="grow"><b>${o.parts.length} shops</b><div class="small mute">${fmtDT(o.createdAt)} · ${esc(o.code)}</div></div>${statusPill(o.parts.some(isLive) ? (o.parts.find(isLive).status) : o.parts.some(p => p.status === 'delivered') ? 'delivered' : 'cancelled')}</div>
      <p class="small" style="margin:10px 0 0">${o.parts.map(p => esc(p.vendor.name)).join(' · ')}</p><div class="row between" style="margin-top:8px"><b class="num">${rs(o.parts.reduce((a, p) => a + p.total, 0))}</b>${liveOs.includes(o) ? '<span class="small" style="color:var(--goText);font-weight:700">Track order</span>' : ''}</div></button>` : `<button class="card" style="width:100%;text-align:left;--i:${i}" data-go="/order/${o.id}"><div class="row"><div class="thumb">${pic(o.vendor)}</div><div class="grow"><b>${esc(o.vendor.name)}</b><div class="small mute">${o.status === 'scheduled' ? `${icon('cal', 12)} For ${fmtDT(o.scheduleAt)}` : fmtDT(o.createdAt)} · ${esc(o.code)}</div></div>${statusPill(o.status)}</div>
      <p class="small" style="margin:10px 0 0">${o.items.map(l => `${esc(l.name)} × ${l.qty}`).join(', ')}</p><div class="row between" style="margin-top:8px"><b class="num">${rs(o.total)}</b>${o.rating ? `<span class="small mute">You rated ${o.rating} ★</span>` : o.status === 'delivered' ? '<span class="small" style="color:var(--goText);font-weight:700">Rate order</span>' : liveOs.includes(o) ? `<span class="pill w">Track live ${icon('chevR', 12)}</span>` : ''}</div></button>`;
    el.innerHTML = `<h1 style="margin:14px 0">Your orders</h1>${!os.length ? empty('No orders yet', 'Your first order is a few taps away.', 'bag') + '<div style="text-align:center"><button class="btn go" data-go="/">Start shopping</button></div>' : ''}
      ${liveOs.length ? `<h3 style="margin:8px 0 10px">Live now</h3><div class="stack stag">${liveOs.map(card).join('')}</div>` : ''}${past.length ? `<h3 style="margin:22px 0 10px">Past orders</h3><div class="stack stag">${past.map(card).join('')}</div>` : ''}
      ${hasMore ? '<button class="btn block" id="older" style="margin-top:14px">Load older orders</button>' : ''}`;
  };
  live(() => draw()); await draw();
}, { title: 'Orders', auth: true });

/* ---------- account ---------- */
route('/account', async el => {
  await refreshMe(); if (!S.me) return nav('/login');
  const u = user(), v = S.me.vendor, r = S.me.rider;
  el.innerHTML = `<div class="card row" style="margin-top:14px;background:var(--brand);color:#fff;border:0"><div class="avatar" style="width:56px;height:56px;font-size:20px">${esc(initials(u.name || 'Me'))}</div><div class="grow"><h2 style="color:#fff">${esc(u.name || 'Add your name')}</h2><span style="opacity:.85">+91 ${esc(u.phone)}</span></div><button class="btn sm mari" id="edit">Edit</button></div>
    ${v?.status === 'approved' || r?.status === 'approved' ? `<div class="card row" style="margin-top:14px">${icon('info', 20)}<span class="grow small">${v?.status === 'approved' ? `Manage <b>${esc(v.name)}</b> in the separate <a href="/shop" target="_blank" rel="noopener">Shop console</a>. ` : ''}${r?.status === 'approved' ? 'Take deliveries in the separate <a href="/rider" target="_blank" rel="noopener">Rider app</a>. ' : ''}Each app has its own login.</span></div>` : ''}
    <div class="wallet" id="wallet"><div class="sk" style="height:120px;border-radius:20px"></div></div>
    <h3 style="margin:22px 0 10px">Saved addresses <span class="small mute">(${(u.addresses || []).length}/${S.config?.maxAddresses || 20})</span></h3><div class="card">${(u.addresses || []).map(a => `<div class="li addrrow"><span class="row grow" style="align-items:flex-start">${icon(a.label === 'Work' ? 'store' : 'home', 20)}<span><b>${esc(a.label)}</b>${u.defaultAddress === a.id ? ' <span class="pill">Default</span>' : ''}<br><span class="small mute">${esc([a.line, a.building, a.floor && 'Floor ' + a.floor, a.area].filter(Boolean).join(', '))} · ${esc(S.zones.find(z => z.id === a.zoneId)?.name || '')}</span>${a.instructions ? `<br><span class="small">${icon('info', 12)} ${esc(a.instructions)}</span>` : ''}${a.receiverName ? `<br><span class="small mute">Receiver: ${esc(a.receiverName)}${a.receiverPhone ? ' · ' + esc(a.receiverPhone) : ''}</span>` : ''}</span></span>
      <span class="row" style="gap:2px">${u.defaultAddress === a.id ? '' : `<button class="btn sm ghost" data-def="${a.id}">Set default</button>`}<button class="iconbtn" data-edit="${a.id}" aria-label="Edit address">${icon('edit', 18)}</button><button class="iconbtn" data-del="${a.id}" aria-label="Delete address">${icon('trash', 18)}</button></span></div>`).join('') || '<p class="mute small" style="margin:0">No saved addresses yet.</p>'}<button class="btn sm" id="addaddr" style="margin-top:10px">${icon('plus', 16)} Add address</button></div>
    <h3 style="margin:22px 0 10px">Help</h3><div class="stack"><button class="card row" style="width:100%;text-align:left" data-go="/help">${icon('info', 22)}<span class="grow"><b>Help & support</b><br><span class="small mute">Your requests, replies, and report a problem</span></span>${icon('chevR')}</button></div>
    <h3 style="margin:22px 0 10px">Earn with ZIPI</h3><div class="stack">
      <button class="card row" style="width:100%;text-align:left" data-go="/partner">${icon('store', 22)}<span class="grow"><b>${v ? esc(v.name) : 'Register your restaurant or shop'}</b><br><span class="small mute">${v ? ({ pending: 'Application under review', approved: 'Live on ZIPI', rejected: 'Needs changes: ' + (v.rejectReason || ''), suspended: 'Suspended' }[v.status]) : 'Zero listing fee, payouts next day'}</span></span>${v ? statusPill(v.status) : icon('chevR')}</button>
      <button class="card row" style="width:100%;text-align:left" data-go="/partner">${icon('bike', 22)}<span class="grow"><b>${r ? 'Your rider application' : 'Become a delivery partner'}</b><br><span class="small mute">${r ? ({ pending: 'Under review', approved: 'Active rider', rejected: 'Needs changes: ' + (r.rejectReason || ''), suspended: 'Suspended' }[r.status]) : 'Flexible hours, weekly pay'}</span></span>${r ? statusPill(r.status) : icon('chevR')}</button></div>
    <h3 style="margin:22px 0 10px">Settings</h3><div class="card"><div class="f" style="margin-top:0"><span>Appearance</span>${themeSeg(store.get('theme', 'system'))}</div>
      <div class="li"><span class="grow"><b>Order notifications</b><br><span class="small mute">${typeof Notification === 'undefined' ? 'Not supported on this browser' : Notification.permission === 'denied' ? 'Blocked in your browser settings' : 'Get an alert when your order is accepted, picked up or delivered'}</span></span><button class="switch" id="ntf" aria-pressed="${notifyOn()}" aria-label="Order notifications" ${typeof Notification === 'undefined' || Notification.permission === 'denied' ? 'disabled' : ''}></button></div></div>
    <h3 style="margin:22px 0 10px">Privacy & my data</h3><div class="card"><p class="small mute" style="margin:0 0 10px">You agreed to ZIPI's terms${u.consentAt ? ' on ' + fmtDate(u.consentAt) : ''}. You can get a copy of everything we hold about you, or delete your account.</p><div class="row wrap"><button class="btn sm" id="myexport">${icon('upload', 16)} Download my data</button><button class="btn sm danger" id="mydelete">${icon('trash', 16)} Delete my account</button></div></div>
    <div class="stack" style="margin-top:22px"><button class="btn danger block" data-act="logout">${icon('logout', 18)} Log out</button>${api.mode === 'server' ? `<button class="btn ghost block" id="logoutall">${icon('lock', 18)} Log out on all devices</button>` : ''}${api.mode === 'local' ? '<button class="btn ghost block" data-act="demo-reset">Reset demo data</button>' : ''}</div>`;
  (async () => { const w = await api.get('/api/me/wallet').catch(() => null); const box = el.querySelector('#wallet'); if (!w || !box) return box?.remove();
    const link = `${location.origin}/?ref=${w.refCode}`;
    box.innerHTML = `<div class="wcoins"><span>${icon('coin', 28)}</span><div class="grow"><small>ZIPI coins</small><b class="num">${w.coins}</b><span class="small">1 coin = ₹1 · earn ${w.loyaltyPct}% back on every order · use up to ${w.coinsMaxPct}% of your item total</span></div><button class="btn sm" id="ledger">History</button></div>
      ${w.referralReward ? `<div class="wref"><div class="grow"><b>Invite friends, get ${w.referralReward} coins each</b><span class="small">They get ${w.referralReward} coins too after their first delivery. ${w.referrals.joined ? `${w.referrals.joined} joined · ${w.referrals.rewarded} rewarded` : ''}</span><code>${esc(w.refCode)}</code></div><button class="btn mari" id="share">${icon('share', 18)} Share</button></div>` : ''}`;
    box.querySelector('#share')?.addEventListener('click', async () => { const text = `Order food and groceries on ZIPI with my code ${w.refCode} and we both get ${w.referralReward} coins: ${link}`;
      if (navigator.share) navigator.share({ title: 'ZIPI', text, url: link }).catch(() => {}); else { await navigator.clipboard?.writeText(text).catch(() => {}); toast('Invite link copied', 'ok'); } });
    box.querySelector('#ledger').onclick = () => sheet(w.ledger.length ? w.ledger.map(x => `<div class="li"><span><b>${esc(x.reason)}</b><br><span class="small mute">${fmtDT(x.at)}</span></span><b class="num" style="color:${x.amount > 0 ? 'var(--goText)' : 'var(--red)'}">${x.amount > 0 ? '+' : ''}${x.amount}</b></div>`).join('') : empty('No coins yet', 'You earn coins on every delivered order.', 'coin'), { title: 'Coin history' });
  })();
  el.querySelector('#ntf')?.addEventListener('click', async e => { const b = e.currentTarget, on = b.getAttribute('aria-pressed') !== 'true';
    if (on) { const p = await Notification.requestPermission(); if (p !== 'granted') { toast('Notifications were not allowed', 'err'); return; } }
    store.set('notify', on); b.setAttribute('aria-pressed', on); toast(on ? 'You will get order alerts' : 'Order alerts off', 'ok'); });
  el.querySelector('#logoutall')?.addEventListener('click', async () => { if (!(await confirmBox('Log out everywhere, including this device? You will need a new code to log in again.', { ok: 'Log out everywhere', danger: true }))) return;
    try { await api.post('/api/auth/logout-all'); } catch { } logout(); toast('Logged out on all devices'); location.hash = '#/'; location.reload(); });
  el.querySelector('#edit').onclick = async () => {
    const s = sheet(`<form>${field('name', 'Name', { req: true, value: u.name })}${field('email', 'Email (optional)', { type: 'email', value: u.email })}<button class="btn go block" style="margin-top:14px">Save</button></form>`, { title: 'Edit profile' });
    s.el.querySelector('form').onsubmit = async e => { e.preventDefault(); try { S.me = await api.patch('/api/me', Object.fromEntries(new FormData(e.target))); toast('Saved', 'ok'); s.close(); updateCustomerBar(); nav('/account', { replace: true }); } catch (x) { toast(x.message, 'err'); } };
  };
  el.querySelector('#addaddr').onclick = async () => { if (await addAddressSheet()) nav('/account', { replace: true }); };
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => { if (await addAddressSheet(null, u.addresses.find(a => a.id === b.dataset.edit))) nav('/account', { replace: true }); });
  el.querySelectorAll('[data-def]').forEach(b => b.onclick = async () => { try { S.me = await api.post(`/api/me/addresses/${b.dataset.def}/default`); S.addressId = b.dataset.def; store.set('addr', b.dataset.def); toast('Default address updated', 'ok'); updateCustomerBar(); nav('/account', { replace: true }); } catch (x) { toast(x.message, 'err'); } });
  el.querySelector('#myexport')?.addEventListener('click', async e => { const b = e.currentTarget; busy(b, true); try { const d = await api.get('/api/me/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'my-zipi-data.json'; a.click(); toast('Your data was downloaded', 'ok'); } catch (x) { toast(x.message, 'err'); } busy(b, false); });
  el.querySelector('#mydelete')?.addEventListener('click', () => {
    const s = sheet(`<p>This removes your name, phone number, addresses, favourites and coins. Past orders are kept for tax records but no longer show who you are. <b>This cannot be undone.</b></p>${field('confirm', 'Type DELETE to confirm', { req: true })}<button class="btn danger block" id="dodel" style="margin-top:12px">Delete my account</button>`, { title: 'Delete account' });
    s.el.querySelector('#dodel').onclick = async ev => { const b = ev.currentTarget; busy(b, true); try { await api.post('/api/me/delete', { confirm: s.el.querySelector('[name=confirm]').value }); logout(); toast('Your account was deleted'); location.hash = '#/'; location.reload(); } catch (x) { toast(x.message, 'err'); busy(b, false); } };
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (await confirmBox('Delete this address?', { ok: 'Delete', danger: true })) { S.me = await api.del('/api/me/addresses/' + b.dataset.del); if (S.addressId === b.dataset.del) { S.addressId = null; store.del('addr'); } updateCustomerBar(); nav('/account', { replace: true }); } });
}, { title: 'Account', auth: true });
