// App-wide state, local storage, route registry and cart.
import { api } from './api.js';

export const store = {
  get(k, d) { try { const v = localStorage.getItem('zipi.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('zipi.' + k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem('zipi.' + k); } catch { } },
};
/* ---------- which app is this? Each one lives at its own address with its own login ---------- */
const PATH = location.pathname.replace(/\/+$/, '');
export const APP = /^\/shop(\/|$)/.test(PATH) ? 'vendor' : /^\/rider(\/|$)/.test(PATH) ? 'rider' : /^\/manager(\/|$)/.test(PATH) ? 'manager' : /^\/admin(\/|$)/.test(PATH) ? 'admin' : 'customer';
export const APPS = {
  customer: { name: 'ZIPI', title: 'ZIPI', base: '/', home: '/', icon: 'bag', tag: 'Food and groceries from your neighbourhood' },
  vendor: { name: 'Shop console', title: 'ZIPI Shop', base: '/shop', home: '/vendor', icon: 'store', tag: 'For restaurant and shop owners on ZIPI' },
  rider: { name: 'Rider app', title: 'ZIPI Rider', base: '/rider', home: '/rider', icon: 'bike', tag: 'For ZIPI delivery partners' },
  manager: { name: 'Zone manager', title: 'ZIPI Manager', base: '/manager', home: '/manage', icon: 'map', tag: 'For ZIPI zone managers' },
  admin: { name: 'Admin console', title: 'ZIPI Admin', base: '/admin', home: '/admin', icon: 'shield', tag: 'ZIPI head office control centre' },
};
export const SESSION_KEY = 'session.' + APP;
// one-time move of the old shared login (customer app only; staff must log in again in their own app)
try { if (APP === 'customer' && localStorage.getItem('zipi.session') && !localStorage.getItem('zipi.session.customer')) localStorage.setItem('zipi.session.customer', localStorage.getItem('zipi.session')); localStorage.removeItem('zipi.session'); } catch { }

export const S = { me: null, zones: [], config: null, zoneId: store.get('zone', null), addressId: store.get('addr', null), mode: 'web', after: null, live: null };
export const user = () => S.me?.user || null;

/* ---------- appearance: system / light / dark ---------- */
export function applyTheme(t = store.get('theme', 'system')) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0b120e' : '#0c3b26');
}
export function setTheme(t) { store.set('theme', t); applyTheme(t); }
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

/* ---------- notifications (shown by the service worker when the app is in the background) ---------- */
export const notifyOn = () => store.get('notify', false) && typeof Notification !== 'undefined' && Notification.permission === 'granted';
export async function notify(title, body, url = '/') {
  if (!notifyOn()) return;
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) return reg.showNotification(title, { body, icon: '/icon.svg', badge: '/icon.svg', data: { url }, tag: url }); new Notification(title, { body, icon: '/icon.svg' }); } catch { }
}
export const hasRole = r => !!S.me?.user?.roles?.includes(r);

export const routes = [];
export const sections = {};
export function route(pattern, view, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ pattern, re, keys, view, ...opts });
}
export function section(name, cfg) { sections[name] = cfg; }
let navImpl = () => {}, backImpl = () => {};
export const setNav = (n, b) => { navImpl = n; backImpl = b; };
export const nav = (p, o) => navImpl(p, o);
export const back = f => backImpl(f);
export const live = fn => { S.live = fn; };

export async function refreshMe() {
  if (!api.mode) return null;
  try { S.me = await api.get('/api/me'); } catch (e) { if (e.status === 401 || e.status === 403) { S.me = null; store.del(SESSION_KEY); api.setToken(null); } }
  return S.me;
}
export function setSession(token, me) { store.set(SESSION_KEY, token); api.setToken(token); S.me = me; }
export function logout() { store.del(SESSION_KEY); api.setToken(null); S.me = null; }
export const permit = p => !p || APP !== 'admin' || (S.me?.user?.perms || []).includes('*') || (S.me?.user?.perms || []).includes(p);

/* ---------- cart: food from one restaurant; groceries can mix up to 6 shops (one checkout, ZIPI plans the riders) ---------- */
export const MAX_SHOPS = 6;
const EMPTY = () => ({ vendorId: null, vendor: null, shops: {}, lines: {}, coupon: '', note: '', notes: {} });
let cart = Object.assign(EMPTY(), store.get('cart', {}));
if (cart.vendorId && !Object.keys(cart.shops).length) { cart.shops = { [cart.vendorId]: cart.vendor }; for (const l of Object.values(cart.lines)) l.vendorId ||= cart.vendorId; }
const subs = new Set();
export const getCart = () => cart;
export const onCart = f => { subs.add(f); return () => subs.delete(f); };
const saveCart = () => { store.set('cart', cart); subs.forEach(f => f(cart)); };
export const cartCount = () => Object.values(cart.lines).reduce((a, l) => a + l.qty, 0);
export const cartTotal = () => Object.values(cart.lines).reduce((a, l) => a + l.qty * l.price, 0);
export const cartShops = () => Object.values(cart.shops);
export const qtyOf = id => cart.lines[id]?.qty || 0;
const shopInfo = v => ({ id: v.id, name: v.name, art: v.art, color: v.color, type: v.type, image: v.image || '', zoneId: v.zoneId });
// returns true, or a reason string when this item cannot join the cart ('other-restaurant' | 'mixed' | 'too-many')
export function canAdd(vendor) {
  if (!cart.vendorId || cart.shops[vendor.id]) return true;
  if (vendor.type !== 'store' || cart.vendor.type !== 'store') return cart.vendor.type === 'store' && vendor.type === 'store' ? true : cart.vendor.type === 'store' || vendor.type === 'store' ? 'mixed' : 'other-restaurant';
  return Object.keys(cart.shops).length >= MAX_SHOPS ? 'too-many' : true;
}
export function setQty(vendor, item, qty) {
  if (qty > 0 && canAdd(vendor) !== true) return false;
  if (qty > 0 && !cart.shops[vendor.id]) { cart.shops[vendor.id] = shopInfo(vendor); if (!cart.vendorId) { cart.vendorId = vendor.id; cart.vendor = cart.shops[vendor.id]; } }
  if (qty <= 0) delete cart.lines[item.id];
  else cart.lines[item.id] = { id: item.id, name: item.name, price: item.price, veg: item.veg, qty, max: item.stock, unit: item.unit || '', vendorId: vendor.id };
  // drop shops that have no items left; keep vendorId pointing at a shop still in the cart
  for (const id of Object.keys(cart.shops)) if (!Object.values(cart.lines).some(l => l.vendorId === id)) { delete cart.shops[id]; delete cart.notes[id]; }
  if (!Object.keys(cart.lines).length) cart = EMPTY();
  else if (!cart.shops[cart.vendorId]) { cart.vendorId = Object.keys(cart.shops)[0]; cart.vendor = cart.shops[cart.vendorId]; }
  saveCart(); return true;
}
export function clearCart() { cart = EMPTY(); saveCart(); }
export function setCartMeta(p) { Object.assign(cart, p); saveCart(); }
