// First start in development: move existing data from the old SQLite file (data/zipi.db) into PostgreSQL, or create sample data.
// Also used by `node scripts/zipi.js seed` and `node scripts/zipi.js import-sqlite <file>`.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { log } from '../log.js';
import { createMemDB } from '../../core/memdb.js';
import { seed as sampleSeed } from '../../core/seed.js';
import { encryptFields } from '../services/crypto.js';
import { COLLECTIONS } from './schema.js';
import { categoryOf } from '../app/routes/grocery.js';

const ZONE_CENTERS = { 'z-vijay': [22.7533, 75.8937], 'z-palasia': [22.7236, 75.8867], 'z-bhawar': [22.6929, 75.8676] };

// bring documents from the old format up to the new one
export function upgrade(dump) {
  const out = {};
  const vendorZone = new Map((dump.vendors || []).map(v => [v.id, v.zoneId])), vendorType = new Map((dump.vendors || []).map(v => [v.id, v.type]));
  for (const [coll, docs] of Object.entries(dump)) {
    if (!COLLECTIONS.includes(coll) || coll === 'otps') continue;
    out[coll] = docs.map(d => {
      if (coll === 'vendors' || coll === 'riders') return encryptFields(coll, d);
      if (coll === 'items') return { ...d, zoneId: d.zoneId || vendorZone.get(d.vendorId) || null, ...(vendorType.get(d.vendorId) === 'store' ? { category: categoryOf(d) } : {}) };
      if (coll === 'zones' && d.lat == null) { const c = ZONE_CENTERS[d.id] || [22.7196, 75.8577]; return { ...d, lat: c[0], lng: c[1] }; }
      if (coll === 'users' && d.roles?.includes('admin') && !d.perms) return { ...d, perms: ['*'] };
      if (coll === 'shifts') return { ...d, id: `${d.riderId}:${d.day}:${d.slot}` };
      return d;
    });
  }
  return out;
}

export async function load(app, dump) {
  const data = upgrade(dump);
  for (const [coll, docs] of Object.entries(data)) if (docs.length) await app.db.insertMany(coll, docs, { upsert: true });
  // order and ticket numbers continue after the highest existing one
  const maxCode = (data.orders || []).reduce((m, o) => Math.max(m, +String(o.code || '').replace(/\D/g, '') || 0), 1000);
  await app.db.q(`SELECT setval('order_code_seq', $1)`, [maxCode]);
  await app.c.invalidate();
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
}

export async function importSqlite(app, file) {
  const { DatabaseSync } = await import('node:sqlite');
  const sql = new DatabaseSync(file, { readOnly: true }), dump = {};
  for (const row of sql.prepare('SELECT coll, data FROM docs').iterate()) (dump[row.coll] ||= []).push(JSON.parse(row.data));
  sql.close();
  return load(app, dump);
}

export async function sampleData(app) {
  const mem = createMemDB();
  sampleSeed(mem);
  return load(app, mem.dump());
}

export async function seedIfEmpty(app) {
  if (await app.db.count('settings')) return;
  const old = path.join(config.dataDir, 'zipi.db');
  if (fs.existsSync(old)) {
    const counts = await importSqlite(app, old);
    fs.renameSync(old, old + '.migrated');
    for (const f of ['zipi.db-wal', 'zipi.db-shm']) { const p = path.join(config.dataDir, f); if (fs.existsSync(p)) fs.renameSync(p, p + '.migrated'); }
    log.info('moved your existing data from SQLite into PostgreSQL', counts);
  } else {
    const counts = await sampleData(app);
    log.info('created sample data', counts);
  }
}

// Development only: sample stock for the newer grocery categories (stationery, fancy & gifts, frozen, drinks) so every
// category tile has something in it. Runs once; skipped when such items already exist.
export async function ensureDemoCatalog(app) {
  const { db, c } = app;
  if (await db.count('items', { category: 'stationery' })) return;
  const zone = c.zone('z-vijay') ? 'z-vijay' : c.zones().find(z => z.active)?.id; if (!zone) return;
  const now = Date.now(), mk = (vendorId, rows, extra = {}) => rows.map(([name, price, mrp, unit, category, stock, section]) => ({ id: c.newId('it'), vendorId, zoneId: zone, name, price, mrp, unit, category, section: section || category, stock, lowStockAt: 5, available: true, veg: null, bestseller: false, art: { stationery: 'pen', fancy: 'gift', frozen: 'ice', beverages: 'drink' }[category] || 'basket', createdAt: now, ...extra }));
  let owner = await db.one('users', { phone: '9100000051' });
  if (!owner) owner = await db.insert('users', { phone: '9100000051', name: 'Sunil Vidya', roles: ['customer', 'vendor'], addresses: [], createdAt: now });
  const shop = await db.insert('vendors', c.secureVendor({ userId: owner.id, type: 'store', storeCategory: 'general', name: 'Vidya Stationery & Gift Corner', ownerName: 'Sunil Vidya', phone: '9100000051', zoneId: zone, tags: ['Stationery', 'Gifts'],
    art: 'pen', color: '#6b3fa0', address: '14, Sector B, Vijay Nagar, Indore', prepMins: 8, rating: 4.5, ratingCount: 210, costForTwo: 0, offer: '', pureVeg: false, pan: 'ABCDE1234F', fssai: '', gst: '', upi: 'vidya@ybl',
    hours: '9 am to 9 pm', status: 'approved', online: true, commission: null, docs: [], onboardedBy: 'seed', loc: { x: 0.4, y: -0.3 }, createdAt: now }));
  await db.insertMany('items', mk(shop.id, [
    ['Classmate Notebook (172 pages)', 60, 65, '1 pc', 'stationery', 40, 'Notebooks'], ['Reynolds Ball Pens', 50, 50, 'Pack of 5', 'stationery', 60, 'Pens & pencils'], ['Apsara Pencils', 45, 50, 'Pack of 10', 'stationery', 50, 'Pens & pencils'],
    ['Fevicol MR', 25, 25, '50 g', 'stationery', 30, 'Office'], ['A4 Copier Paper', 299, 320, '500 sheets', 'stationery', 12, 'Office'], ['Geometry Box', 120, 135, '1 set', 'stationery', 15, 'School'],
    ['Highlighter Set', 99, 110, 'Pack of 4', 'stationery', 25, 'Office'], ['Birthday Greeting Card', 49, 49, '1 pc', 'fancy', 30, 'Cards'], ['Gift Wrapping Paper', 30, 30, '2 sheets', 'fancy', 40, 'Gift wrap'],
    ['Party Balloons', 99, 120, 'Pack of 25', 'fancy', 20, 'Party'], ['Scented Candles', 249, 299, 'Set of 3', 'fancy', 10, 'Decor'], ['Photo Frame 6x8', 199, 249, '1 pc', 'fancy', 8, 'Decor'],
    ['Soft Teddy Bear', 349, 449, '30 cm', 'fancy', 6, 'Toys'], ['Fancy Bangles Set', 149, 199, '12 pcs', 'fancy', 15, 'Accessories']]));
  const dairy = await db.one('vendors', { name: 'Gupta Dairy & Bakery' }), kirana = await db.one('vendors', { name: 'Sharma Kirana Store' });
  if (dairy) await db.insertMany('items', mk(dairy.id, [['Amul Vanilla Ice Cream', 110, 120, '750 ml', 'frozen', 12, 'Frozen'], ['McCain French Fries', 125, 135, '420 g', 'frozen', 10, 'Frozen'],
    ['Frozen Green Peas', 80, 90, '500 g', 'frozen', 15, 'Frozen'], ['Chicken Nuggets', 199, 225, '400 g', 'frozen', 8, 'Frozen'], ['Kulfi Sticks', 60, 60, 'Pack of 4', 'frozen', 20, 'Frozen']]));
  if (kirana) await db.insertMany('items', mk(kirana.id, [['Tata Tea Gold', 145, 150, '250 g', 'beverages', 20, 'Tea & coffee'], ['Nescafe Classic', 165, 175, '50 g', 'beverages', 15, 'Tea & coffee'],
    ['Real Mixed Fruit Juice', 110, 120, '1 L', 'beverages', 18, 'Juices'], ['Coca-Cola', 40, 40, '750 ml', 'beverages', 30, 'Soft drinks'], ['Bisleri Water', 20, 20, '1 L', 'beverages', 48, 'Water']]));
}
