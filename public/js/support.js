// Help & support: customers, shops and riders raise requests; admins and zone managers answer them in an inbox.
import { api } from './api.js';
import { S, route, live, user, APP } from './state.js';
import { esc, icon, toast, sheet, confirmBox, field, busy, empty, skel, fmtDT, ago, readFile, rs } from './ui.js';

const alive = el => document.body.contains(el);
const ST = { open: ['Open', 'w'], pending: ['Waiting for you', 'b'], resolved: ['Resolved', ''], closed: ['Closed', 'g'] };
const STAFF_ST = { open: ['Needs reply', 't'], pending: ['Waiting for customer', 'b'], resolved: ['Resolved', ''], closed: ['Closed', 'g'] };
const PRI = ['', 'Low', 'Normal', 'High', 'Urgent'];
const pill = (s, map = ST) => { const [t, c] = map[s] || [s, 'g']; return `<span class="pill ${c}">${esc(t)}</span>`; };

/* ---------- attachments: up to 4 photos per message ---------- */
function attachBox(prefix) {
  return `<div class="attach" id="${prefix}-att"></div><label class="btn sm ghost" style="cursor:pointer">${icon('upload', 16)} Add photo<input type="file" accept="image/*" id="${prefix}-file" hidden></label>`;
}
function bindAttach(root, prefix) {
  const urls = [], box = root.querySelector(`#${prefix}-att`);
  root.querySelector(`#${prefix}-file`).onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (urls.length >= 4) return toast('Up to 4 photos', 'err');
    try { const d = await readFile(f, 1400); const { url } = await api.post('/api/upload', { dataUrl: d }); urls.push(url); box.insertAdjacentHTML('beforeend', `<img src="${esc(url)}" alt="Attached photo">`); } catch (x) { toast(x.message, 'err'); }
  };
  return urls;
}
const msgHtml = (m, mine) => `<div class="msg ${mine ? 'mine' : ''} ${m.internal ? 'internal' : ''}"><div class="bub">${m.internal ? `<b class="small">${icon('lock', 12)} Internal note</b><br>` : ''}${esc(m.text).replace(/\n/g, '<br>')}${(m.attachments || []).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Attachment"></a>`).join('')}</div><small>${esc(m.byName || '')} · ${fmtDT(m.at)}</small></div>`;

/* ---------- raise a request (from Help, or from an order page) ---------- */
export async function newTicketSheet({ order } = {}) {
  const cats = await api.get('/api/support/categories').catch(() => []);
  const orderCats = ['missing', 'wrong', 'quality', 'late', 'damaged', 'payment', 'rider', 'safety'];
  const list = APP === 'customer' ? cats.filter(c => order ? orderCats.includes(c.k) || c.k === 'other' : !['partner'].includes(c.k)) : cats.filter(c => ['partner', 'payment', 'app', 'account', 'safety', 'suggestion', 'other'].includes(c.k));
  return new Promise(res => {
    const s = sheet(`<form id="tf">${order ? `<div class="card row" style="background:var(--sunk);border:0">${icon('bag', 20)}<span class="grow"><b>Order ${esc(order.code)}</b><br><span class="small mute">${esc(order.vendor?.name || '')} · ${rs(order.total)}</span></span></div>` : ''}
      <div class="f"><span>What went wrong?</span><div class="catgrid">${list.map((c, i) => `<label class="chip"><input type="radio" name="category" value="${c.k}" ${i ? '' : 'checked'} hidden>${esc(c.label)}</label>`).join('')}</div></div>
      ${field('text', 'Tell us what happened', { type: 'textarea', req: true, ph: order ? 'e.g. The raita was missing from my order' : 'Describe the problem or your suggestion' })}
      ${attachBox('nt')}
      <button class="btn go block big" style="margin-top:14px">Send to ZIPI support</button><p class="small mute" style="text-align:center;margin:8px 0 0">We usually reply within a few hours. ${S.config?.supportPhone ? `Urgent? Call ${esc(S.config.supportPhone)}.` : ''}</p></form>`, { title: order ? 'Help with this order' : 'Contact support', onClose: () => res(null) });
    const form = s.el.querySelector('#tf'), urls = bindAttach(s.el, 'nt');
    const sync = () => form.querySelectorAll('.catgrid .chip').forEach(l => l.setAttribute('aria-pressed', l.querySelector('input').checked));
    form.addEventListener('change', sync); sync();
    form.onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true);
      try { const t = await api.post('/api/support/tickets', { category: form.category.value, text: form.text.value, orderId: order?.id, attachments: urls }); toast(`Request ${t.code} sent. We'll reply here.`, 'ok'); res(t); s.close(); }
      catch (x) { toast(x.message, 'err'); busy(b, false); } };
  });
}

/* ---------- customer, shop and rider side ---------- */
const helpBase = APP === 'vendor' ? '/vendor/help' : APP === 'rider' ? '/rider/help' : '/help';
const partnerOpt = APP === 'vendor' ? { shell: 'p', section: 'vendor', auth: true, role: 'vendor' } : APP === 'rider' ? { shell: 'p', section: 'rider', auth: true, role: 'rider' } : { auth: true };
route(helpBase, async el => {
  el.innerHTML = skel(3, 80);
  async function draw() {
    const ts = await api.get('/api/support/tickets'); if (!alive(el)) return;
    el.innerHTML = `<div class="${APP === 'customer' ? '' : 'phead'}" style="margin:14px 0"><div><h1>Help & support</h1><p class="mute" style="margin:4px 0 0">Your requests and our replies. ${S.config?.supportPhone ? `Urgent? Call <a href="tel:${esc(S.config.supportPhone.replace(/\s/g, ''))}">${esc(S.config.supportPhone)}</a>.` : ''}</p></div></div>
      <button class="btn go" id="newt">${icon('plus', 18)} New request</button>
      ${APP === 'customer' ? '<p class="small mute">For a problem with an order, open the order and tap "Get help with this order" so we see the details straight away.</p>' : ''}
      <div class="stack" style="margin-top:14px">${ts.length ? ts.map(t => `<button class="card tkrow" data-go="${helpBase}/${t.id}"><div class="row between"><b>${esc(t.subject)}</b>${pill(t.status)}</div><div class="small mute">${esc(t.code)} · ${ago(t.lastMessageAt)}${t.lastFrom === 'staff' && t.status === 'pending' ? ' · <b style="color:var(--goText)">New reply</b>' : ''}</div></button>`).join('') : empty('No requests yet', 'Questions, problems or ideas: we read every one.', 'info')}</div>`;
  }
  el.addEventListener('click', async e => { if (e.target.closest('#newt')) { const t = await newTicketSheet(); if (t) draw(); } });
  live(draw); await draw();
}, { ...partnerOpt, title: 'Help' });

route(helpBase + '/:id', async (el, { id }) => {
  el.innerHTML = skel(3, 80); let csat = 0;
  async function draw() {
    const t = await api.get('/api/support/tickets/' + id); if (!alive(el)) return;
    el.innerHTML = `<div class="row" style="margin:6px 0 14px"><button class="iconbtn" data-go="${helpBase}" aria-label="Back">${icon('chevL', 22)}</button><div class="grow"><h1 style="font-size:24px">${esc(t.subject)}</h1><span class="small mute">${esc(t.code)} · opened ${fmtDT(t.createdAt)}</span></div>${pill(t.status)}</div>
      <div class="thread card">${t.messages.map(m => msgHtml(m, m.from !== 'staff')).join('')}</div>
      ${t.status === 'closed' ? `<p class="small mute" style="text-align:center">This request is closed${t.csat ? ` · you rated it ${t.csat} ★` : ''}.</p>`
        : `<form class="card" id="rf">${field('text', 'Reply', { type: 'textarea', ph: 'Write a message' })}${attachBox('rp')}<button class="btn go block" style="margin-top:10px">Send</button></form>`}
      ${t.status === 'resolved' && !t.csat ? `<div class="card" id="csat"><b>Did we solve it?</b><div class="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n} stars">${icon('star', 30)}</button>`).join('')}</div><button class="btn go block" id="sendcsat" disabled>Rate and close</button></div>` : ''}`;
    const rf = el.querySelector('#rf');
    if (rf) { const urls = bindAttach(el, 'rp'); rf.onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true); try { await api.post(`/api/support/tickets/${id}/reply`, { text: rf.text.value, attachments: urls }); draw(); } catch (x) { toast(x.message, 'err'); busy(b, false); } }; }
    el.querySelector('.thread')?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
  el.addEventListener('click', async e => {
    const st = e.target.closest('#csat [data-n]'); if (st) { csat = +st.dataset.n; el.querySelectorAll('#csat [data-n]').forEach(b => b.classList.toggle('on', +b.dataset.n <= csat)); el.querySelector('#sendcsat').disabled = false; return; }
    if (e.target.closest('#sendcsat')) { try { await api.post(`/api/support/tickets/${id}/rate`, { rating: csat }); toast('Thanks for the feedback!', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); } }
  });
  live(ev => { if (ev.type === 'ticket' && ev.id === id) draw(); }); await draw();
}, { ...partnerOpt, title: 'Help' });

/* ---------- staff inbox (admin console and zone manager console) ---------- */
const staffBase = APP === 'admin' ? '/admin/support' : '/manage/support';
const staffOpt = APP === 'admin' ? { shell: 'p', section: 'admin', auth: true, role: 'admin', perm: 'support' } : { shell: 'p', section: 'manage', auth: true, role: 'manager' };
const zq = () => (APP === 'admin' && S.manageZone && S.manageZone !== 'all' ? { zone: S.manageZone } : {});
route(staffBase, async el => {
  let st = 'active', q = '', who = '';
  async function draw() {
    const d = await api.get('/api/staff/tickets', { status: st, q, ...(who === 'mine' ? { mine: 1 } : who === 'none' ? { unassigned: 1 } : {}), ...zq() }); if (!alive(el)) return;
    const n = k => d.counts[k] || 0;
    el.innerHTML = `<div class="phead"><div><h1>Support inbox</h1><p>${n('open')} need a reply · ${n('pending')} waiting for customers. Urgent and high priority first.</p></div><div class="search" style="box-shadow:none;min-height:42px;min-width:220px">${icon('search', 18)}<input id="tq" placeholder="Ticket, order or name" value="${esc(q)}" aria-label="Search tickets"></div></div>
      <div class="row wrap" style="margin-bottom:12px"><div class="chips">${[['active', 'Active'], ['open', 'Needs reply'], ['pending', 'Waiting'], ['resolved', 'Resolved'], ['closed', 'Closed'], ['all', 'All']].map(([k, t]) => `<button class="chip" data-st="${k}" aria-pressed="${st === k}">${t}</button>`).join('')}</div>
        <div class="chips">${[['', 'Everyone'], ['mine', 'Mine'], ['none', 'Unassigned']].map(([k, t]) => `<button class="chip" data-who="${k}" aria-pressed="${who === k}">${t}</button>`).join('')}</div></div>
      ${d.tickets.length ? `<div class="tbl"><table><thead><tr><th>Ticket</th><th>Customer</th><th>Issue</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Last activity</th></tr></thead><tbody>${d.tickets.map(t => `<tr class="rowlink" data-go="${staffBase}/${t.id}"><td><b>${esc(t.code)}</b>${t.orderCode ? `<br><span class="small mute">${esc(t.orderCode)}</span>` : ''}</td><td>${esc(t.userName)}<br><span class="small mute">${esc(t.app)}</span></td><td style="max-width:320px"><b>${esc(d.categories[t.category] || t.category)}</b><br><span class="small mute">${esc(t.lastMessage)}</span></td><td>${t.priority >= 3 ? `<span class="pill ${t.priority === 4 ? 'r' : 't'}">${PRI[t.priority]}</span>` : `<span class="small">${PRI[t.priority]}</span>`}</td><td>${pill(t.status, STAFF_ST)}</td><td>${esc(t.assignedName || '–')}</td><td class="num">${ago(t.lastMessageAt)}</td></tr>`).join('')}</tbody></table></div>` : empty('Nothing here', 'All caught up.', 'check')}`;
    const i = el.querySelector('#tq'); i.onchange = () => { q = i.value.trim(); draw(); };
  }
  el.addEventListener('click', e => { const s = e.target.closest('[data-st]'); if (s) { st = s.dataset.st; draw(); } const w = e.target.closest('[data-who]'); if (w) { who = w.dataset.who; draw(); } });
  live(ev => { if (ev.type === 'ticket') draw(); }); el.innerHTML = skel(4, 60); await draw();
}, { ...staffOpt, title: 'Support' });

route(staffBase + '/:id', async (el, { id }) => {
  el.innerHTML = skel(3, 80);
  const me = user();
  async function draw() {
    const d = await api.get('/api/staff/tickets/' + id, zq()); if (!alive(el)) return; const t = d.ticket, o = d.order, c = d.customer;
    el.innerHTML = `<div class="phead"><div><button class="btn ghost sm" data-go="${staffBase}">${icon('chevL', 16)} Inbox</button><h1>${esc(t.subject)}</h1><p>${esc(t.code)} · ${esc(d.categories[t.category] || t.category)} · opened ${fmtDT(t.createdAt)} from the ${esc(t.app)} app</p></div>
      <div class="row wrap">${pill(t.status, STAFF_ST)}<select class="in" id="tst" style="width:auto;min-height:40px" aria-label="Status">${Object.keys(STAFF_ST).map(k => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${STAFF_ST[k][0]}</option>`).join('')}</select>
        <select class="in" id="tpr" style="width:auto;min-height:40px" aria-label="Priority">${['low', 'normal', 'high', 'urgent'].map((k, i) => `<option value="${k}" ${i + 1 === t.priority ? 'selected' : ''}>${PRI[i + 1]} priority</option>`).join('')}</select>
        ${t.assignedTo === me.id ? '<span class="pill">Assigned to you</span>' : `<button class="btn sm" id="tme">Assign to me</button>`}</div></div>
      <div class="g2 wide-l"><div><div class="thread card">${t.messages.map(m => msgHtml(m, m.from === 'staff')).join('')}</div>
        ${t.status === 'closed' ? '<p class="small mute">Closed by the customer.' + (t.csat ? ` They rated the help ${t.csat} ★.` : '') + '</p>' : `<form class="card" id="sr">${field('text', 'Reply to the customer', { type: 'textarea', req: true, ph: 'Write a clear, kind reply' })}${attachBox('sr')}
          <label class="check"><input type="checkbox" name="internal"> Internal note (only staff can see it)</label>
          <div class="row wrap" style="margin-top:10px"><button class="btn go grow" data-then="pending">Send reply</button><button class="btn grow" data-then="resolved">Send and resolve</button></div></form>`}</div>
      <div class="stack"><div class="card"><h3>Customer</h3>${c ? `<div class="li"><span><b>${esc(c.name || '–')}</b><br><span class="small mute num">+91 ${esc(c.phone)} · ${c.orders} orders · ${c.coins} coins</span></span><a class="iconbtn" href="tel:+91${esc(c.phone)}" aria-label="Call">${icon('phone', 18)}</a></div>` : ''}
          ${t.status !== 'closed' ? `<button class="btn block" id="comp" style="margin-top:8px">${icon('coin', 16)} Give goodwill coins</button>` : ''}${t.compensation ? `<p class="small mute">Already given: ${t.compensation} coins</p>` : ''}</div>
        ${o ? `<div class="card"><h3>Order ${esc(o.code)}</h3><div class="small mute">${fmtDT(o.createdAt)} · ${esc(o.vendor?.name || '')} · ${esc(o.status)}</div>${o.items.map(l => `<div class="kv"><span>${esc(l.name)} × ${l.qty}</span><span class="num">${rs(l.price * l.qty)}</span></div>`).join('')}<div class="kv tot"><span>${o.payment === 'UPI' ? 'Paid UPI' : 'Cash'}</span><span class="num">${rs(o.total)}</span></div>${o.rider ? `<p class="small mute">Rider: ${esc(o.rider.name)} · +91 ${esc(o.rider.phone)}</p>` : ''}</div>` : ''}
        ${d.previous.length ? `<div class="card"><h3>Earlier requests</h3>${d.previous.map(p => `<div class="li"><a href="#${staffBase}/${p.id}" data-go="${staffBase}/${p.id}">${esc(p.code)}: ${esc(p.subject)}</a>${pill(p.status, STAFF_ST)}</div>`).join('')}</div>` : ''}</div></div>`;
    const sr = el.querySelector('#sr');
    if (sr) { const urls = bindAttach(el, 'sr'); sr.onsubmit = async e => { e.preventDefault(); const b = e.submitter; busy(b, true);
      try { await api.post(`/api/staff/tickets/${id}/reply` + qs(), { text: sr.text.value, internal: sr.internal.checked, attachments: urls, status: sr.internal.checked ? undefined : b.dataset.then }); toast(sr.internal.checked ? 'Note added' : 'Reply sent', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); busy(b, false); } }; }
  }
  const qs = () => (zq().zone ? '?zone=' + zq().zone : '');
  const patch = async b => { try { await api.patch(`/api/staff/tickets/${id}` + qs(), b); toast('Updated', 'ok'); draw(); } catch (x) { toast(x.message, 'err'); } };
  el.addEventListener('change', e => { if (e.target.id === 'tst') patch({ status: e.target.value }); if (e.target.id === 'tpr') patch({ priority: e.target.value }); });
  el.addEventListener('click', async e => {
    if (e.target.closest('#tme')) return patch({ assignedTo: 'me' });
    if (e.target.closest('#comp')) {
      const s = sheet(`<form>${field('coins', 'Coins (1 coin = ₹1)', { type: 'number', req: true, value: 50, attrs: 'min="1" max="2000"' })}${field('note', 'Message to the customer', { ph: 'Sorry about the missing item' })}<button class="btn go block" style="margin-top:12px">Give coins and resolve</button></form>`, { title: 'Goodwill coins' });
      s.el.querySelector('form').onsubmit = async ev => { ev.preventDefault(); try { await api.post(`/api/staff/tickets/${id}/compensate` + qs(), Object.fromEntries(new FormData(ev.target))); toast('Coins added', 'ok'); s.close(); draw(); } catch (x) { toast(x.message, 'err'); } };
    }
  });
  live(ev => { if (ev.type === 'ticket' && ev.id === id) draw(); }); await draw();
}, { ...staffOpt, title: 'Ticket' });
void confirmBox;
