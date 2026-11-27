// Starter data: two live zones in Indore, sample shops, partners, two weeks of order history
// and research signals. Replace or delete through the admin console before launch.
import { newId } from './memdb.js';

const R = seed => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

export function seed(db, now = Date.now()) {
  const rnd = R(42), pick = a => a[Math.floor(rnd() * a.length)], DAY = 86400000;
  db.insert('settings', { id: 'main', baseFee: 20, perKmFee: 6, freeDeliveryAbove: 399, smallOrderBelow: 99, smallOrderFee: 15, platformFee: 5,
    riderBase: 20, riderPerKm: 6, acceptMins: 5, commission: { restaurant: 18, store: 10 } });
  const zones = [
    db.insert('zones', { id: 'z-vijay', name: 'Vijay Nagar', city: 'Indore', active: true, createdAt: now - 60 * DAY }),
    db.insert('zones', { id: 'z-palasia', name: 'Palasia', city: 'Indore', active: true, createdAt: now - 30 * DAY }),
    db.insert('zones', { id: 'z-bhawar', name: 'Bhawarkua', city: 'Indore', active: false, createdAt: now - 5 * DAY }),
  ];
  const user = (phone, name, roles, extra = {}) => db.insert('users', { phone, name, roles, addresses: [], createdAt: now - 40 * DAY, ...extra });
  const admin = user('9000000001', 'Anita Joshi', ['customer', 'admin']);
  user('9000000002', 'Vikram Rathore', ['customer', 'manager'], { zoneId: 'z-vijay' });
  user('9000000007', 'Sneha Kulkarni', ['customer', 'manager'], { zoneId: 'z-palasia' });
  const riya = user('9000000006', 'Riya Sharma', ['customer'], { addresses: [
    { id: 'a-riya1', label: 'Home', line: 'Flat 302, Shubh Residency, Scheme 54', area: 'Vijay Nagar', landmark: 'Near C21 Mall', zoneId: 'z-vijay', loc: { x: .3, y: -.2 } },
    { id: 'a-riya2', label: 'Work', line: '5th floor, Brilliant Titanium', area: 'Palasia', landmark: 'AB Road', zoneId: 'z-palasia', loc: { x: -.4, y: .5 } }] });

  const V = [
    ['9000000003', 'Arif Khan', 'z-vijay', 'restaurant', 'Saffron Biryani House', ['Biryani', 'Mughlai'], 'biryani', '#7a3b12', 22, 4.4, 1240, 450, '₹100 OFF above ₹499', false, [
      ['Chicken Dum Biryani', 289, 'Biryani', false, 1, 'Slow-cooked with saffron rice and salan'], ['Hyderabadi Veg Biryani', 219, 'Biryani', true, 0, 'Seasonal vegetables, mint and fried onion'],
      ['Mutton Biryani', 379, 'Biryani', false, 0, 'Tender mutton, long-grain basmati'], ['Paneer Tikka', 249, 'Starters', true, 1, 'Tandoor-grilled cottage cheese'],
      ['Chicken 65', 229, 'Starters', false, 0, 'Spicy fried chicken with curry leaves'], ['Mirchi ka Salan', 79, 'Sides', true, 0, ''], ['Burani Raita', 49, 'Sides', true, 0, ''], ['Double ka Meetha', 99, 'Desserts', true, 0, 'Bread pudding with dry fruits']]],
    ['9100000011', 'Mahesh Patidar', 'z-vijay', 'restaurant', 'Malwa Thali Kitchen', ['Thali', 'North Indian'], 'thali', '#b5531a', 18, 4.6, 860, 300, 'Free delivery', true, [
      ['Malwa Special Thali', 199, 'Thalis', true, 1, 'Dal bafla, 2 sabzi, kadhi, rice, salad, sweet'], ['Mini Thali', 129, 'Thalis', true, 0, '2 sabzi, dal, 4 roti, rice'],
      ['Dal Bafla', 169, 'Malwa specials', true, 1, 'Baked wheat balls with ghee and dal'], ['Sev Tamatar', 139, 'Malwa specials', true, 0, 'Indori sev in tomato gravy'],
      ['Paneer Butter Masala', 189, 'Curries', true, 0, ''], ['Butter Roti', 20, 'Breads', true, 0, ''], ['Garlic Naan', 45, 'Breads', true, 0, ''], ['Gulab Jamun (2)', 59, 'Desserts', true, 0, '']]],
    ['9100000012', 'Ramesh Jain', 'z-vijay', 'restaurant', 'Poha Jalebi Corner', ['Breakfast', 'Snacks'], 'poha', '#d9861c', 8, 4.7, 2310, 120, '', true, [
      ['Indori Poha', 30, 'Breakfast', true, 1, 'With sev, jeeravan and pomegranate'], ['Hot Jalebi (100 g)', 40, 'Sweets', true, 1, ''], ['Samosa (2)', 30, 'Snacks', true, 0, ''],
      ['Khasta Kachori', 25, 'Snacks', true, 0, ''], ['Khaman', 50, 'Snacks', true, 0, ''], ['Masala Chai', 15, 'Drinks', true, 0, '']]],
    ['9100000013', 'Neha Soni', 'z-vijay', 'restaurant', 'Slice Theory Pizza', ['Pizza', 'Italian'], 'pizza', '#a3201c', 20, 4.2, 640, 500, '50% OFF up to ₹100', false, [
      ['Margherita', 199, 'Pizzas', true, 0, 'Classic tomato and mozzarella'], ['Farmhouse', 299, 'Pizzas', true, 1, 'Capsicum, onion, tomato, mushroom'], ['Paneer Makhani Pizza', 319, 'Pizzas', true, 0, ''],
      ['Chicken Pepperoni', 349, 'Pizzas', false, 1, ''], ['Cheesy Garlic Bread', 129, 'Sides', true, 0, ''], ['Choco Lava Cake', 99, 'Desserts', true, 0, '']]],
    ['9100000014', 'Suresh Iyer', 'z-vijay', 'restaurant', 'Dosa Junction', ['South Indian'], 'dosa', '#8a6d1a', 15, 4.5, 920, 250, '', true, [
      ['Masala Dosa', 120, 'Dosas', true, 1, 'Crisp dosa, potato masala, chutneys'], ['Mysore Masala Dosa', 140, 'Dosas', true, 0, ''], ['Idli Vada', 90, 'Classics', true, 0, ''],
      ['Onion Uttapam', 130, 'Classics', true, 0, ''], ['Filter Coffee', 40, 'Drinks', true, 0, '']]],
    ['9100000015', 'Kabir Mehta', 'z-vijay', 'restaurant', 'Burger Garage', ['Burgers', 'Fast food'], 'burger', '#c2410c', 15, 4.1, 410, 350, 'Buy 1 Get 1 on Tuesdays', false, [
      ['Classic Veg Burger', 99, 'Burgers', true, 0, ''], ['Crispy Chicken Burger', 149, 'Burgers', false, 1, ''], ['Peri Peri Fries', 99, 'Sides', true, 0, ''], ['Cold Coffee', 119, 'Drinks', true, 0, '']]],
    ['9100000016', 'Pooja Agrawal', 'z-vijay', 'restaurant', 'Cake Studio', ['Desserts', 'Bakery'], 'cake', '#9d174d', 25, 4.5, 380, 400, '', true, [
      ['Chocolate Truffle (500 g)', 549, 'Cakes', true, 1, ''], ['Red Velvet Slice', 129, 'Pastries', true, 0, ''], ['Walnut Brownie', 79, 'Pastries', true, 0, ''], ['Blueberry Cheesecake', 189, 'Pastries', true, 0, '']]],
    ['9000000004', 'Rajesh Sharma', 'z-vijay', 'store', 'Sharma Kirana Store', ['Staples', 'Snacks', 'Household'], 'basket', '#0b6e4f', 8, 4.6, 540, 0, 'Free delivery above ₹299', false, [
      ['Aashirvaad Atta', 279, 'Atta, rice & dal', null, 1, '', '5 kg', 290, 18], ['Tata Salt', 28, 'Atta, rice & dal', null, 0, '', '1 kg', 28, 40], ['Toor Dal', 155, 'Atta, rice & dal', null, 0, '', '1 kg', 160, 4],
      ['India Gate Basmati', 135, 'Atta, rice & dal', null, 0, '', '1 kg', 140, 12], ['Fortune Sunflower Oil', 160, 'Oil & ghee', null, 1, '', '1 L', 165, 9], ['Amul Ghee', 299, 'Oil & ghee', null, 0, '', '500 ml', 315, 3],
      ['Parle-G', 25, 'Snacks', null, 0, '', '250 g', 25, 60], ['Maggi Noodles', 56, 'Snacks', null, 1, '', '4 pack', 56, 30], ['Surf Excel', 135, 'Household', null, 0, '', '1 kg', 140, 2], ['Vim Bar', 20, 'Household', null, 0, '', '200 g', 20, 0]]],
    ['9100000017', 'Kailash Kushwah', 'z-vijay', 'store', 'Fresh Sabzi Corner', ['Fruits & veg'], 'veg', '#2f9e55', 6, 4.5, 470, 0, '', true, [
      ['Onion', 35, 'Vegetables', null, 1, '', '1 kg', 40, 50], ['Tomato', 32, 'Vegetables', null, 1, '', '1 kg', 36, 40], ['Potato', 28, 'Vegetables', null, 0, '', '1 kg', 30, 60],
      ['Coriander', 10, 'Vegetables', null, 0, '', '1 bunch', 10, 3], ['Banana', 55, 'Fruits', null, 0, '', '1 dozen', 60, 20], ['Apple Shimla', 160, 'Fruits', null, 0, '', '1 kg', 180, 8]]],
    ['9100000018', 'Anil Gupta', 'z-vijay', 'store', 'Gupta Dairy & Bakery', ['Dairy', 'Bakery'], 'dairy', '#1d4e89', 6, 4.7, 690, 0, '', true, [
      ['Amul Taaza Milk', 28, 'Milk', null, 1, '', '500 ml', 28, 80], ['Fresh Paneer', 85, 'Dairy', null, 1, '', '200 g', 90, 12], ['Amul Butter', 57, 'Dairy', null, 0, '', '100 g', 58, 15],
      ['Curd', 35, 'Dairy', null, 0, '', '400 g', 35, 4], ['Brown Bread', 45, 'Bakery', null, 0, '', '400 g', 50, 10], ['Eggs', 46, 'Dairy', null, 0, '', '6 pcs', 48, 24]]],
    ['9100000019', 'Dr. Meena Verma', 'z-vijay', 'store', 'Shree Medicals', ['Medicines', 'Personal care'], 'meds', '#b91c1c', 6, 4.4, 210, 0, '', false, [
      ['Dolo 650', 30, 'Fever & pain', null, 1, '', '15 tablets', 32, 20], ['ORS Sachets', 80, 'Fever & pain', null, 0, '', '4 pcs', 84, 15], ['Dettol Soap', 155, 'Personal care', null, 0, '', '4 x 75 g', 160, 10],
      ['Colgate Toothpaste', 105, 'Personal care', null, 0, '', '200 g', 110, 2], ['Band-aid Strips', 48, 'First aid', null, 0, '', '20 pcs', 50, 12]], 'pharmacy'],
    ['9100000021', 'Harish Malviya', 'z-palasia', 'restaurant', 'Palasia Chaat Bhandar', ['Chaat', 'Snacks'], 'poha', '#b45309', 10, 4.5, 730, 150, '', true, [
      ['Pani Puri', 40, 'Chaat', true, 1, ''], ['Dahi Puri', 60, 'Chaat', true, 0, ''], ['Bhutte ka Kees', 70, 'Indori specials', true, 1, ''], ['Garadu', 80, 'Indori specials', true, 0, '']]],
    ['9100000022', 'Li Wen', 'z-palasia', 'restaurant', 'Wok Street', ['Chinese', 'Momos'], 'noodles', '#991b1b', 18, 4.3, 520, 350, '20% OFF', false, [
      ['Veg Hakka Noodles', 159, 'Noodles', true, 1, ''], ['Chicken Momos (8)', 149, 'Momos', false, 1, ''], ['Veg Momos (8)', 119, 'Momos', true, 0, ''], ['Chilli Paneer', 199, 'Starters', true, 0, '']]],
    ['9100000023', 'Sunita Bansal', 'z-palasia', 'store', 'Daily Needs Mart', ['Staples', 'Dairy'], 'basket', '#065f46', 8, 4.4, 300, 0, '', false, [
      ['Aashirvaad Atta', 282, 'Staples', null, 1, '', '5 kg', 290, 10], ['Amul Taaza Milk', 28, 'Dairy', null, 1, '', '500 ml', 28, 40], ['Maggi Noodles', 56, 'Snacks', null, 0, '', '4 pack', 56, 20]]],
  ];
  const vendors = [];
  for (const [phone, owner, zoneId, type, name, tags, art, color, prep, rating, rc, cft, offer, pureVeg, items, storeCategory] of V) {
    const u = db.find('users', x => x.phone === phone) || user(phone, owner, ['customer', 'vendor']);
    if (!u.roles.includes('vendor')) db.update('users', u.id, { roles: [...u.roles, 'vendor'] });
    const v = db.insert('vendors', { userId: u.id, type, storeCategory: storeCategory || (type === 'store' ? 'grocery' : null), name, ownerName: owner, phone, zoneId, tags, art, color,
      address: `${name.split(' ')[0]} lane, ${zoneId === 'z-vijay' ? 'Vijay Nagar' : 'Palasia'}, Indore`, prepMins: prep, rating, ratingCount: rc, costForTwo: cft, offer, pureVeg,
      pan: 'ABCDE1234F', fssai: storeCategory === 'pharmacy' ? '' : '21423010001234', drugLicense: storeCategory === 'pharmacy' ? 'MP/IND/20B/4410' : '', gst: '', upi: name.split(' ')[0].toLowerCase() + '@ybl',
      hours: type === 'store' ? '7 am to 10 pm' : '11 am to 11 pm', status: 'approved', online: name !== 'Burger Garage', commission: null, docs: [], onboardedBy: 'seed',
      loc: { x: Math.round((rnd() - .5) * 260) / 100, y: Math.round((rnd() - .5) * 260) / 100 }, createdAt: now - 35 * DAY });
    vendors.push(v);
    for (const [n, p, section, veg, best, desc, unit, mrp, stock] of items)
      db.insert('items', { vendorId: v.id, name: n, price: p, section, veg, bestseller: !!best, desc: desc || '', unit: unit || '', mrp: mrp || null, stock: stock ?? null, lowStockAt: 5,
        available: !(type === 'restaurant' && n === 'Mutton Biryani'), art: artFor(n, art), createdAt: now - 35 * DAY });
  }
  // pending applications (they show up in the manager console)
  const pv = user('9100000031', 'Tenzin Dorje', ['customer']);
  db.insert('vendors', { userId: pv.id, type: 'restaurant', name: 'Momo Hut', ownerName: 'Tenzin Dorje', phone: pv.phone, zoneId: 'z-vijay', tags: ['Momos', 'Tibetan'], art: 'noodles', color: '#7c2d12',
    address: 'Shop 4, Scheme 74, Vijay Nagar', prepMins: 15, rating: 0, ratingCount: 0, costForTwo: 250, offer: '', pureVeg: false, pan: 'BQRPD4521K', fssai: '21423010009876', gst: '', upi: 'momohut@okaxis',
    hours: '12 pm to 11 pm', status: 'pending', online: false, docs: [], onboardedBy: 'self', loc: { x: .8, y: .6 }, createdAt: now - 2 * 3600000 });
  const pv2 = user('9100000032', 'Rakesh Agrawal', ['customer']);
  db.insert('vendors', { userId: pv2.id, type: 'store', storeCategory: 'grocery', name: 'Agrawal Provision', ownerName: 'Rakesh Agrawal', phone: pv2.phone, zoneId: 'z-vijay', tags: ['Staples', 'Dry fruits'], art: 'basket', color: '#14532d',
    address: '22, Sector C, Vijay Nagar', prepMins: 8, rating: 0, ratingCount: 0, costForTwo: 0, offer: '', pan: 'CKLPA7781M', fssai: '21423010004567', gst: '23CKLPA7781M1Z2', upi: '', accountNo: '50100234567812', ifsc: 'HDFC0001234',
    hours: '8 am to 9 pm', status: 'pending', online: false, docs: [], onboardedBy: 'self', loc: { x: -.9, y: .3 }, createdAt: now - 26 * 3600000 });

  const RD = [['9000000005', 'Ravi Kumar', 'z-vijay', 'ev', 'approved', true], ['9100000041', 'Imran Sheikh', 'z-vijay', 'bike', 'approved', true], ['9100000042', 'Pooja Rathore', 'z-vijay', 'scooter', 'approved', false],
    ['9100000043', 'Arjun Yadav', 'z-palasia', 'bike', 'approved', true], ['9100000044', 'Sunil Yadav', 'z-vijay', 'bike', 'pending', false], ['9100000045', 'Aman Khan', 'z-vijay', 'cycle', 'pending', false]];
  const riders = [];
  for (const [phone, name, zoneId, vehicle, status, online] of RD) {
    const u = user(phone, name, status === 'approved' ? ['customer', 'rider'] : ['customer']);
    riders.push(db.insert('riders', { userId: u.id, name, phone, zoneId, vehicle, dl: vehicle === 'cycle' ? '' : 'MP09 2019 00' + phone.slice(-5), rc: vehicle === 'cycle' ? '' : 'MP09 AB ' + phone.slice(-4),
      aadhaarLast4: phone.slice(-4), pan: 'ABCPY1234D', upi: name.split(' ')[0].toLowerCase() + '@okaxis', shift: pick(['morning', 'evening', 'full']), languages: 'Hindi, English',
      status, online, rating: 4.6 + Math.round(rnd() * 4) / 10, ratingCount: 40, cashInHand: 0, docs: [], onboardedBy: 'seed', createdAt: now - (status === 'pending' ? 1 : 30) * DAY }));
  }

  db.insert('coupons', { code: 'WELCOME50', type: 'pct', value: 50, maxDiscount: 100, minOrder: 149, firstOrderOnly: true, vendorType: null, title: '50% off your first order', desc: 'Up to ₹100 on orders above ₹149', active: true, createdAt: now - 30 * DAY });
  db.insert('coupons', { code: 'ZIPIFREE', type: 'freedel', value: 0, maxDiscount: null, minOrder: 199, firstOrderOnly: false, vendorType: null, title: 'Free delivery', desc: 'On orders above ₹199', active: true, createdAt: now - 30 * DAY });
  db.insert('coupons', { code: 'FEAST100', type: 'flat', value: 100, maxDiscount: null, minOrder: 499, firstOrderOnly: false, vendorType: 'restaurant', title: '₹100 off big meals', desc: 'Food orders above ₹499', active: true, createdAt: now - 30 * DAY });
  db.insert('coupons', { code: 'KIRANA40', type: 'flat', value: 40, maxDiscount: null, minOrder: 299, firstOrderOnly: false, vendorType: 'store', title: '₹40 off groceries', desc: 'Grocery orders above ₹299', active: true, createdAt: now - 20 * DAY });

  // two weeks of history
  const customers = [riya];
  const first = ['Aditi', 'Rohan', 'Kavya', 'Manish', 'Sana', 'Yash', 'Priya', 'Nikhil', 'Isha', 'Varun', 'Megha', 'Tarun', 'Ankita', 'Harsh', 'Divya'];
  for (let i = 0; i < 230; i++) {
    const z = rnd() < .75 ? 'z-vijay' : 'z-palasia';
    customers.push(user('98' + String(26000000 + i * 1373).padStart(8, '0'), `${pick(first)} ${pick(['Jain', 'Patel', 'Verma', 'Soni', 'Dubey', 'Mishra', 'Chouhan'])}`, ['customer'], {
      createdAt: now - Math.floor(rnd() * 14) * DAY, addresses: [{ id: newId('a'), label: 'Home', line: `House ${10 + i}, Street ${1 + (i % 9)}`, area: z === 'z-vijay' ? 'Vijay Nagar' : 'Palasia', landmark: '', zoneId: z, loc: { x: Math.round((rnd() - .5) * 240) / 100, y: Math.round((rnd() - .5) * 240) / 100 } }] }));
  }
  const s = db.get('settings', 'main'), hourW = [0, 0, 0, 0, 0, 0, 1, 3, 6, 6, 4, 3, 5, 7, 5, 3, 3, 4, 6, 9, 10, 8, 5, 2];
  const pickHour = () => { const tot = hourW.reduce((a, b) => a + b, 0); let x = rnd() * tot; for (let h = 0; h < 24; h++) { x -= hourW[h]; if (x <= 0) return h; } return 20; };
  let code = 1001; const allItems = db.list('items');
  const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  for (let d = 13; d >= 0; d--) {
    const n = 14 + Math.floor((13 - d) * 1.6 + rnd() * 6);
    for (let k = 0; k < n; k++) {
      const c = pick(customers), a = c.addresses[0]; if (!a) continue;
      const vs = vendors.filter(v => v.zoneId === a.zoneId); const v = rnd() < .62 ? pick(vs.filter(x => x.type === 'restaurant')) : pick(vs.filter(x => x.type === 'store'));
      const its = allItems.filter(i => i.vendorId === v.id && i.available); const lines = []; const cnt = 1 + Math.floor(rnd() * (v.type === 'store' ? 4 : 3));
      for (let j = 0; j < cnt; j++) { const it = pick(its); const ex = lines.find(l => l.itemId === it.id); if (ex) ex.qty++; else lines.push({ itemId: it.id, name: it.name, price: it.price, qty: 1, veg: it.veg }); }
      const at = t0.getTime() - d * DAY + pickHour() * 3600000 + Math.floor(rnd() * 3600000); if (at > now - 20 * 60000) continue;
      const sub = lines.reduce((x, l) => x + l.price * l.qty, 0), dist = Math.round(Math.hypot(v.loc.x - a.loc.x, v.loc.y - a.loc.y) * 10) / 10;
      const fee = sub >= s.freeDeliveryAbove ? 0 : Math.round(s.baseFee + s.perKmFee * Math.max(0, dist - 2)), small = sub < s.smallOrderBelow ? s.smallOrderFee : 0;
      const coupon = rnd() < .18 ? (v.type === 'store' ? (sub >= 299 ? 'KIRANA40' : null) : sub >= 499 ? 'FEAST100' : sub >= 199 ? 'ZIPIFREE' : null) : null;
      const disc = coupon === 'KIRANA40' ? 40 : coupon === 'FEAST100' ? 100 : coupon === 'ZIPIFREE' ? fee : 0;
      const roll = rnd(), status = roll < .9 ? 'delivered' : roll < .95 ? 'cancelled' : 'rejected';
      const rider = status === 'delivered' ? pick(riders.filter(r => r.zoneId === v.zoneId && r.status === 'approved')) : null;
      const pay = rnd() < .58 ? 'UPI' : 'COD', comm = Math.round(sub * s.commission[v.type]) / 100, rp = Math.round(s.riderBase + s.riderPerKm * dist);
      const tl = [{ status: 'placed', at }]; if (status === 'delivered') tl.push({ status: 'accepted', at: at + 60000 }, { status: 'ready', at: at + v.prepMins * 60000 }, { status: 'picked', at: at + (v.prepMins + 3) * 60000 }, { status: 'delivered', at: at + (v.prepMins + 10 + dist * 4) * 60000 });
      else tl.push({ status, at: at + 4 * 60000 });
      const rating = status === 'delivered' && rnd() < .55 ? (rnd() < .7 ? 5 : rnd() < .7 ? 4 : 3) : null;
      db.insert('orders', { code: 'ZP' + code++, customerId: c.id, vendorId: v.id, zoneId: v.zoneId, vendorType: v.type, items: lines, subtotal: sub, deliveryFee: fee, smallOrderFee: small, platformFee: s.platformFee,
        discount: disc, coupon, total: sub + fee + small + s.platformFee - disc, payment: pay, paid: status === 'delivered' || pay === 'UPI', note: '', address: a, dist, eta: Math.round(v.prepMins + 6 + dist * 4),
        riderPay: rp, commission: comm, vendorNet: Math.round((sub - comm) * 100) / 100, otp: '0000', status, riderId: rider?.id || null, timeline: tl, createdAt: at, rating,
        cancelReason: status === 'cancelled' ? 'Shop did not respond in time' : status === 'rejected' ? 'Item out of stock' : undefined });
    }
  }
  // payouts settled up to 3 days ago
  for (const v of vendors) { const due = db.list('orders', o => o.vendorId === v.id && o.status === 'delivered' && o.createdAt < now - 3 * DAY).reduce((a, o) => a + o.vendorNet, 0); if (due > 0) db.insert('payouts', { partyType: 'vendor', partyId: v.id, name: v.name, amount: Math.round(due), ref: 'Weekly settlement', by: admin.id, at: now - 3 * DAY }); }
  for (const r of riders) { const due = db.list('orders', o => o.riderId === r.id && o.status === 'delivered' && o.createdAt < now - 2 * DAY).reduce((a, o) => a + o.riderPay, 0); if (due > 0) db.insert('payouts', { partyType: 'rider', partyId: r.id, name: r.name, amount: due, ref: 'Weekly payout', by: admin.id, at: now - 2 * DAY }); }
  for (const r of riders.filter(r => r.status === 'approved')) { const cash = db.list('orders', o => o.riderId === r.id && o.payment === 'COD' && o.createdAt > t0.getTime()).reduce((a, o) => a + o.total, 0); db.update('riders', r.id, { cashInHand: cash }); }

  // research signals
  const ev = (type, q, zoneId, n, extra = {}) => { for (let i = 0; i < n; i++) db.insert('events', { type, q, zoneId, at: now - Math.floor(rnd() * 14 * DAY), userId: pick(customers).id, ...extra }); };
  [['biryani', 46], ['pizza', 31], ['milk', 27], ['poha', 22], ['paneer', 19], ['thali', 17], ['cake', 12], ['atta', 11], ['dosa', 10]].forEach(([q, n]) => ev('search', q, 'z-vijay', n));
  [['momos', 29], ['shawarma', 17], ['ice cream', 14], ['chinese', 11], ['fish', 8], ['late night', 6], ['tiffin', 6]].forEach(([q, n]) => ev('search_miss', q, 'z-vijay', n));
  [['chaat', 14], ['momos', 9], ['noodles', 7]].forEach(([q, n]) => ev('search', q, 'z-palasia', n));
  [['pizza', 12], ['biryani', 10], ['medicine', 5]].forEach(([q, n]) => ev('search_miss', q, 'z-palasia', n));
  ev('app_open', null, 'z-vijay', 1150); ev('view_vendor', null, 'z-vijay', 820); ev('add_cart', null, 'z-vijay', 560); ev('checkout', null, 'z-vijay', 410);
  ev('app_open', null, 'z-palasia', 300); ev('view_vendor', null, 'z-palasia', 210); ev('add_cart', null, 'z-palasia', 160); ev('checkout', null, 'z-palasia', 120);
  [['Bhawarkua', 41], ['Nipania', 27], ['Rau', 19], ['Sudama Nagar', 15], ['Rajendra Nagar', 9]].forEach(([area, n]) => { for (let i = 0; i < n; i++) db.insert('waitlist', { phone: '97' + String(Math.floor(rnd() * 1e8)).padStart(8, '0'), area, city: 'Indore', want: pick(['Food', 'Groceries', 'Both']), at: now - Math.floor(rnd() * 20 * DAY) }); });
  const wishes = ['Momos and Chinese from Vijay Nagar', 'Delivery after 11 pm', 'Fresh chicken and fish', 'Medicines at night', 'Ice cream in summer', 'Monthly tiffin plan', 'Faster grocery, under 15 min', 'More pure veg options', 'Bakery items in the morning', 'Combo offers for families'];
  for (let i = 0; i < 64; i++) { const nps = Math.min(10, Math.max(2, Math.round(8 + (rnd() - .4) * 5))); db.insert('feedback', { orderId: null, userId: pick(customers).id, zoneId: rnd() < .8 ? 'z-vijay' : 'z-palasia', nps, wish: rnd() < .45 ? pick(wishes) : '', at: now - Math.floor(rnd() * 14 * DAY) }); }
}

function artFor(name, fallback) {
  const n = name.toLowerCase();
  const map = [['biryani', 'biryani'], ['pizza', 'pizza'], ['margherita', 'pizza'], ['farmhouse', 'pizza'], ['pepperoni', 'pizza'], ['burger', 'burger'], ['fries', 'burger'], ['thali', 'thali'], ['dosa', 'dosa'], ['uttapam', 'dosa'], ['idli', 'dosa'],
    ['noodles', 'noodles'], ['momos', 'noodles'], ['cake', 'cake'], ['brownie', 'cake'], ['velvet', 'cake'], ['cheesecake', 'cake'], ['jamun', 'cake'], ['meetha', 'cake'], ['chai', 'chai'], ['coffee', 'chai'],
    ['poha', 'poha'], ['jalebi', 'poha'], ['samosa', 'poha'], ['kachori', 'poha'], ['milk', 'dairy'], ['paneer', fallback === 'dairy' ? 'dairy' : 'thali'], ['butter', fallback === 'dairy' ? 'dairy' : 'thali'], ['curd', 'dairy'], ['eggs', 'dairy'], ['bread', 'dairy'],
    ['onion', 'veg'], ['tomato', 'veg'], ['potato', 'veg'], ['coriander', 'veg'], ['banana', 'veg'], ['apple', 'veg']];
  for (const [k, a] of map) if (n.includes(k)) return a;
  return fallback;
}
