// In-memory document store shared by the Node server (persisted to SQLite)
// and the browser demo (persisted to localStorage). Every read returns a copy.
export const newId = (p = '') => p + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 7);

export function createMemDB({ onWrite = () => {} } = {}) {
  const cols = new Map();
  const col = c => { if (!cols.has(c)) cols.set(c, new Map()); return cols.get(c); };
  const clone = o => (o == null ? o : structuredClone(o));
  return {
    get: (c, id) => clone(col(c).get(id)) ?? null,
    list: (c, pred) => { const out = []; for (const d of col(c).values()) if (!pred || pred(d)) out.push(clone(d)); return out; },
    find: (c, pred) => { for (const d of col(c).values()) if (pred(d)) return clone(d); return null; },
    count: (c, pred) => { let n = 0; for (const d of col(c).values()) if (!pred || pred(d)) n++; return n; },
    insert: (c, doc) => { const d = structuredClone(doc); if (!d.id) d.id = newId(); col(c).set(d.id, d); onWrite(c, d.id, d); return clone(d); },
    update: (c, id, patch) => {
      const cur = col(c).get(id); if (!cur) return null;
      const d = typeof patch === 'function' ? patch(clone(cur)) : { ...cur, ...structuredClone(patch) };
      d.id = id; col(c).set(id, d); onWrite(c, id, d); return clone(d);
    },
    remove: (c, id) => { col(c).delete(id); onWrite(c, id, null); },
    _load: (c, doc) => col(c).set(doc.id, doc),
    collections: () => [...cols.keys()],
    dump: () => Object.fromEntries([...cols].map(([c, m]) => [c, [...m.values()]])),
  };
}
