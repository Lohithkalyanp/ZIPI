// Shop and rider applications. PAN, Aadhaar digits, licence, RC and bank account are encrypted before they are saved.
import { fail, str, need, num, phoneOf, validPhone, RX, r2 } from '../context.js';

export function partnerFields(c) {
  function vendorFields(b) {
    need(b, [['type', 'Business type'], ['name', 'Business name'], ['ownerName', 'Owner name'], ['zoneId', 'Zone'], ['address', 'Shop address'], ['pan', 'PAN']]);
    if (!['restaurant', 'store'].includes(b.type)) fail(400, 'Business type must be restaurant or store');
    const z = c.zone(b.zoneId); if (!z || !z.active) fail(400, 'ZIPI is not live in that zone yet');
    const pan = str(b.pan, 10).toUpperCase(); if (!RX.pan.test(pan)) fail(400, 'PAN must look like ABCDE1234F');
    const fssai = str(b.fssai, 14).replace(/\D/g, ''), isPharma = b.type === 'store' && b.storeCategory === 'pharmacy';
    if (!isPharma && !RX.fssai.test(fssai)) fail(400, 'FSSAI registration must be 14 digits');
    if (isPharma && !str(b.drugLicense)) fail(400, 'Drug licence number is required for pharmacies');
    const gst = str(b.gst, 15).toUpperCase(); if (gst && !RX.gst.test(gst)) fail(400, 'GSTIN must be 15 characters, like 23ABCDE1234F1Z5');
    const upi = str(b.upi, 60), ifsc = str(b.ifsc, 11).toUpperCase(), acct = str(b.accountNo, 20).replace(/\s/g, '');
    if (!upi && !(acct && ifsc)) fail(400, 'Add a UPI ID or bank account for payouts');
    if (upi && !RX.upi.test(upi)) fail(400, 'UPI ID must look like name@bank');
    if (acct && !/^\d{9,18}$/.test(acct)) fail(400, 'Bank account number must be 9 to 18 digits');
    if (ifsc && !RX.ifsc.test(ifsc)) fail(400, 'IFSC must look like SBIN0001234');
    const contact = phoneOf(b.phone); if (b.phone && !validPhone(contact)) fail(400, 'Enter a valid shop phone number');
    const tags = (Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',')).map(t => str(t, 30)).filter(Boolean).slice(0, 5);
    let ll = {}, loc = { x: r2((Math.random() - .5) * 2.6), y: r2((Math.random() - .5) * 2.6) };
    if (b.lat !== undefined && b.lat !== '' && b.lng !== undefined && b.lng !== '') { ll = c.latLng(b, 'Shop location'); loc = c.fromLL(z.id, ll.lat, ll.lng); }
    return c.secureVendor({
      type: b.type, storeCategory: b.type === 'store' ? str(b.storeCategory, 20) || 'grocery' : null, name: str(b.name, 80), ownerName: str(b.ownerName, 60),
      phone: contact, zoneId: z.id, address: str(b.address, 160), landmark: str(b.landmark, 80), tags: tags.length ? tags : [b.type === 'store' ? 'Grocery' : 'Meals'],
      pan, fssai, gst, drugLicense: str(b.drugLicense, 40), upi, accountNo: acct, ifsc, hours: str(b.hours, 40) || '9 am to 10 pm', loc, ...ll,
      prepMins: Math.round(num(b.prepMins ?? (b.type === 'store' ? 8 : 20), 'Preparation time', 3, 90)), costForTwo: b.type === 'restaurant' ? Math.round(num(b.costForTwo || 300, 'Cost for two', 50, 5000)) : 0,
      pureVeg: !!b.pureVeg, docs: (Array.isArray(b.docs) ? b.docs : []).filter(d => d && /^\/uploads\//.test(d.url)).slice(0, 6).map(d => ({ label: str(d.label, 40), url: str(d.url, 120) })),
      art: b.type === 'store' ? (b.storeCategory === 'pharmacy' ? 'meds' : 'basket') : 'thali', color: ['#7a3b12', '#0b6e4f', '#8b1e3f', '#1d4e89', '#6b3fa0'][Math.floor(Math.random() * 5)],
    });
  }
  function riderFields(b) {
    need(b, [['name', 'Full name'], ['zoneId', 'Zone'], ['vehicle', 'Vehicle'], ['aadhaarLast4', 'Aadhaar last 4 digits'], ['pan', 'PAN']]);
    if (!['bike', 'scooter', 'ev', 'cycle'].includes(b.vehicle)) fail(400, 'Choose a vehicle');
    const z = c.zone(b.zoneId); if (!z || !z.active) fail(400, 'ZIPI is not live in that zone yet');
    if (!/^\d{4}$/.test(str(b.aadhaarLast4))) fail(400, 'Enter the last 4 digits of Aadhaar');
    const pan = str(b.pan, 10).toUpperCase(); if (!RX.pan.test(pan)) fail(400, 'PAN must look like ABCDE1234F');
    const motor = b.vehicle !== 'cycle';
    if (motor && str(b.dl).replace(/[\s-]/g, '').length < 10) fail(400, 'Enter your driving licence number');
    if (motor && !str(b.rc)) fail(400, 'Enter your vehicle RC number');
    const upi = str(b.upi, 60), ifsc = str(b.ifsc, 11).toUpperCase(), acct = str(b.accountNo, 20).replace(/\s/g, '');
    if (!upi && !(acct && ifsc)) fail(400, 'Add a UPI ID or bank account for payouts');
    if (upi && !RX.upi.test(upi)) fail(400, 'UPI ID must look like name@bank');
    if (ifsc && !RX.ifsc.test(ifsc)) fail(400, 'IFSC must look like SBIN0001234');
    const em = phoneOf(b.emergencyPhone); if (b.emergencyPhone && em.length !== 10) fail(400, 'Enter a valid emergency contact number');
    return c.secureRider({ name: str(b.name, 60), zoneId: z.id, vehicle: b.vehicle, dl: motor ? str(b.dl, 30).toUpperCase() : '', rc: motor ? str(b.rc, 20).toUpperCase() : '', aadhaarLast4: str(b.aadhaarLast4, 4), pan, upi, accountNo: acct, ifsc,
      shift: str(b.shift, 20) || 'evening', languages: str(b.languages, 60), emergencyPhone: em, emergencyName: str(b.emergencyName, 60),
      docs: (Array.isArray(b.docs) ? b.docs : []).filter(d => d && /^\/uploads\//.test(d.url)).slice(0, 6).map(d => ({ label: str(d.label, 40), url: str(d.url, 120) })) });
  }
  const newVendor = (user, f, extra, t = c.db) => t.insert('vendors', { ...f, userId: user.id, phone: f.phone || user.phone, status: 'pending', online: false, rating: 0, ratingCount: 0, commission: null, offer: '', createdAt: Date.now(), ...extra });
  const newRider = (user, f, extra, t = c.db) => t.insert('riders', { ...f, userId: user.id, phone: user.phone, status: 'pending', online: false, rating: 5, ratingCount: 0, cashInHand: 0, createdAt: Date.now(), ...extra });
  return { vendorFields, riderFields, newVendor, newRider };
}

export default function partners(route, c) {
  const { db } = c, P = partnerFields(c);
  c.partner = P;
  route('POST', '/api/partners/vendor/apply', 'any', async ({ user, body }) => {
    const ex = await c.vendorOf(user);
    if (ex && ex.status !== 'rejected') fail(409, `You already have a ${ex.status} application for ${ex.name}`);
    const f = P.vendorFields(body);
    if (ex) await db.remove('vendors', ex.id, { by: user.id });
    const v = await P.newVendor(user, f, { onboardedBy: 'self' });
    c.bus.emit({ type: 'application', zoneId: v.zoneId, users: [] });
    return { vendor: c.showVendor(v) };
  });
  route('POST', '/api/partners/rider/apply', 'any', async ({ user, body }) => {
    const ex = await c.riderOf(user);
    if (ex && ex.status !== 'rejected') fail(409, `You already have a ${ex.status} rider application`);
    const f = P.riderFields(body);
    if (ex) await db.remove('riders', ex.id, { by: user.id });
    const rd = await P.newRider(user, f, { onboardedBy: 'self' });
    c.bus.emit({ type: 'application', zoneId: rd.zoneId, users: [] });
    return { rider: c.showRider(rd) };
  });
}
