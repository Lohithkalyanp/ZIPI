// Staff tools shared by the admin and zone manager consoles: reports, system health, record recovery.
import { api } from './api.js';
import { S, route, APP } from './state.js';
import { esc, icon, toast, sheet, confirmBox, busy, empty, skel, fmtDT, ago } from './ui.js';

const alive = el => document.body.contains(el);
const opt = APP === 'admin' ? { shell: 'p', section: 'admin', auth: true, role: 'admin' } : { shell: 'p', section: 'manage', auth: true, role: 'manager' };
const base = APP === 'admin' ? '/admin' : '/manage';
const iso = t => new Date(t).toISOString().slice(0, 10);

/* ---------- reports: pick a report, dates and zone; the server streams a CSV ---------- */
route(base + '/reports', async el => {
  el.innerHTML = skel(3, 80);
  const list = await api.get('/api/reports'); if (!alive(el)) return;
  const today = Date.now();
  el.innerHTML = `<div class="phead"><div><h1>Reports</h1><p>Download data as CSV for Excel or Google Sheets. Large exports stream straight from the database, so lakhs of rows are fine. Every download is logged.</p></div></div>
    <form class="card" id="rf"><div class="grid3">
      <label class="f"><span>From</span><input class="in" type="date" name="from" value="${iso(today - 30 * 86400000)}" max="${iso(today)}"></label>
      <label class="f"><span>To</span><input class="in" type="date" name="to" value="${iso(today)}" max="${iso(today)}"></label>
      ${APP === 'admin' ? `<label class="f"><span>Zone</span><select class="in" name="zone"><option value="all">All zones</option>${S.zones.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></label>` : `<div class="f"><span>Zone</span><div class="in" style="display:flex;align-items:center">${esc(S.zones.find(z => z.id === S.me?.user?.zoneId)?.name || 'Your zone')}</div></div>`}
    </div><div class="chips" style="margin-top:10px">${[['Last 7 days', 7], ['Last 30 days', 30], ['Last 90 days', 90], ['This year', 365]].map(([t, d]) => `<button type="button" class="chip" data-range="${d}">${t}</button>`).join('')}</div></form>
    <div class="repgrid">${list.map(r => `<div class="card rep"><div class="grow"><b>${esc(r.name)}</b><p class="small mute" style="margin:4px 0 0">${esc(r.desc)}</p></div><button class="btn go" data-rep="${r.k}">${icon('upload', 16)} Download CSV</button></div>`).join('')}</div>`;
  const form = el.querySelector('#rf');
  el.addEventListener('click', async e => {
    const rg = e.target.closest('[data-range]'); if (rg) { form.from.value = iso(Date.now() - (+rg.dataset.range) * 86400000); form.to.value = iso(Date.now()); return; }
    const b = e.target.closest('[data-rep]'); if (!b) return; busy(b, true);
    try { const name = await api.download('/api/reports/' + b.dataset.rep, { from: form.from.value, to: form.to.value, zone: form.zone?.value }, `zipi-${b.dataset.rep}.csv`); toast(`Downloaded ${name}`, 'ok'); }
    catch (x) { toast(x.message, 'err'); } busy(b, false);
  });
}, { ...opt, title: 'Reports', perm: 'reports' });

if (APP === 'admin') {
  /* ---------- system health: status, automatic checks for stuck data, one-click fixes ---------- */
  route('/admin/health', async el => {
    async function draw() {
      const d = await api.get('/api/admin/ops'); if (!alive(el)) return; const s = d.system;
      const issues = d.checks.filter(c => c.count), bad = issues.filter(c => c.sev === 'high').length;
      el.innerHTML = `<div class="phead"><div><h1>System health</h1><p>Live status and automatic checks for stuck or inconsistent data. Fixes are logged in the audit log. Command-line tools for deeper fixes: <code>node scripts/zipi.js help</code>.</p></div><button class="btn" id="rf">${icon('refresh', 16)} Check again</button></div>
        <div class="kpis"><div class="kpi ${s.db ? '' : 'alert'}"><small>Database</small><b>${s.db ? 'OK' : 'DOWN'}</b><span>${esc(s.dbKind)}${s.pool ? ` · ${s.pool.total} connections, ${s.pool.waiting} waiting` : ''}</span></div>
          <div class="kpi ${s.jobOk ? '' : 'alert'}"><small>Background jobs</small><b>${s.jobOk ? 'Running' : 'Stopped?'}</b><span>last run ${s.lastJobRun ? ago(s.lastJobRun) : 'never'}</span></div>
          <div class="kpi"><small>Live orders</small><b>${s.liveOrders}</b><span>${s.ordersLastHour} placed in the last hour</span></div>
          <div class="kpi"><small>Connected screens</small><b>${s.sseClients}</b><span>on this server process</span></div>
          <div class="kpi"><small>Server</small><b>${Math.round(s.uptimeSec / 3600)} h</b><span>uptime · ${s.memoryMb} MB · pid ${s.pid}</span></div>
          <div class="kpi ${/not/.test(s.smsProvider) ? 'alert' : ''}"><small>Login SMS</small><b style="font-size:18px">${esc(s.smsProvider)}</b><span>files: ${esc(s.storage)}</span></div></div>
        <h2 style="margin:20px 0 10px">${issues.length ? `${issues.length} issue${issues.length > 1 ? 's' : ''} found${bad ? ` · ${bad} serious` : ''}` : `${icon('check', 20)} No issues found`}</h2>
        <div class="stack">${d.checks.map(c => `<div class="card chk ${c.count ? c.sev : 'ok'}"><div class="row between wrap"><div><b>${esc(c.title)}</b><br><span class="small mute">${c.count ? `${c.count} found · fix: ${esc(c.fix)}` : 'All good'}</span></div>
          ${c.count ? (c.key === 'old_open_tickets' ? `<button class="btn sm" data-go="/admin/support">Open inbox</button>` : `<button class="btn sm go" data-fix="${c.key}">${esc(c.fix)} (${c.count})</button>`) : `<span class="pill">${icon('check', 12)} OK</span>`}</div>
          ${c.count ? `<div class="small" style="margin-top:8px">${c.items.map(i => `<span class="pill g" title="${esc(i.id)}">${esc(i.label)}${i.detail ? ' · ' + esc(i.detail) : ''}</span>`).join(' ')}${c.count > c.items.length ? ` …and ${c.count - c.items.length} more` : ''}</div>` : ''}</div>`).join('')}</div>`;
    }
    el.addEventListener('click', async e => {
      if (e.target.closest('#rf')) return draw();
      const b = e.target.closest('[data-fix]'); if (!b) return;
      if (!(await confirmBox(`Run "${b.textContent.trim()}" now? Each change is saved in the audit log and in record history, so it can be undone.`, { ok: 'Fix now' }))) return;
      busy(b, true); try { const r = await api.post('/api/admin/ops/fix', { check: b.dataset.fix }); toast(`Fixed ${r.fixed} of ${r.total}`, 'ok'); } catch (x) { toast(x.message, 'err'); } draw();
    });
    el.innerHTML = skel(4, 80); await draw();
  }, { ...opt, title: 'System health', perm: 'ops' });
}

/* ---------- recovery helpers used by the Data & storage page ---------- */
export async function historySheet(coll, id, after) {
  const d = await api.get(`/api/admin/recovery/history/${coll}/${id}`);
  const s = sheet(`<p class="small mute" style="margin:0 0 10px">Every earlier version of this record. Restoring keeps the current version in history too, so nothing is ever lost.</p>
    ${d.versions.length ? d.versions.map(v => `<details class="ver"><summary><span class="grow"><b>${v.op === 'delete' ? 'Deleted' : v.op === 'restore' ? 'Restored' : 'Before change'}</b> · ${fmtDT(v.at)} · by ${esc(v.byName)}</span><button class="btn sm" data-hid="${v.hid}">Restore this</button></summary><pre class="jsonview">${esc(JSON.stringify(v.data, null, 2))}</pre></details>`).join('') : empty('No earlier versions', 'Changes from now on will appear here.', 'clock')}
    <h3 style="margin-top:14px">Current</h3><pre class="jsonview">${esc(JSON.stringify(d.current, null, 2))}</pre>`, { title: `History · ${coll}`, wide: true });
  s.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-hid]'); if (!b) return; e.preventDefault();
    if (!(await confirmBox('Restore this version? The current version is kept in history.', { ok: 'Restore' }))) return;
    try { await api.post('/api/admin/recovery/restore', { hid: +b.dataset.hid }); toast('Restored', 'ok'); s.close(); after?.(); } catch (x) { toast(x.message, 'err'); }
  });
}
export async function trashView(box) {
  box.innerHTML = skel(3, 50);
  const list = await api.get('/api/admin/recovery/deleted');
  box.innerHTML = `<p class="small mute">Deleted records from the last ${90} days. Restore puts them back exactly as they were.</p>${list.length ? `<div class="tbl"><table><thead><tr><th>Deleted</th><th>What</th><th>Data</th><th>By</th><th></th></tr></thead><tbody>${list.map(x => `<tr><td class="num">${fmtDT(x.at)}</td><td><b>${esc(x.label)}</b></td><td>${esc(x.coll)}</td><td>${esc(x.byName)}</td><td class="r"><button class="btn sm" data-undel="${x.hid}">Restore</button></td></tr>`).join('')}</tbody></table></div>` : empty('Trash is empty', '', 'trash')}`;
  box.onclick = async e => { const b = e.target.closest('[data-undel]'); if (!b) return; busy(b, true); try { await api.post('/api/admin/recovery/restore', { hid: +b.dataset.undel }); toast('Restored', 'ok'); trashView(box); } catch (x) { toast(x.message, 'err'); busy(b, false); } };
}
