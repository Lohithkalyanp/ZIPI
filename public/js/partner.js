// Partner onboarding: shop/restaurant and delivery partner applications.
// The same forms are used by shop owners themselves and by zone managers onboarding in the field.
import { api } from './api.js';
import { S, route, nav, refreshMe, user } from './state.js';
import { esc, icon, field, toast, busy, readFile, statusPill, art, colorFor, confetti, fmtDT } from './ui.js';

const RX = { pan: /^[A-Z]{5}\d{4}[A-Z]$/, fssai: /^\d{14}$/, gst: /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, ifsc: /^[A-Z]{4}0[A-Z\d]{6}$/, upi: /^[\w.\-]{2,}@[a-zA-Z]{2,}$/, phone: /^[6-9]\d{9}$/ };
const zonesOpts = () => S.zones.filter(z => z.active).map(z => [z.id, `${z.name}, ${z.city}`]);
const card = (name, value, cur, title, sub, ic) => `<label class="addr" style="cursor:pointer" aria-pressed="${cur === value}"><input type="radio" name="${name}" value="${value}" ${cur === value ? 'checked' : ''} style="position:absolute;opacity:0">${icon(ic, 26)}<span><b>${title}</b><br><span class="small mute">${sub}</span></span></label>`;

function uploader(key, label, docs, req) {
  const d = docs.find(x => x.label === label);
  return `<div class="f"><span>${esc(label)}${req ? ' <b>*</b>' : ''}</span><label class="upl" style="position:relative">${d ? (d.url.startsWith('data:application/pdf') || d.url.endsWith('.pdf') ? icon('doc', 32) : `<img src="${esc(d.url)}" alt="">`) : icon('upload', 24)}<span class="grow">${d ? 'Uploaded · tap to replace' : 'Take a photo or choose a file'}<br><span class="small mute">JPG, PNG or PDF up to 3 MB</span></span><input type="file" accept="image/*,application/pdf" data-up="${esc(label)}"></label></div>`;
}

export function partnerForm(el, kind, { mode = 'self', onDone } = {}) {
  const isV = kind === 'vendor', mgr = mode === 'manager';
  const f = isV ? { type: 'restaurant', storeCategory: 'grocery', zoneId: mgr ? (user().zoneId || S.zones.find(z => z.active)?.id) : S.zoneId, prepMins: 20, costForTwo: 300, hours: '10 am to 11 pm', ownerName: mgr ? '' : user()?.name || '', phone: mgr ? '' : user()?.phone || '', docs: [] }
    : { vehicle: 'bike', shift: 'evening', zoneId: mgr ? (user().zoneId || S.zones.find(z => z.active)?.id) : S.zoneId, name: mgr ? '' : user()?.name || '', languages: 'Hindi', docs: [] };
  const steps = isV ? ['Business', 'Owner & licences', 'Payouts', 'Review'] : ['About you', 'Documents', 'Payouts & consent'];
  let step = 0, err = '';
  const store = () => f.type === 'store';
  const pharma = () => store() && f.storeCategory === 'pharmacy';
  const comm = S.config?.commission || { restaurant: 18, store: 10 };

  function body() {
    if (isV && step === 0) return `<div class="f"><span>What do you run? <b>*</b></span><div class="grid2" style="gap:10px">${card('type', 'restaurant', f.type, 'Restaurant or kitchen', 'Cooked food, sweets, bakery', 'fire')}${card('type', 'store', f.type, 'Shop or store', 'Kirana, vegetables, dairy, pharmacy', 'store')}</div></div>
      ${store() ? field('storeCategory', 'Type of shop', { options: [['grocery', 'Kirana / grocery'], ['veg', 'Fruits & vegetables'], ['dairy', 'Dairy & bakery'], ['pharmacy', 'Pharmacy'], ['other', 'Other']], value: f.storeCategory, attrs: 'data-rr' }) : ''}
      ${field('name', store() ? 'Shop name' : 'Restaurant name', { req: true, value: f.name, ph: 'As on your signboard' })}${field('tags', store() ? 'What you sell' : 'Cuisines', { value: f.tags, ph: store() ? 'Staples, Snacks, Household' : 'North Indian, Thali', hint: 'Separate with commas' })}
      <div class="grid2">${field('zoneId', 'Zone', { req: true, options: zonesOpts(), value: f.zoneId, attrs: mgr && user().zoneId ? 'disabled' : '' })}${field('hours', 'Opening hours', { value: f.hours, ph: '10 am to 11 pm' })}</div>
      ${field('address', 'Full shop address', { req: true, value: f.address, ph: 'Shop number, building, street, area' })}${field('landmark', 'Landmark', { value: f.landmark, ph: 'Near …' })}
      <div class="grid2">${field('prepMins', store() ? 'Minutes to pack an order' : 'Average preparation time (minutes)', { type: 'number', value: f.prepMins, attrs: 'min="3" max="90"' })}${store() ? '' : field('costForTwo', 'Cost for two (₹)', { type: 'number', value: f.costForTwo, attrs: 'min="50"' })}</div>
      ${store() ? '' : `<label class="check"><input type="checkbox" name="pureVeg" ${f.pureVeg ? 'checked' : ''}> Pure vegetarian kitchen</label>`}`;
    if (isV && step === 1) return `<div class="grid2">${field('ownerName', 'Owner full name', { req: true, value: f.ownerName })}${mgr ? field('ownerPhone', 'Owner mobile (used to log in)', { req: true, type: 'tel', value: f.ownerPhone, ph: '10 digits' }) : field('phone', 'Shop phone', { type: 'tel', value: f.phone, ph: '10 digits' })}</div>
      ${field('pan', 'PAN (owner or business)', { req: true, value: f.pan, ph: 'ABCDE1234F', attrs: 'style="text-transform:uppercase" maxlength="10"' })}
      ${pharma() ? field('drugLicense', 'Drug licence number (Form 20/21)', { req: true, value: f.drugLicense, ph: 'MP/IND/20B/1234' }) : field('fssai', 'FSSAI registration or licence number', { req: true, value: f.fssai, ph: '14 digits', attrs: 'inputmode="numeric" maxlength="14"', hint: 'Every food business needs FSSAI. Small shops can get basic registration online.' })}
      ${field('gst', 'GSTIN (only if registered)', { value: f.gst, ph: '23ABCDE1234F1Z5', attrs: 'style="text-transform:uppercase" maxlength="15"' })}
      <div class="grid2">${uploader('photo', 'Shop front photo', f.docs, true)}${uploader('pan', 'PAN card', f.docs, false)}${pharma() ? uploader('dl', 'Drug licence', f.docs, true) : uploader('fssai', 'FSSAI certificate', f.docs, false)}${uploader('menu', store() ? 'Shelf or price list photo' : 'Menu photo', f.docs, false)}</div>`;
    if (isV && step === 2) return `<p class="mute" style="margin-top:0">Money from delivered orders is paid out every week, after ZIPI's commission.</p>
      ${field('upi', 'UPI ID', { value: f.upi, ph: 'shopname@okaxis' })}<p class="small mute" style="text-align:center;margin:10px 0 0">or bank account</p>
      <div class="grid2">${field('accountNo', 'Account number', { value: f.accountNo, attrs: 'inputmode="numeric"' })}${field('ifsc', 'IFSC', { value: f.ifsc, ph: 'SBIN0001234', attrs: 'style="text-transform:uppercase" maxlength="11"' })}</div>
      <div class="card" style="margin-top:16px;background:var(--goTint);border:0"><b>What it costs</b><div class="kv"><span>Listing and setup</span><b>Free</b></div><div class="kv"><span>Commission on ${store() ? 'grocery' : 'food'} orders</span><b>${comm[f.type]}% of item value</b></div><div class="kv"><span>Payouts</span><b>Weekly, to UPI or bank</b></div><p class="small mute" style="margin:6px 0 0">Your zone manager can agree a lower rate for high-volume shops.</p></div>
      ${mgr ? field('commission', 'Agreed commission % (leave blank for standard)', { type: 'number', value: f.commission, attrs: 'min="0" max="40" step="0.5"' }) : ''}`;
    if (isV && step === 3) return `<div class="card"><dl class="dl"><dt>Business</dt><dd>${esc(f.name)} (${store() ? 'shop' : 'restaurant'})</dd><dt>Zone</dt><dd>${esc(S.zones.find(z => z.id === f.zoneId)?.name || '')}</dd><dt>Address</dt><dd>${esc(f.address)}</dd><dt>Owner</dt><dd>${esc(f.ownerName)}${mgr ? ' · +91 ' + esc(f.ownerPhone) : ''}</dd><dt>PAN</dt><dd>${esc((f.pan || '').toUpperCase())}</dd><dt>${pharma() ? 'Drug licence' : 'FSSAI'}</dt><dd>${esc(pharma() ? f.drugLicense : f.fssai)}</dd><dt>Payout</dt><dd>${esc(f.upi || (f.accountNo ? 'Bank ••••' + String(f.accountNo).slice(-4) : ''))}</dd><dt>Documents</dt><dd>${f.docs.length} uploaded</dd></dl></div>
      <label class="check"><input type="checkbox" name="agree" ${f.agree ? 'checked' : ''}> ${mgr ? 'I have checked the original documents in person and the owner agrees to the ZIPI partner terms.' : 'I confirm these details are correct and I agree to the ZIPI partner terms, including keeping my stock and prices up to date.'}</label>
      ${mgr ? '<p class="small mute">Shops you onboard go live straight away under your name.</p>' : '<p class="small mute">Your zone manager reviews applications within 24 hours and may visit to verify documents.</p>'}`;
    if (!isV && step === 0) return `<div class="grid2">${field('name', 'Full name (as on Aadhaar)', { req: true, value: f.name })}${mgr ? field('phone', 'Mobile number (used to log in)', { req: true, type: 'tel', value: f.phone, ph: '10 digits' }) : field('zoneId', 'Zone you want to ride in', { req: true, options: zonesOpts(), value: f.zoneId })}</div>
      ${mgr && !user().zoneId ? field('zoneId', 'Zone', { req: true, options: zonesOpts(), value: f.zoneId }) : ''}
      <div class="f"><span>Your vehicle <b>*</b></span><div class="grid2" style="gap:10px">${card('vehicle', 'bike', f.vehicle, 'Petrol bike', 'Licence and RC needed', 'bike')}${card('vehicle', 'scooter', f.vehicle, 'Scooter', 'Licence and RC needed', 'bike')}${card('vehicle', 'ev', f.vehicle, 'Electric scooter', 'Own or rented', 'spark')}${card('vehicle', 'cycle', f.vehicle, 'Bicycle', 'Short trips, no licence', 'bike')}</div></div>
      <div class="grid2">${field('shift', 'When can you ride?', { options: [['morning', 'Mornings 7–11'], ['lunch', 'Lunch 11–3'], ['evening', 'Evenings 6–11'], ['full', 'Full day'], ['weekend', 'Weekends']], value: f.shift })}${field('languages', 'Languages you speak', { value: f.languages })}</div>
      <div class="grid2">${field('emergencyName', 'Emergency contact name', { value: f.emergencyName })}${field('emergencyPhone', 'Emergency contact number', { type: 'tel', value: f.emergencyPhone })}</div>`;
    if (!isV && step === 1) return `<div class="grid2">${field('aadhaarLast4', 'Last 4 digits of Aadhaar', { req: true, value: f.aadhaarLast4, attrs: 'inputmode="numeric" maxlength="4"', hint: 'We never store your full Aadhaar number' })}${field('pan', 'PAN', { req: true, value: f.pan, ph: 'ABCDE1234F', attrs: 'style="text-transform:uppercase" maxlength="10"' })}</div>
      ${f.vehicle !== 'cycle' ? `<div class="grid2">${field('dl', 'Driving licence number', { req: true, value: f.dl, ph: 'MP09 20190012345', attrs: 'style="text-transform:uppercase"' })}${field('rc', 'Vehicle RC number', { req: true, value: f.rc, ph: 'MP09 AB 1234', attrs: 'style="text-transform:uppercase"' })}</div>` : '<p class="small mute">No licence needed for a bicycle. You will get short trips under 2 km.</p>'}
      <div class="grid2">${uploader('selfie', 'Selfie', f.docs, true)}${f.vehicle !== 'cycle' ? uploader('dl', 'Driving licence photo', f.docs, true) + uploader('rc', 'RC photo', f.docs, false) : ''}${uploader('pan', 'PAN card', f.docs, false)}</div>`;
    if (!isV && step === 2) return `${field('upi', 'UPI ID for weekly pay', { value: f.upi, ph: 'name@okaxis' })}<p class="small mute" style="text-align:center;margin:10px 0 0">or bank account</p><div class="grid2">${field('accountNo', 'Account number', { value: f.accountNo, attrs: 'inputmode="numeric"' })}${field('ifsc', 'IFSC', { value: f.ifsc, attrs: 'style="text-transform:uppercase" maxlength="11"' })}</div>
      <div class="card" style="margin-top:16px;background:var(--goTint);border:0"><b>How you earn</b><div class="kv"><span>Per delivery</span><b>₹20 + ₹6 per km</b></div><div class="kv"><span>Daily bonus</span><b>₹150 at 18 trips</b></div><div class="kv"><span>Payout</span><b>Every week</b></div><div class="kv"><span>Insurance</span><b>Accident cover from day one</b></div></div>
      <label class="check"><input type="checkbox" name="police" ${f.police ? 'checked' : ''}> ${mgr ? 'Rider consents to police verification.' : 'I agree to police verification.'}</label>
      <label class="check"><input type="checkbox" name="agree" ${f.agree ? 'checked' : ''}> ${mgr ? 'I have seen the original documents.' : 'I agree to the ZIPI delivery partner terms, including OTP at every door and depositing cash orders the same day.'}</label>`;
  }
  function draw() {
    el.innerHTML = `<div class="formwrap"><div class="steps">${steps.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div><p class="small mute" style="margin:0">Step ${step + 1} of ${steps.length}</p><h2 style="margin:2px 0 4px">${steps[step]}</h2>
      <form id="pform" novalidate>${body()}${err ? `<div class="err" role="alert">${icon('alert', 14)} ${esc(err)}</div>` : ''}<div class="row" style="margin-top:20px">${step ? '<button type="button" class="btn" data-prev>Back</button>' : ''}<button class="btn go grow big">${step === steps.length - 1 ? (mgr ? 'Onboard and make live' : 'Submit application') : 'Continue'}</button></div></form></div>`;
    el.querySelector('#pform').scrollIntoView?.({ block: 'nearest' });
  }
  const collect = () => { const fm = el.querySelector('#pform'); for (const e of fm.elements) { if (!e.name || e.disabled) continue; if (e.type === 'checkbox') f[e.name] = e.checked; else if (e.type === 'radio') { if (e.checked) f[e.name] = e.value; } else f[e.name] = e.value.trim(); } };
  function validate() {
    const up = s => String(s || '').toUpperCase();
    const hasDoc = l => f.docs.some(d => d.label === l);
    if (isV && step === 0) { if (!f.name) return 'Enter the business name'; if (!f.address) return 'Enter the shop address'; if (!f.zoneId) return 'Choose a zone'; }
    if (isV && step === 1) { if (!f.ownerName) return 'Enter the owner name'; if (mgr && !RX.phone.test(f.ownerPhone)) return 'Enter the owner\'s 10-digit mobile'; if (!mgr && f.phone && !RX.phone.test(f.phone)) return 'Enter a valid shop phone';
      if (!RX.pan.test(up(f.pan))) return 'PAN must look like ABCDE1234F'; if (pharma() ? !f.drugLicense : !RX.fssai.test(f.fssai)) return pharma() ? 'Enter the drug licence number' : 'FSSAI number must be 14 digits';
      if (f.gst && !RX.gst.test(up(f.gst))) return 'GSTIN must be 15 characters, like 23ABCDE1234F1Z5'; if (!hasDoc('Shop front photo')) return 'Add a photo of the shop front'; if (pharma() && !hasDoc('Drug licence')) return 'Upload the drug licence'; }
    if ((isV && step === 2) || (!isV && step === 2)) { if (!f.upi && !(f.accountNo && f.ifsc)) return 'Add a UPI ID or bank account'; if (f.upi && !RX.upi.test(f.upi)) return 'UPI ID must look like name@bank'; if (f.ifsc && !RX.ifsc.test(up(f.ifsc))) return 'IFSC must look like SBIN0001234'; }
    if (isV && step === 3 && !f.agree) return 'Please confirm the declaration';
    if (!isV && step === 0) { if (!f.name) return 'Enter your full name'; if (mgr && !RX.phone.test(f.phone)) return 'Enter a 10-digit mobile number'; }
    if (!isV && step === 1) { if (!/^\d{4}$/.test(f.aadhaarLast4 || '')) return 'Enter the last 4 digits of Aadhaar'; if (!RX.pan.test(up(f.pan))) return 'PAN must look like ABCDE1234F';
      if (f.vehicle !== 'cycle' && (!f.dl || !f.rc)) return 'Enter licence and RC numbers'; if (!hasDoc('Selfie')) return 'Add a selfie'; if (f.vehicle !== 'cycle' && !hasDoc('Driving licence photo')) return 'Upload your driving licence'; }
    if (!isV && step === 2) { if (!f.police) return 'Police verification consent is needed'; if (!f.agree) return 'Please accept the terms'; }
    return '';
  }
  el.addEventListener('change', async e => {
    const t = e.target;
    if (t.type === 'radio' || t.dataset.rr !== undefined) { collect(); draw(); return; }
    if (t.dataset.up) {
      const file = t.files[0]; if (!file) return; const lbl = t.closest('.upl'); lbl.style.opacity = .6;
      try { const dataUrl = await readFile(file); const { url } = await api.post('/api/upload', { dataUrl }); f.docs = f.docs.filter(d => d.label !== t.dataset.up).concat({ label: t.dataset.up, url }); collect(); draw(); toast('Uploaded', 'ok'); }
      catch (x) { toast(x.message, 'err'); lbl.style.opacity = 1; }
    }
  });
  el.addEventListener('click', e => { if (e.target.closest('[data-prev]')) { collect(); step--; err = ''; draw(); } });
  el.addEventListener('submit', async e => {
    e.preventDefault(); collect(); err = validate(); if (err) return draw();
    if (step < steps.length - 1) { step++; draw(); scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const b = e.submitter; busy(b, true);
    const payload = { ...f, pan: (f.pan || '').toUpperCase(), gst: (f.gst || '').toUpperCase(), ifsc: (f.ifsc || '').toUpperCase(), dl: (f.dl || '').toUpperCase(), rc: (f.rc || '').toUpperCase() };
    try {
      const path = mgr ? `/api/manage/onboard/${kind}` : `/api/partners/${kind}/apply`;
      const r = await api.post(path + (mgr && S.manageZone ? `?zone=${S.manageZone}` : ''), payload);
      confetti(); onDone?.(r);
    } catch (x) { err = x.message; busy(b, false); draw(); }
  });
  draw();
}

/* ---------- hub ---------- */
route('/partner', async el => {
  await refreshMe(); const v = S.me.vendor, r = S.me.rider;
  const statusCard = (x, kind) => {
    const title = kind === 'vendor' ? x.name : 'Delivery partner';
    const msg = { pending: 'Under review. Your zone manager usually replies within 24 hours.', approved: 'You are live on ZIPI.', rejected: `Needs changes: ${x.rejectReason || ''}`, suspended: `Suspended. ${x.rejectReason || 'Contact your zone manager.'}` }[x.status];
    return `<div class="card"><div class="row between"><b>${esc(title)}</b>${statusPill(x.status)}</div><p class="mute" style="margin:6px 0 10px">${esc(msg)}</p><p class="small mute" style="margin:0 0 10px">Applied ${fmtDT(x.createdAt)}</p>
      ${x.status === 'approved' ? `<a class="btn go" href="${kind === 'vendor' ? '/shop' : '/rider'}" target="_blank" rel="noopener">Open ${kind === 'vendor' ? 'shop console' : 'rider app'} ${icon('chevR', 16)}</a>` : x.status === 'rejected' ? `<button class="btn go" data-go="/apply/${kind}">Fix and apply again</button>` : ''}</div>`;
  };
  el.innerHTML = `<div style="margin:14px 0 18px"><h1>Grow with ZIPI</h1><p class="mute" style="margin:6px 0 0;max-width:60ch">ZIPI runs on neighbourhood shops and local riders. No warehouses, no dark stores: your shop is the store.</p></div>
    <div class="vgrid">
      <div class="card" style="padding:0;overflow:hidden"><div style="height:150px">${art('basket', colorFor('basket'))}</div><div style="padding:16px"><h2>List your shop or restaurant</h2><ul class="small" style="padding-left:18px;margin:8px 0 14px"><li>New customers within 2 km, at your own prices</li><li>Free listing, commission only on delivered orders</li><li>Simple app for orders, stock and payouts</li></ul>${v ? statusCard(v, 'vendor') : `<button class="btn go block" data-go="/apply/vendor">Register my business</button>`}</div></div>
      <div class="card" style="padding:0;overflow:hidden"><div style="height:150px;background:#1d4e89;display:grid;place-items:center;color:#ffc23d">${icon('bike', 90, 'stroke-width="1.4"')}</div><div style="padding:16px"><h2>Deliver with ZIPI</h2><ul class="small" style="padding-left:18px;margin:8px 0 14px"><li>Short trips in your own neighbourhood</li><li>₹20 + ₹6/km per order, weekly pay</li><li>Bikes, scooters, EVs and bicycles welcome</li></ul>${r ? statusCard(r, 'rider') : `<button class="btn go block" data-go="/apply/rider">Apply to ride</button>`}</div></div></div>`;
}, { title: 'Partner with ZIPI', auth: true });
const done = kind => async r => { await refreshMe(); nav('/partner', { replace: true }); toast(kind === 'vendor' ? 'Application sent! We will review it within 24 hours.' : 'Application sent! Your zone manager will be in touch.', 'ok'); };
route('/apply/vendor', async el => { el.innerHTML = '<div class="row" style="margin:6px 0 10px"><button class="iconbtn" data-go="/partner" aria-label="Back">' + icon('chevL', 22) + '</button><h1 style="font-size:26px">Register your business</h1></div><div id="pf"></div>'; partnerForm(el.querySelector('#pf'), 'vendor', { onDone: done('vendor') }); }, { title: 'Register business', auth: true });
route('/apply/rider', async el => { el.innerHTML = '<div class="row" style="margin:6px 0 10px"><button class="iconbtn" data-go="/partner" aria-label="Back">' + icon('chevL', 22) + '</button><h1 style="font-size:26px">Become a delivery partner</h1></div><div id="pf"></div>'; partnerForm(el.querySelector('#pf'), 'rider', { onDone: done('rider') }); }, { title: 'Ride with ZIPI', auth: true });
