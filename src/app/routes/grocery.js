// Grocery shopping by category: customers pick a category first (vegetables, snacks, frozen, stationery…) and see every item
// from nearby open shops that can deliver to them, instead of choosing a shop first like food.
import { str, fail } from '../context.js';
import { T, N, B } from '../../db/repo.js';
import { log } from '../../log.js';

// order = how tiles appear; words = how existing items are sorted automatically from their aisle and name
export const GROCERY_CATS = [
  ['vegetables', 'Vegetables', 'veg', ['vegetable', 'sabzi', 'onion', 'tomato', 'potato', 'coriander', 'greens', 'chilli']],
  ['fruits', 'Fruits', 'fruit', ['fruit', 'banana', 'apple', 'mango', 'orange', 'grapes', 'papaya']],
  ['dairy', 'Dairy, bread & eggs', 'dairy', ['milk', 'dairy', 'paneer', 'curd', 'butter', 'egg', 'bread', 'cheese', 'ghee']],
  ['staples', 'Atta, rice, dal & oil', 'basket', ['atta', 'rice', 'dal', 'flour', 'staple', 'grain', 'pulse', 'oil', 'salt', 'sugar', 'spice', 'masala', 'besan', 'basmati']],
  ['snacks', 'Snacks & biscuits', 'snack', ['snack', 'biscuit', 'chips', 'namkeen', 'noodle', 'maggi', 'chocolate', 'parle', 'cookie']],
  ['beverages', 'Drinks & juices', 'drink', ['drink', 'juice', 'tea', 'coffee', 'beverage', 'soda', 'cola', 'water bottle']],
  ['frozen', 'Frozen foods', 'ice', ['frozen', 'ice cream', 'icecream', 'kulfi', 'frozen peas', 'nuggets']],
  ['bakery', 'Bakery & sweets', 'cake', ['bakery', 'cake', 'pastry', 'rusk', 'sweet', 'mithai']],
  ['stationery', 'Stationery & office', 'pen', ['stationery', 'pen', 'pencil', 'notebook', 'note book', 'office', 'school', 'eraser', 'stapler', 'paper', 'marker']],
  ['fancy', 'Fancy & gift items', 'gift', ['fancy', 'gift', 'cosmetic', 'decor', 'toy', 'bangle', 'jewel', 'perfume', 'greeting card', 'balloon']],
  ['personal', 'Personal care', 'soap', ['personal', 'soap', 'shampoo', 'toothpaste', 'colgate', 'skin', 'cream', 'dettol', 'sanitary']],
  ['household', 'Cleaning & household', 'clean', ['household', 'cleaning', 'detergent', 'surf', 'vim', 'phenyl', 'mop', 'dishwash', 'broom']],
  ['medicines', 'Medicines & health', 'meds', ['fever', 'pain', 'first aid', 'medicine', 'health', 'ors', 'dolo', 'band-aid', 'tablet', 'syrup']],
  ['other', 'Other essentials', 'basket', []],
];
const KEYS = new Set(GROCERY_CATS.map(c => c[0]));
export const validCategory = k => KEYS.has(k);
export function categoryOf(item) {
  if (item.category && KEYS.has(item.category)) return item.category;
  const text = `${item.section || ''} ${item.name || ''}`.toLowerCase();
  // aisle name wins over item name (e.g. "Paneer Pizza" in a bakery aisle)
  for (const src of [String(item.section || '').toLowerCase(), text]) for (const [k, , , words] of GROCERY_CATS) if (words.some(w => src.includes(w))) return k;
  return 'other';
}

export default function grocery(route, c) {
  const { db } = c;
  // one-time: give every grocery item a category (runs in batches; safe to repeat)
  (async () => {
    try {
      let total = 0;
      for (;;) {
        const r = await db.q(`SELECT i.id, i.data FROM items i JOIN vendors v ON v.id = i.data->>'vendorId' WHERE v.data->>'type' = 'store' AND (i.data->'category' IS NULL OR i.data->>'category' = '') LIMIT 500`);
        if (!r.rows.length) break;
        for (const x of r.rows) await db.q(`UPDATE items SET data = data || jsonb_build_object('category', $2::text) WHERE id = $1`, [x.id, categoryOf(x.data)]);
        total += r.rows.length; if (r.rows.length < 500) break;
      }
      if (total) log.info('grocery items categorised', { total });
    } catch (err) { log.error('categorising items failed', { err }); }
  })();

  const deliverable = `i.data->>'zoneId' = $1 AND NOT COALESCE((i.data->>'hidden')::boolean,false) AND COALESCE((i.data->>'available')::boolean,false)
    AND (i.data->'stock' IS NULL OR i.data->'stock' = 'null'::jsonb OR (i.data->>'stock')::numeric > 0)
    AND v.data->>'type' = 'store' AND v.data->>'status' = 'approved' AND COALESCE((v.data->>'online')::boolean,false)`;

  // categories that have something deliverable to this zone right now, with item and shop counts
  route('GET', '/api/grocery/categories', null, async ({ query }) => {
    const zone = str(query.zone, 40); if (!zone || !c.zone(zone)) fail(400, 'Choose your area first');
    const r = await db.q(`SELECT i.data->>'category' AS k, count(*)::int AS items, count(DISTINCT i.data->>'vendorId')::int AS shops
      FROM items i JOIN vendors v ON v.id = i.data->>'vendorId' WHERE ${deliverable} GROUP BY 1`, [zone]);
    const by = new Map(r.rows.map(x => [x.k || 'other', x]));
    return GROCERY_CATS.map(([k, label, art]) => ({ k, label, art, items: by.get(k)?.items || 0, shops: by.get(k)?.shops || 0 }));
  });

  // items in a category from every open shop that delivers to the customer, with the shop's card (distance, ETA)
  route('GET', '/api/grocery/items', null, async ctx => {
    const q_ = ctx.query, zone = str(q_.zone, 40), cat = str(q_.category, 20), search = str(q_.q, 60).toLowerCase();
    if (!zone || !c.zone(zone)) fail(400, 'Choose your area first');
    if (cat && !KEYS.has(cat)) fail(400, 'Unknown category');
    const params = [zone], conds = [deliverable];
    if (cat) { params.push(cat); conds.push(`i.data->>'category' = $${params.length}`); }
    if (search.length >= 2) { params.push('%' + search.replace(/[%_\\]/g, m => '\\' + m) + '%'); conds.push(`(i.data->>'name' ILIKE $${params.length} OR i.data->>'section' ILIKE $${params.length})`); }
    if (q_.vendor) { params.push(str(q_.vendor, 40)); conds.push(`i.data->>'vendorId' = $${params.length}`); }
    const sort = { price: `(i.data->>'price')::numeric ASC`, priced: `(i.data->>'price')::numeric DESC`, discount: `COALESCE((i.data->>'mrp')::numeric - (i.data->>'price')::numeric, 0) DESC` }[q_.sort]
      || `COALESCE((i.data->>'bestseller')::boolean,false) DESC, (v.data->>'rating')::numeric DESC NULLS LAST, i.data->>'name'`;
    const r = await db.q(`SELECT i.data AS item, v.data AS shop FROM items i JOIN vendors v ON v.id = i.data->>'vendorId' WHERE ${conds.join(' AND ')} ORDER BY ${sort} LIMIT 300 OFFSET ${Math.max(0, +q_.offset || 0)}`, params);
    const a = ctx.user && q_.address && (ctx.user.addresses || []).find(x => x.id === q_.address);
    const shops = new Map(r.rows.map(x => [x.shop.id, x.shop]));
    const cards = new Map((await c.vendorCards([...shops.values()], a ? c.llOf(a.zoneId, a) : c.center(zone))).map(v => [v.id, v]));
    const items = r.rows.map(x => ({ ...c.itemView(x.item), category: categoryOf(x.item), vendor: cards.get(x.shop.id) }));
    // shops in this category, nearest first, for the filter chips
    const shopList = [...cards.values()].map(v => ({ id: v.id, name: v.name, eta: v.eta, dist: v.dist, count: items.filter(i => i.vendorId === v.id).length })).sort((x, y) => x.dist - y.dist);
    if (search.length >= 2 && !items.length) c.logEvent('search_miss', { q: search, zoneId: zone, userId: ctx.user?.id });
    return { items, shops: shopList };
  });
  void T; void N; void B;
}
