// Portable backups: every collection written as gzip-compressed JSON lines (one record per line), streamed in batches.
// Works the same on the embedded dev database and on any PostgreSQL. Restore with `node scripts/zipi.js restore <file>`.
// For production also enable your database provider's automatic backups and point-in-time recovery (see OPERATIONS.md).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { once } from 'node:events';
import { COLLECTIONS } from '../db/schema.js';
import { config } from '../config.js';
import { log } from '../log.js';

export const BACKUP_DIR = path.join(config.dataDir, 'backups');
export const BACKUP_RX = /^zipi-[\w-]+\.ndjson\.gz$/;

export async function backupAll(db, { name, manual = false } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, name || `zipi-${manual ? 'manual-' : ''}${manual ? stamp : stamp.slice(0, 10)}.ndjson.gz`);
  if (!manual && fs.existsSync(file)) return null;
  const tmp = file + '.part', gz = zlib.createGzip({ level: 6 }), out = fs.createWriteStream(tmp);
  gz.pipe(out);
  const write = async line => { if (!gz.write(line + '\n')) await once(gz, 'drain'); };
  await write(JSON.stringify({ zipiBackup: 2, at: Date.now(), collections: COLLECTIONS }));
  const counts = {};
  for (const coll of COLLECTIONS) {
    let last = '', n = 0;
    for (;;) {
      const r = await db.q(`SELECT id, data FROM "${coll}" WHERE id > $1 ORDER BY id LIMIT 2000`, [last]);
      for (const row of r.rows) { await write(JSON.stringify({ c: coll, d: row.data })); n++; }
      if (r.rows.length < 2000) break; last = r.rows.at(-1).id;
    }
    counts[coll] = n;
  }
  gz.end(); await once(out, 'finish');
  fs.renameSync(tmp, file);
  prune();
  const bytes = fs.statSync(file).size;
  log.info('backup written', { file: path.basename(file), bytes, records: Object.values(counts).reduce((a, b) => a + b, 0) });
  return { name: path.basename(file), bytes, at: Date.now(), counts };
}

export function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter(f => BACKUP_RX.test(f)).map(f => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, bytes: st.size, at: st.mtimeMs }; }).sort((a, b) => b.at - a.at);
  } catch { return []; }
}
function prune() {
  const all = listBackups(), daily = all.filter(b => !b.name.includes('manual')), manual = all.filter(b => b.name.includes('manual'));
  for (const b of [...daily.slice(config.backupKeep), ...manual.slice(10)]) fs.unlinkSync(path.join(BACKUP_DIR, b.name));
}

// mode: 'merge' (insert missing, update existing) or 'replace' (empty the chosen collections first)
export async function restoreFile(db, file, { mode = 'merge', only = null } = {}) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let header = null, batch = [], batchColl = null; const counts = {}, cleared = new Set();
  const flush = async () => { if (!batch.length) return; await db.insertMany(batchColl, batch, { upsert: true }); counts[batchColl] = (counts[batchColl] || 0) + batch.length; batch = []; };
  for await (const line of rl) {
    if (!line.trim()) continue;
    const x = JSON.parse(line);
    if (!header) { if (!x.zipiBackup) throw new Error('Not a ZIPI backup file'); header = x; continue; }
    if (!COLLECTIONS.includes(x.c) || (only && !only.includes(x.c))) continue;
    if (mode === 'replace' && !cleared.has(x.c)) { await flush(); await db.q(`DELETE FROM "${x.c}"`); cleared.add(x.c); }
    if (x.c !== batchColl) { await flush(); batchColl = x.c; }
    batch.push(x.d); if (batch.length >= 500) await flush();
  }
  await flush();
  return { from: header?.at, counts };
}
