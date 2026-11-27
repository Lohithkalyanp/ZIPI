#!/usr/bin/env node
// Fill a database with synthetic data at scale, then time the busiest API calls.
//   DATA_DIR=/tmp/zipi-scale node scripts/seed-large.js --orders 300000 --vendors 3000 --users 100000
// Use an empty DATA_DIR (or a throwaway DATABASE_URL). Never point this at production.
process.env.TZ ||= 'Asia/Kolkata';
import { config } from '../src/config.js';
import { createApp } from '../src/app/index.js';
import { issueToken } from '../src/http.js';
import { sampleData } from '../src/db/seed.js';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? +process.argv[i + 1] : d; };
const N = { vendors: arg('vendors', 3000), users: arg('users', 100000), orders: arg('orders', 300000), items: arg('items', 25) };
if (config.prod) { console.error('Refusing to run in production'); process.exit(1); }
const app = await createApp(config, { issueToken });
const { db, c } = app;
if (!(await db.count('settings'))) await sampleData(app);
const zones = c.zones().filter(z => z.active), DAY = 86400000, now = Date.now();
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));
const pick = a => a[rnd(0, a.length)];
const t0 = performance.now(), lap = m => console.log(`${m} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);

const vendors = Array.from({ length: N.vendors }, (_, i) => { const z = pick(zones), type = Math.random() < .6 ? 'restaurant' : 'store';
  return { id: `lv${i}`, userId: `lvu${i}`, type, name: `${pick(['Spice', 'Fresh', 'Royal', 'Daily', 'Urban', 'Desi'])} ${pick(['Kitchen', 'Mart', 'Bites', 'Store', 'Cafe', 'Dhaba'])} ${i}`, zoneId: z.id, tags: [type === 'store' ? 'Staples' : pick(['Biryani', 'Pizza', 'Thali'])],
    art: type === 'store' ? 'basket' : 'thali', color: '#0b6e4f', status: 'approved', online: Math.random() < .7, rating: 3.5 + Math.random() * 1.5, ratingCount: rnd(0, 2000), prepMins: rnd(8, 30), costForTwo: 300, loc: { x: Math.random() * 4 - 2, y: Math.random() * 4 - 2 }, address: 'Test lane', hours: '9 am to 11 pm', createdAt: now - 60 * DAY }; });
await db.insertMany('vendors', vendors); lap(`${N.vendors} shops`);
const items = []; for (const v of vendors) for (let j = 0; j < N.items; j++) items.push({ id: `li${v.id}_${j}`, vendorId: v.id, zoneId: v.zoneId, name: `${pick(['Paneer', 'Chicken', 'Veg', 'Masala', 'Butter', 'Atta', 'Milk'])} ${pick(['Biryani', 'Tikka', 'Roll', 'Dosa', 'Pack', 'Bowl'])} ${j}`, price: rnd(20, 500), section: 'Menu', available: true, stock: v.type === 'store' ? rnd(0, 100) : null, lowStockAt: 5, createdAt: now - 60 * DAY });
for (let i = 0; i < items.length; i += 20000) await db.insertMany('items', items.slice(i, i + 20000)); lap(`${items.length} items`);
for (let i = 0; i < N.users; i += 20000) await db.insertMany('users', Array.from({ length: Math.min(20000, N.users - i) }, (_, k) => { const n = i + k, z = pick(zones);
  return { id: `lu${n}`, phone: String(6000000000 + n), name: `Customer ${n}`, roles: ['customer'], addresses: [{ id: `la${n}`, label: 'Home', line: 'House ' + n, area: z.name, zoneId: z.id, loc: { x: Math.random() * 3 - 1.5, y: Math.random() * 3 - 1.5 } }], createdAt: now - rnd(0, 90) * DAY }; }));
lap(`${N.users} customers`);
const statuses = ['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'cancelled', 'rejected'];
for (let i = 0; i < N.orders; i += 10000) {
  await db.insertMany('orders', Array.from({ length: Math.min(10000, N.orders - i) }, (_, k) => { const n = i + k, v = vendors[rnd(0, vendors.length)], at = now - Math.random() * 90 * DAY, st = statuses[rnd(0, 10)], sub = rnd(80, 900);
    return { id: `lo${n}`, code: `ZL${100000 + n}`, customerId: `lu${rnd(0, N.users)}`, vendorId: v.id, zoneId: v.zoneId, vendorType: v.type, items: [{ itemId: `li${v.id}_0`, name: 'Item', price: sub, qty: 1 }], subtotal: sub, deliveryFee: 20, platformFee: 5, smallOrderFee: 0, surgeFee: 0, discount: 0, coinsUsed: 0,
      total: sub + 25, payment: Math.random() < .6 ? 'UPI' : 'COD', status: st, riderId: null, commission: sub * .15, vendorNet: sub * .85, riderPay: 35, dist: 2, address: { zoneId: v.zoneId, area: 'Test' }, timeline: [{ status: 'placed', at }], createdAt: Math.round(at), rating: st === 'delivered' && Math.random() < .3 ? rnd(3, 6) : null }; }));
  if ((i / 10000) % 5 === 0) lap(`${i + 10000} orders`);
}
await db.q('ANALYZE'); lap('all data loaded');

const admin = await db.one('users', { roles: { $has: 'admin' } }), cust = await db.get('users', 'lu42'), vu = vendors[7];
await db.update('users', admin.id, { perms: ['*'] });
const time = async (label, method, path, user, appName = 'customer', body) => {
  const runs = []; let status;
  for (let i = 0; i < 5; i++) { const s = performance.now(); const r = await app.handle(method, path.split('?')[0], { query: Object.fromEntries(new URLSearchParams(path.split('?')[1] || '')), user, app: appName, body }); status = r.status; runs.push(performance.now() - s); }
  runs.sort((a, b) => a - b); console.log(`  ${status === 200 ? '✓' : '✗ ' + status} ${label.padEnd(34)} median ${runs[2].toFixed(0).padStart(5)} ms`);
};
console.log(`\nTimings with ${N.vendors} shops, ${items.length} items, ${N.users} customers, ${N.orders} orders (${(await db.q('SELECT pg_size_pretty(pg_database_size(current_database())) s')).rows[0].s}):`);
const z = zones[0].id;
await time('shop list (home screen)', 'GET', `/api/vendors?zone=${z}`, null);
await time('shop menu', 'GET', `/api/vendors/${vu.id}`, null);
await time('search "paneer"', 'GET', `/api/search?zone=${z}&q=paneer&log=0`, null);
await time('my orders', 'GET', '/api/orders/mine', cust);
await time('login lookup by phone', 'GET', '/api/me', cust);
await time('admin users search', 'GET', '/api/admin/users?q=Customer 4242', admin, 'admin');
await time('manager live orders', 'GET', `/api/manage/orders?zone=${z}`, admin, 'admin');
await time('admin dashboard (14 days)', 'GET', '/api/admin/overview?days=14', admin, 'admin');
await time('market insights (30 days)', 'GET', '/api/admin/insights?days=30', admin, 'admin');
await time('payouts (all shops & riders)', 'GET', '/api/admin/payouts', admin, 'admin');
await app.close();
