// Maps on free OpenStreetMap services: Nominatim (address search and pin-to-address) and OSRM (road distance and routes).
// Results are cached in the database so repeat lookups cost nothing, Nominatim calls are throttled to its 1 request/second
// policy, and every call falls back gracefully (straight-line distance) if the service is slow or down.
// For production traffic run your own Nominatim and OSRM (see deploy/DEPLOY.md) and set NOMINATIM_URL / OSRM_URL.
import { config } from '../config.js';
import { log } from '../log.js';

const DAY = 86400000;
export const haversineKm = (a, b) => {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

export function makeMaps(db) {
  const M = config.maps;
  let nextSlot = 0, failures = 0, openUntil = 0;
  // simple circuit breaker: after repeated failures stop calling for a minute
  const healthy = () => M.enabled && Date.now() > openUntil;
  const tripped = () => { if (++failures >= 5) { openUntil = Date.now() + 60000; failures = 0; log.warn('maps service unavailable, using fallbacks for 60 s'); } };

  async function cached(key, ttl, fn) {
    const r = await db.q('SELECT v, at FROM geo_cache WHERE k = $1', [key]);
    if (r.rows[0] && Date.now() - Number(r.rows[0].at) < ttl) return r.rows[0].v;
    const v = await fn();
    if (v != null) await db.q('INSERT INTO geo_cache (k, v, at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, at = EXCLUDED.at', [key, JSON.stringify(v), Date.now()]);
    return v;
  }
  async function getJson(url, throttle) {
    if (!healthy()) return null;
    if (throttle) { const t = Date.now(), wait = Math.max(0, nextSlot - t); nextSlot = Math.max(t, nextSlot) + 1100; if (wait > 4000) return null; if (wait) await new Promise(r => setTimeout(r, wait)); }
    try {
      const r = await fetch(url, { headers: { 'User-Agent': M.userAgent, 'Accept-Language': 'en-IN,en' }, signal: AbortSignal.timeout(M.timeoutMs) });
      if (!r.ok) { tripped(); return null; }
      failures = 0; return await r.json();
    } catch (err) { tripped(); log.debug('maps request failed', { err: err.message }); return null; }
  }
  const place = x => ({ label: x.display_name, lat: +(+x.lat).toFixed(6), lng: +(+x.lon).toFixed(6),
    area: x.address?.suburb || x.address?.neighbourhood || x.address?.city_district || x.address?.quarter || '', city: x.address?.city || x.address?.town || x.address?.state_district || '',
    road: [x.address?.house_number, x.address?.road].filter(Boolean).join(' '), postcode: x.address?.postcode || '' });

  return {
    haversineKm,
    async search(q, near) {
      q = String(q || '').trim().slice(0, 120); if (q.length < 3) return [];
      const vb = near ? `&viewbox=${near.lng - 0.15},${near.lat + 0.15},${near.lng + 0.15},${near.lat - 0.15}` : '';
      return (await cached(`s:${q.toLowerCase()}:${near ? near.lat.toFixed(2) + ',' + near.lng.toFixed(2) : ''}`, 30 * DAY, async () => {
        const j = await getJson(`${M.nominatimUrl}/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=${M.countryCodes}${vb}&q=${encodeURIComponent(q)}`, true);
        return j ? j.map(place) : null;
      })) || [];
    },
    async reverse(lat, lng) {
      return cached(`r:${lat.toFixed(5)},${lng.toFixed(5)}`, 90 * DAY, async () => {
        const j = await getJson(`${M.nominatimUrl}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`, true);
        return j && !j.error ? place(j) : null;
      });
    },
    // road distance (km), time (min) and the route line; falls back to straight line x 1.35 when routing is unavailable
    async route(a, b, { geometry = false } = {}) {
      const straight = haversineKm(a, b);
      const fallback = { km: Math.round(straight * 1.35 * 10) / 10, mins: Math.round(straight * 1.35 * 3.5 + 2), road: false, coords: null };
      if (straight < 0.05) return { ...fallback, km: 0.1, mins: 1 };
      const key = `rt:${a.lat.toFixed(4)},${a.lng.toFixed(4)}:${b.lat.toFixed(4)},${b.lng.toFixed(4)}:${geometry ? 'g' : ''}`;
      const v = await cached(key, 7 * DAY, async () => {
        const j = await getJson(`${M.osrmUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=${geometry ? 'simplified' : 'false'}&geometries=geojson`, false);
        const rt = j?.routes?.[0]; if (!rt) return null;
        return { km: Math.round(rt.distance / 100) / 10, mins: Math.round(rt.duration / 60 * 1.25 + 2), road: true, coords: geometry ? rt.geometry.coordinates.map(([x, y]) => [+y.toFixed(5), +x.toFixed(5)]) : null };
      });
      return v || fallback;
    },
  };
}
