// Shared UI helpers: escaping, formatting, icons, illustrations, sheets, toasts, files.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rs = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const fmtTime = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export const fmtDate = t => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const fmtDT = t => `${fmtDate(t)}, ${fmtTime(t)}`;
export const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(t); };
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const initials = n => (n || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

const P = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8M10 9H8M14 6h3"/>',
  store: '<path d="M4 9l1-5h14l1 5M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c.8-3.5 3.6-5 7-5s6.2 1.5 7 5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.6 0 4.4 1.3 5 4"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-2-4-6-3-5 0M12 8c2-4 6-3 5 0"/>',
  check: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>', chevL: '<path d="M15 5l-7 7 7 7"/>', chevD: '<path d="M6 9l6 6 6-6"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>', wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4"/><circle cx="16" cy="13" r="1.5"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>', spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>', filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M20 20v-4h-4"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', fire: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>', heart: '<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
  heartOn: '<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z" fill="currentColor"/>', moon: '<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>', nav: '<path d="M3 11l18-8-8 18-2-8z"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 8.5h-4a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4h-4M12 6.5v2M12 16.5v1"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', locate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
};
export const icon = (n, s = 20, extra = '') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[n] || ''}</svg>`;
export const vegMark = v => v === true ? '<span class="vm v" title="Veg" aria-label="Veg"></span>' : v === false ? '<span class="vm n" title="Non-veg" aria-label="Non-veg"></span>' : '';

/* ---------- illustrations: one generated picture per dish or shop type ---------- */
let gid = 0;
export const shade = (hex, k) => { const n = parseInt(String(hex).slice(1), 16); if (Number.isNaN(n)) return hex; const f = c => Math.round(c * (1 - k)).toString(16).padStart(2, '0'); return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255); };
const DISH = {
  biryani: `<ellipse cx="50" cy="78" rx="34" ry="7" fill="#0003"/><path d="M18 50h64l-6 26H24z" fill="#8a4b20"/><path d="M18 50h64l-2 8H20z" fill="#6b3613"/><ellipse cx="50" cy="50" rx="32" ry="9" fill="#f4c35a"/><path d="M22 48q28-22 56 0" fill="#f7d27a"/>
    <g fill="#fff6dc">${[[34, 42], [44, 37], [56, 38], [64, 44], [40, 46], [52, 44], [60, 48]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="3" ry="1.3"/>`).join('')}</g><circle cx="48" cy="41" r="2" fill="#2f9e55"/><circle cx="58" cy="43" r="1.6" fill="#c2410c"/><path d="M14 58h10M76 58h10" stroke="#5a2c0e" stroke-width="5" stroke-linecap="round"/>`,
  pizza: `<ellipse cx="50" cy="80" rx="34" ry="6" fill="#0003"/><circle cx="50" cy="50" r="33" fill="#d9822b"/><circle cx="50" cy="50" r="28" fill="#f5c542"/><path d="M50 50L50 17M50 50L78 66M50 50L22 66" stroke="#d9822b" stroke-width="2"/>
    <g fill="#b91c1c">${[[40, 34], [61, 36], [66, 54], [36, 58], [50, 66], [46, 46]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5"/>`).join('')}</g><g fill="#2f7d32">${[[55, 28], [70, 46], [30, 46], [58, 58]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="3" ry="1.6" transform="rotate(30 ${x} ${y})"/>`).join('')}</g>`,
  burger: `<ellipse cx="50" cy="82" rx="30" ry="5" fill="#0003"/><path d="M22 46a28 22 0 0 1 56 0z" fill="#e2913a"/><g fill="#fff3">${[[38, 32], [50, 28], [62, 33], [44, 38], [57, 40]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2" ry="1"/>`).join('')}</g>
    <path d="M20 50q5-5 10 0t10 0 10 0 10 0 10 0 10 0" stroke="#3fa34d" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M24 54h52l-6 8H30z" fill="#facc15"/><rect x="20" y="58" width="60" height="10" rx="5" fill="#6b3a1e"/><path d="M22 70h56a4 4 0 0 1-4 8H26a4 4 0 0 1-4-8z" fill="#d98236"/>`,
  thali: `<ellipse cx="50" cy="80" rx="38" ry="6" fill="#0003"/><circle cx="50" cy="50" r="36" fill="#d4d4d8"/><circle cx="50" cy="50" r="31" fill="#e7e7ea"/>${[[36, 36, '#f59e0b'], [56, 32, '#16a34a'], [68, 48, '#dc2626'], [34, 58, '#fde68a'], [54, 64, '#f97316']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="8.5" fill="#a1a1aa"/><circle cx="${x}" cy="${y}" r="6.5" fill="${c}"/>`).join('')}<ellipse cx="50" cy="48" rx="9" ry="6" fill="#fff8e7"/>`,
  dosa: `<ellipse cx="50" cy="80" rx="38" ry="6" fill="#0003"/><ellipse cx="50" cy="62" rx="40" ry="14" fill="#e5e7eb"/><path d="M12 60Q50 30 88 56Q50 70 12 60z" fill="#e8a33d"/><path d="M20 58Q50 40 80 55" stroke="#c97e22" stroke-width="2" fill="none"/><circle cx="26" cy="70" r="7" fill="#f8fafc"/><circle cx="26" cy="70" r="5" fill="#dcfce7"/><circle cx="76" cy="70" r="7" fill="#f8fafc"/><circle cx="76" cy="70" r="5" fill="#fb923c"/>`,
  noodles: `<ellipse cx="50" cy="82" rx="30" ry="5" fill="#0003"/><path d="M16 46h68a34 30 0 0 1-68 0z" fill="#b91c1c"/><path d="M16 46h68" stroke="#7f1d1d" stroke-width="3"/><path d="M26 44q6-14 12 0t12 0 12 0 12 0" stroke="#fcd34d" stroke-width="4" fill="none"/><circle cx="40" cy="40" r="3" fill="#16a34a"/><circle cx="60" cy="38" r="3" fill="#f97316"/><path d="M60 12L78 44M68 10L82 42" stroke="#78350f" stroke-width="3" stroke-linecap="round"/>`,
  cake: `<ellipse cx="50" cy="82" rx="30" ry="5" fill="#0003"/><path d="M22 44h56v34H22z" fill="#7c2d12"/><path d="M22 54h56v6H22zM22 66h56v5H22z" fill="#fbcfe8"/><path d="M22 44q7 8 14 0t14 0 14 0 14 0v-4H22z" fill="#fce7f3"/><circle cx="50" cy="34" r="6" fill="#dc2626"/><path d="M50 28q3-6 8-6" stroke="#166534" stroke-width="2" fill="none"/>`,
  poha: `<ellipse cx="50" cy="80" rx="36" ry="6" fill="#0003"/><ellipse cx="50" cy="60" rx="38" ry="15" fill="#f1f5f9"/><ellipse cx="50" cy="56" rx="30" ry="10" fill="#facc15"/><g fill="#fde68a">${Array.from({ length: 14 }, (_, i) => `<ellipse cx="${26 + (i * 37) % 48}" cy="${51 + (i * 13) % 10}" rx="2.4" ry="1" />`).join('')}</g><g fill="#16a34a">${[[36, 52], [58, 54], [48, 59]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g><g fill="#dc2626">${[[44, 52], [64, 57], [32, 58]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6"/>`).join('')}</g><path d="M70 30a8 8 0 1 1-8 8a5 5 0 1 1 5-5a2 2 0 1 1-2 2" stroke="#f97316" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  chai: `<ellipse cx="50" cy="82" rx="26" ry="5" fill="#0003"/><path d="M28 40h40l-5 38H33z" fill="#fef3c7"/><path d="M30 46h36l-1 8H31z" fill="#b45309"/><path d="M68 48a8 8 0 0 1 0 16" stroke="#fef3c7" stroke-width="5" fill="none"/><path d="M40 32q-4-6 0-12M50 32q-4-6 0-12M60 32q-4-6 0-12" stroke="#fff9" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  basket: `<ellipse cx="50" cy="84" rx="36" ry="5" fill="#0003"/><rect x="28" y="22" width="14" height="30" rx="4" fill="#3b82f6"/><rect x="31" y="16" width="8" height="8" rx="2" fill="#1e40af"/><path d="M46 30h22a4 4 0 0 1 4 4v18H44V32a2 2 0 0 1 2-2z" fill="#f59e0b"/><circle cx="66" cy="28" r="9" fill="#16a34a"/><path d="M14 46h72l-8 34H22z" fill="#a16207"/><path d="M20 54h60M22 62h56M24 70h52" stroke="#854d0e" stroke-width="2.5"/><path d="M30 46q20-26 40 0" stroke="#713f12" stroke-width="4" fill="none"/>`,
  veg: `<ellipse cx="50" cy="84" rx="34" ry="5" fill="#0003"/><circle cx="36" cy="58" r="20" fill="#dc2626"/><path d="M30 40q6 4 12 0q-2 6-6 6t-6-6z" fill="#15803d"/><path d="M60 30l18 48-8 2z" fill="#f97316"/><path d="M62 30q-4-10 2-14M64 30q2-12 10-12M66 31q8-6 12-2" stroke="#16a34a" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="30" cy="52" rx="5" ry="3" fill="#fff5" transform="rotate(-30 30 52)"/>`,
  dairy: `<ellipse cx="50" cy="84" rx="34" ry="5" fill="#0003"/><path d="M28 24h18v10l5 8v38H23V42l5-8z" fill="#f8fafc"/><rect x="23" y="50" width="28" height="16" fill="#3b82f6"/><rect x="30" y="18" width="14" height="7" rx="2" fill="#1d4ed8"/><path d="M56 56l26-8v26l-26 8z" fill="#facc15"/><path d="M56 56l-6-6 26-8 6 6z" fill="#fde047"/><circle cx="68" cy="64" r="3" fill="#eab308"/><circle cx="74" cy="70" r="2" fill="#eab308"/>`,
  fruit: `<ellipse cx="50" cy="84" rx="34" ry="5" fill="#0003"/><circle cx="36" cy="58" r="18" fill="#dc2626"/><path d="M36 40q2-8 8-10" stroke="#166534" stroke-width="3" fill="none"/><ellipse cx="46" cy="34" rx="6" ry="3" fill="#16a34a" transform="rotate(-25 46 34)"/><circle cx="64" cy="62" r="15" fill="#f97316"/><circle cx="60" cy="58" r="3" fill="#fff6"/><path d="M58 30q16 2 22 22q-10-2-14 6q-6-16-8-28z" fill="#facc15"/>`,
  snack: `<ellipse cx="50" cy="84" rx="30" ry="5" fill="#0003"/><path d="M28 22h44l-4 58H32z" fill="#f59e0b"/><path d="M28 22l4-6h36l4 6z" fill="#b45309"/><rect x="34" y="38" width="32" height="20" rx="4" fill="#fff"/><path d="M38 48q6-6 12 0t12 0" stroke="#dc2626" stroke-width="3" fill="none"/><circle cx="40" cy="68" r="3" fill="#fde68a"/><circle cx="58" cy="70" r="3" fill="#fde68a"/>`,
  drink: `<ellipse cx="50" cy="84" rx="26" ry="5" fill="#0003"/><path d="M34 30h32l-4 52H38z" fill="#e0f2fe"/><path d="M36 46h28l-3 34H39z" fill="#f97316"/><path d="M56 30l8-18" stroke="#16a34a" stroke-width="4" stroke-linecap="round"/><circle cx="44" cy="58" r="2.5" fill="#fff9"/><circle cx="54" cy="66" r="2" fill="#fff9"/><ellipse cx="66" cy="34" rx="7" ry="4" fill="#facc15"/>`,
  ice: `<ellipse cx="50" cy="86" rx="22" ry="4" fill="#0003"/><path d="M38 50l12 34 12-34z" fill="#d97706"/><path d="M40 52l20 0M42 60l16 0M45 68l10 0" stroke="#92400e" stroke-width="1.5"/><circle cx="42" cy="44" r="12" fill="#fbcfe8"/><circle cx="58" cy="44" r="12" fill="#bae6fd"/><circle cx="50" cy="32" r="12" fill="#fef3c7"/><circle cx="50" cy="22" r="3" fill="#dc2626"/><path d="M20 22l6 4M20 30h6M80 22l-6 4M80 30h-6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  pen: `<ellipse cx="50" cy="86" rx="32" ry="4" fill="#0003"/><rect x="22" y="40" width="40" height="42" rx="3" fill="#f8fafc"/><path d="M28 50h28M28 58h28M28 66h20" stroke="#93c5fd" stroke-width="2"/><rect x="22" y="40" width="6" height="42" fill="#ef4444"/><g transform="rotate(35 70 40)"><rect x="64" y="14" width="10" height="48" rx="2" fill="#facc15"/><path d="M64 62l5 10 5-10z" fill="#fde68a"/><path d="M68 70l1 2 1-2z" fill="#334155"/><rect x="64" y="14" width="10" height="6" fill="#f472b6"/></g>`,
  gift: `<ellipse cx="50" cy="86" rx="32" ry="4" fill="#0003"/><rect x="24" y="44" width="52" height="38" rx="3" fill="#ec4899"/><rect x="20" y="36" width="60" height="12" rx="3" fill="#f472b6"/><rect x="46" y="36" width="8" height="46" fill="#fde047"/><path d="M50 36q-16-16-20-4q-2 6 20 4zM50 36q16-16 20-4q2 6-20 4z" fill="#fde047"/>`,
  soap: `<ellipse cx="50" cy="86" rx="32" ry="4" fill="#0003"/><rect x="24" y="30" width="22" height="52" rx="6" fill="#a78bfa"/><rect x="29" y="22" width="12" height="10" rx="2" fill="#7c3aed"/><rect x="28" y="48" width="14" height="14" rx="2" fill="#fff"/><rect x="52" y="58" width="28" height="22" rx="8" fill="#fbcfe8"/><circle cx="60" cy="50" r="5" fill="#e0f2fe" stroke="#93c5fd"/><circle cx="72" cy="44" r="3.5" fill="#e0f2fe" stroke="#93c5fd"/>`,
  clean: `<ellipse cx="50" cy="86" rx="32" ry="4" fill="#0003"/><path d="M30 34h22l4 48H26z" fill="#22c55e"/><path d="M34 34v-8h14v8" fill="#15803d"/><path d="M48 26h10l4 4" stroke="#15803d" stroke-width="4" fill="none" stroke-linecap="round"/><rect x="31" y="50" width="20" height="14" rx="2" fill="#fff"/><path d="M64 40l10 40M60 80h18" stroke="#a16207" stroke-width="4" stroke-linecap="round"/><path d="M58 80l4-10h14l4 10z" fill="#facc15"/>`,
  meds: `<ellipse cx="50" cy="84" rx="34" ry="5" fill="#0003"/><rect x="20" y="34" width="36" height="44" rx="6" fill="#f8fafc"/><path d="M33 46h10v8h8v10h-8v8H33v-8h-8V54h8z" fill="#dc2626"/><g transform="rotate(-35 70 50)"><rect x="58" y="40" width="26" height="12" rx="6" fill="#f8fafc"/><path d="M71 40h7a6 6 0 0 1 0 12h-7z" fill="#2563eb"/></g>`,
};
export function art(kind = 'thali', color = '#0b7a43', { ratio = 'wide', label = '' } = {}) {
  const id = 'g' + (++gid), W = ratio === 'square' ? 100 : 190, H = 100, x = (W - 100) / 2;
  const dish = DISH[kind] || DISH.thali;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(label)}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, .5)}"/></linearGradient><radialGradient id="${id}l" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="${color}"/><rect width="${W}" height="${H}" fill="url(#${id})"/>
  ${ratio === 'wide' ? `<g fill="#fff" opacity=".07">${[12, 38, 152, 176].map((cx, i) => `<circle cx="${cx}" cy="${[20, 82, 14, 70][i]}" r="${[18, 12, 10, 22][i]}"/>`).join('')}</g>` : ''}
  <ellipse cx="${W / 2}" cy="52" rx="44" ry="40" fill="url(#${id}l)"/><g transform="translate(${x} 0)">${dish}</g></svg>`;
}
export const pic = (o, kind, ratio = 'wide') => o?.image ? `<img src="${esc(o.image)}" alt="${esc(o.name || '')}" loading="lazy">` : art(o?.art || kind, o?.color || colorFor(o?.art || kind), { ratio, label: o?.name || '' });
const COLORS = { fruit: '#b45309', snack: '#c2410c', drink: '#0e7490', ice: '#1d4e89', pen: '#4338ca', gift: '#9d174d', soap: '#6b21a8', clean: '#166534', biryani: '#7a3b12', pizza: '#a3201c', burger: '#c2410c', thali: '#b5531a', dosa: '#8a6d1a', noodles: '#991b1b', cake: '#9d174d', poha: '#d9861c', chai: '#78350f', basket: '#0b6e4f', veg: '#2f9e55', dairy: '#1d4e89', meds: '#b91c1c' };
export const colorFor = k => COLORS[k] || '#0b7a43';

/* ---------- overlays ---------- */
export function toast(msg, type = '') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.setAttribute('role', 'status');
  t.innerHTML = (type === 'ok' ? icon('check', 18) : type === 'err' ? icon('alert', 18) : '') + `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t); setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3200);
}
export function sheet(html, { title = '', wide = false, onClose } = {}) {
  const bd = document.createElement('div'); bd.className = 'backdrop';
  bd.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div>${title ? `<header><h2>${esc(title)}</h2><button class="iconbtn" data-close aria-label="Close">${icon('x')}</button></header>` : ''}<div class="sbody">${html}</div></div>`;
  const prev = document.activeElement;
  const close = () => { if (bd.dataset.c) return; bd.dataset.c = 1; bd.classList.add('closing'); bd.firstChild.classList.add('closing'); document.removeEventListener('keydown', key); setTimeout(() => { bd.remove(); prev?.focus?.(); onClose?.(); }, 250); };
  const key = e => { if (e.key === 'Escape') close(); };
  bd.addEventListener('click', e => { if (e.target === bd || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', key);
  $('#overlay').appendChild(bd);
  setTimeout(() => (bd.querySelector('input,select,textarea,button:not([data-close])') || bd.querySelector('button'))?.focus(), 60);
  return { el: bd.querySelector('.sbody'), close };
}
export function confirmBox(msg, { ok = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise(res => {
    let done = false;
    const s = sheet(`<p style="margin:0 0 16px">${esc(msg)}</p><div class="row"><button class="btn grow" data-close>Cancel</button><button class="btn grow ${danger ? 'danger' : 'go'}" data-ok>${esc(ok)}</button></div>`, { title, onClose: () => { if (!done) res(false); } });
    s.el.querySelector('[data-ok]').onclick = () => { done = true; res(true); s.close(); };
  });
}
export function ask(title, fieldsHtml, { ok = 'Save', danger = false } = {}) {
  return new Promise(res => {
    let done = false;
    const s = sheet(`<form>${fieldsHtml}<div class="row" style="margin-top:18px"><button type="button" class="btn grow" data-close>Cancel</button><button class="btn grow ${danger ? 'danger' : 'go'}">${esc(ok)}</button></div></form>`, { title, onClose: () => { if (!done) res(null); } });
    s.el.querySelector('form').onsubmit = e => { e.preventDefault(); done = true; res(formValues(e.target)); s.close(); };
  });
}
export function formValues(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else if (el.type !== 'file') o[el.name] = el.value;
  }
  return o;
}
export const field = (name, label, { type = 'text', value = '', req = false, ph = '', hint = '', attrs = '', options = null } = {}) => {
  const id = 'f-' + name + '-' + (++gid);
  const input = options ? `<select class="in" id="${id}" name="${name}" ${attrs}>${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
    : type === 'textarea' ? `<textarea class="in" id="${id}" name="${name}" placeholder="${esc(ph)}" ${attrs}>${esc(value)}</textarea>`
    : `<input class="in" id="${id}" name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(ph)}" ${req ? 'required' : ''} ${attrs}>`;
  return `<label class="f" for="${id}"><span>${esc(label)}${req ? ' <b>*</b>' : ''}</span>${input}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</label>`;
};
export const busy = (btn, on) => { if (!btn) return; if (on) { btn.dataset.t = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; } else { btn.disabled = false; if (btn.dataset.t) btn.innerHTML = btn.dataset.t; } };

export function readFile(file, max = 1280) {
  return new Promise((res, rej) => {
    if (file.size > 8e6) return rej(new Error('File is larger than 8 MB'));
    const r = new FileReader(); r.onerror = () => rej(new Error('Could not read the file'));
    r.onload = () => {
      if (!file.type.startsWith('image/')) { if (file.size > 3e6) return rej(new Error('PDF is larger than 3 MB')); return res(r.result); }
      const img = new Image(); img.onerror = () => rej(new Error('That image could not be opened'));
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .82)); };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

export function empty(title, sub = '', ic = 'box') { return `<div class="empty">${icon(ic, 44)}<b>${esc(title)}</b>${esc(sub)}</div>`; }
export const skel = (n = 3, h = 220) => Array.from({ length: n }, () => `<div class="sk" style="height:${h}px"></div>`).join('');
export const STATUS = { scheduled: ['Scheduled', 'b'], placed: ['New', 'w'], accepted: ['Preparing', 'b'], ready: ['Ready', 'b'], picked: ['Out for delivery', 'w'], delivered: ['Delivered', ''], cancelled: ['Cancelled', 'g'], rejected: ['Rejected', 'r'],
  pending: ['Pending review', 'w'], approved: ['Approved', ''], suspended: ['Suspended', 'r'] };
export const statusPill = s => { const [t, c] = STATUS[s] || [s, 'g']; return `<span class="pill ${c}">${esc(t)}</span>`; };
export function bars(rows, { fmt = n => n, cls = '' } = {}) {
  const mx = Math.max(1, ...rows.map(r => r.n));
  return rows.length ? `<div class="bars ${cls}">${rows.map(r => `<div class="b"><span title="${esc(r.k)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.k)}</span><span class="t"><i style="width:${(r.n / mx) * 100}%"></i></span><b class="num">${esc(fmt(r.n))}</b></div>`).join('')}</div>` : '<p class="mute small">No data yet.</p>';
}
export function cols(vals, labels, { peakTop = 0 } = {}) {
  const mx = Math.max(1, ...vals), sorted = [...vals].sort((a, b) => b - a), cut = peakTop ? sorted[peakTop - 1] : Infinity;
  return `<div class="cols">${vals.map((v, i) => `<div title="${esc(labels[i])}: ${v}"><i class="${v >= cut && v > 0 ? 'peak' : ''}" style="height:${(v / mx) * 100}%;animation-delay:${i * 18}ms"></i><span>${esc(labels[i])}</span></div>`).join('')}</div>`;
}

export function confetti() {
  if (reduced()) return;
  const c = document.createElement('canvas'); c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:95';
  document.body.appendChild(c); const W = c.width = innerWidth, H = c.height = innerHeight, g = c.getContext('2d');
  const cs = ['#ffc23d', '#ff5a36', '#ffffff', '#43c983', '#6ea2ff'];
  const ps = Array.from({ length: 140 }, () => ({ x: W / 2, y: H * .45, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4, r: Math.random() * 6 + 3, c: cs[Math.floor(Math.random() * cs.length)], a: Math.random() * 6 }));
  let f = 0; const step = () => { g.clearRect(0, 0, W, H); for (const p of ps) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.a += .2; g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); g.restore(); }
    if (++f < 110) requestAnimationFrame(step); else c.remove(); }; step();
}
let actx = null;
export function beep() { try { actx = actx || new AudioContext(); const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination); o.frequency.value = 880; g.gain.setValueAtTime(.001, actx.currentTime); g.gain.exponentialRampToValueAtTime(.25, actx.currentTime + .02); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + .5); o.start(); o.stop(actx.currentTime + .5); } catch { } }
export function flyTo(fromEl, toSel) {
  const to = $(toSel); if (!fromEl || !to || reduced()) return;
  const a = fromEl.getBoundingClientRect(), b = to.getBoundingClientRect();
  const d = document.createElement('div'); d.className = 'flyer'; d.style.left = a.left + a.width / 2 - 11 + 'px'; d.style.top = a.top + a.height / 2 - 11 + 'px'; document.body.appendChild(d);
  const dx = b.left + 40 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  d.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${dx * .5}px,${dy - 120}px) scale(1.2)`, offset: .45 }, { transform: `translate(${dx}px,${dy}px) scale(.4)`, opacity: .6 }], { duration: 650, easing: 'cubic-bezier(.5,0,.5,1)' }).onfinish = () => d.remove();
}
