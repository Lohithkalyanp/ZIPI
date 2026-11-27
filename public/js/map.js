// Real maps: Leaflet (bundled in /vendor/leaflet) with OpenStreetMap tiles. Loaded only when a page needs a map.
// Every caller keeps a fallback, so the app still works offline or if the tile server is unreachable.
let loading = null;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return loading ||= new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = '/vendor/leaflet/leaflet.js';
    s.onload = () => res(window.L); s.onerror = () => { loading = null; rej(new Error('Map could not load')); };
    document.head.appendChild(s);
  });
}

export async function makeMap(el, { center, zoom = 14, interactive = true } = {}) {
  const L = await loadLeaflet();
  const m = L.map(el, { zoomControl: interactive, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: interactive, scrollWheelZoom: false, tap: false })
    .setView([center.lat, center.lng], zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
  // maps inside sheets or freshly inserted nodes need a size recheck
  setTimeout(() => m.invalidateSize(), 120);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => m.invalidateSize()).observe(el);
  return { L, m };
}

const GLYPH = {
  shop: '<path d="M-6-3l1.5-5h9L6-3M-6-3v8h12v-8M-6-3h12" stroke="#fff" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  home: '<path d="M-7 1L0-6 7 1V7H-7z" fill="#fff"/>',
  rider: '<circle cx="-4" cy="3" r="2.5" fill="#14201a"/><circle cx="4" cy="3" r="2.5" fill="#14201a"/><path d="M-4 3l3-6h3" stroke="#14201a" stroke-width="2" fill="none"/>',
};
export function pin(L, kind, { color = '#0b7a43', label = '', pulse = false, dim = false } = {}) {
  const fill = kind === 'rider' ? '#ffc23d' : kind === 'home' ? '#14201a' : color;
  const html = `<div class="zpin ${pulse ? 'pulse' : ''} ${dim ? 'dim' : ''}"><svg width="40" height="40" viewBox="-20 -20 40 40" aria-hidden="true"><circle r="15" fill="${fill}" stroke="#fff" stroke-width="3"/>${GLYPH[kind] || ''}</svg>${label ? `<span>${label}</span>` : ''}</div>`;
  return L.divIcon({ className: 'zpin-wrap', html, iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18] });
}

/* smooth marker glide between GPS fixes */
export function glide(marker, to, ms = 900) {
  const from = marker.getLatLng(), t0 = performance.now();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return marker.setLatLng(to);
  const step = t => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    marker.setLatLng([from.lat + (to.lat - from.lat) * e, from.lng + (to.lng - from.lng) * e]); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* gentle curve between two points, like the old SVG route, so the line reads as a route rather than a ruler */
export function curve(a, b, n = 24) {
  const mx = (a.lat + b.lat) / 2 + (b.lng - a.lng) * .18, my = (a.lng + b.lng) / 2 - (b.lat - a.lat) * .18;
  return Array.from({ length: n + 1 }, (_, i) => { const k = i / n; return [(1 - k) ** 2 * a.lat + 2 * (1 - k) * k * mx + k * k * b.lat, (1 - k) ** 2 * a.lng + 2 * (1 - k) * k * my + k * k * b.lng]; });
}
export const along = (pts, k) => { const i = Math.min(pts.length - 1, Math.max(0, Math.round(k * (pts.length - 1)))); return { lat: pts[i][0], lng: pts[i][1] }; };

export const kmBetween = (a, b) => { const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

export const directionsUrl = (to, from) => `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from.lat},${from.lng}` : ''}&destination=${to.lat},${to.lng}&travelmode=two-wheeler`;

/* old-style km offsets (x east, y south from the zone centre) to map coordinates, same maths as the server */
export function locLL(zone, loc) {
  if (!zone || zone.lat == null) return null;
  return { lat: zone.lat - (loc?.y || 0) / 110.574, lng: zone.lng + (loc?.x || 0) / (111.32 * Math.cos(zone.lat * Math.PI / 180)) };
}
