#!/usr/bin/env node
// ZIPI operations tool: fix issues by hand from the server's command line.
//   node scripts/zipi.js help
// Every change is written to the audit log as "Ops CLI". With the embedded dev database, stop the server first.
process.env.TZ ||= process.env.APP_TZ || 'Asia/Kolkata';
import fs from 'node:fs';
import os from 'node:os';
import { config } from '../src/config.js';
import { createApp } from '../src/app/index.js';
import { issueToken } from '../src/http.js';
import { migrate } from '../src/db/schema.js';
import { COLLECTIONS } from '../src/db/schema.js';
import { backupAll, restoreFile, listBackups, BACKUP_DIR } from '../src/services/backup.js';
import { sampleData, importSqlite } from '../src/db/seed.js';

const [cmd, ...args] = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
const HELP = `ZIPI operations tool

  Setup
    migrate                              create or upgrade tables and indexes
    seed                                 add sample data (development only)
    import-sqlite <file>                 move data from the old SQLite file (data/zipi.db)
    create-admin <phone> <name>          make someone a super admin (first admin, or locked out)

  People
    user <phone>                         show an account, its roles and recent orders
    block <phone> | unblock <phone>      block or unblock an account (signs them out)
    signout <phone>                      sign someone out of every app and device
    sms-status                           which SMS services will send login codes
    sms-check                            check the SMS keys with Twilio without sending a message
    test-sms <phone>                     send a real login code to check the SMS setup
    unlock-otp <phone>                   clear the login-code limits for a phone (after support has verified the person)
    coins <phone> <amount> <reason>      add (or remove with a minus) ZIPI coins

  Orders
    order <code>                         show an order and its timeline (e.g. ZP1234)
    cancel-order <code> <reason>         cancel, return stock and coins, mark UPI refund
    deliver-order <code>                 mark a picked-up order as delivered
    unassign-order <code>                take the order off its rider so another can take it

  Data
    stats                                record counts and database size
    check [--fix]                        find stuck or inconsistent data (and fix it)
    backup                               write a full backup to ${BACKUP_DIR}
    backups                              list backups
    restore <file> [--replace] [--only a,b]   restore a backup (merge by default)
    export <collection> [file.json]      export one collection as JSON
    history <collection> <id>            show earlier versions of a record
    restore-version <hid>                put a record back to an earlier version
    cleanup                              delete expired codes, old logs and old history now
`;

if (!cmd || cmd === 'help' || cmd === '--help') { console.log(HELP); process.exit(0); }
// SMS checks need no database, so they also work while the server is running
if (cmd === 'sms-check' || cmd === 'sms-status') {
  const { checkProviders, activeProviders } = await import('../src/services/otp.js');
  const act = activeProviders();
  if (cmd === 'sms-check') { const res = await checkProviders(); console.log(res.length ? res.map(r => `${r.ok ? '✓' : '✗'} ${r.provider}: ${r.msg}`).join('\n') : 'No SMS service keys found. Put them in .env (see deploy/.env.example).'); if (res.some(r => !r.ok)) process.exitCode = 1; }
  console.log(act.length ? `Login codes will be sent by: ${act.join(' → ')} (first that works)` : 'No SMS service is ready. Codes only appear in the server log (development).');
  process.exit();
}
if (!config.databaseUrl && cmd !== 'help') {
  const running = await fetch(`http://127.0.0.1:${config.port}/healthz`, { signal: AbortSignal.timeout(800) }).then(r => r.ok, () => false);
  if (running) { console.error('The server is running on the embedded dev database. Stop it first (Ctrl+C), then run this again.'); process.exit(1); }
}
const app = await createApp(config, { issueToken });
const { db, c } = app;
const actor = { id: 'ops-cli', name: `Ops CLI (${os.userInfo().username})`, roles: ['admin'] };
const out = x => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
const userBy = async phone => { const u = await db.one('users', { phone: c.phoneOf(phone) }); if (!u) throw new Error('No account with phone ' + phone); return u; };
const orderBy = async code => { const o = await db.one('orders', { code: String(code).toUpperCase().startsWith('ZP') ? String(code).toUpperCase() : 'ZP' + code }); if (!o) throw new Error('No order ' + code); return o; };
const fmt = t => (t ? new Date(t).toLocaleString('en-IN') : '');

try {
  switch (cmd) {
    case 'migrate': await migrate(app.conn); out('Tables and indexes are up to date.'); break;
    case 'seed': if (config.prod) throw new Error('Refusing to add sample data in production'); out(await sampleData(app)); break;
    case 'import-sqlite': out(await importSqlite(app, args[0] || `${config.dataDir}/zipi.db`)); break;
    case 'create-admin': {
      const [phone, ...name] = args; if (!c.validPhone(c.phoneOf(phone))) throw new Error('Give a 10-digit mobile number');
      const u = await c.ensureUser(c.phoneOf(phone), name.join(' ')); await c.addRole(u.id, 'admin', { perms: ['*'], name: u.name || name.join(' ') });
      await c.audit(actor, 'super admin created from CLI', `${name.join(' ')} (${phone})`); out(`${phone} is now a super admin. Log in at /admin.`); break;
    }
    case 'user': {
      const u = await userBy(args[0]), os_ = await db.find('orders', { customerId: u.id }, { sort: '-createdAt', limit: 10 });
      out({ id: u.id, name: u.name, phone: u.phone, roles: u.roles, zone: u.zoneId, blocked: !!u.blocked, locked: u.locked || [], coins: u.coins || 0, joined: fmt(u.createdAt), addresses: (u.addresses || []).length,
        recentOrders: os_.map(o => `${o.code} ${o.status} ₹${o.total} ${fmt(o.createdAt)}`) }); break;
    }
    case 'block': case 'unblock': { const u = await userBy(args[0]); await db.update('users', u.id, { blocked: cmd === 'block', ...(cmd === 'block' ? { tokenVer: (u.tokenVer || 0) + 1 } : {}) }, { by: actor.id }); await c.audit(actor, cmd + 'ed from CLI', u.phone); out(`${u.phone} ${cmd}ed.`); break; }
    case 'test-sms': { if (!/^[6-9]\d{9}$/.test(args[0] || '')) throw new Error('Usage: test-sms <10-digit mobile>'); const r = await c.otp.send(args[0]); out(r.code ? `No SMS service configured; development code ${r.code}` : `Login code sent to ${args[0]}. Check the phone; it is valid for ${Math.round(r.ttl / 60)} minutes.`); break; }
    case 'unlock-otp': { const u = await userBy(args[0]); await db.q(`DELETE FROM ratelimit WHERE k = ANY($1::text[])`, [[`otp:p10:${u.phone}`, `otp:pday:${u.phone}`]]); await c.audit(actor, 'login code limit cleared from CLI', u.phone); out(`${u.phone} can request login codes again.`); break; }
    case 'signout': { const u = await userBy(args[0]); await db.incr('users', u.id, 'tokenVer', 1); await c.audit(actor, 'signed out from CLI', u.phone); out(`${u.phone} signed out everywhere.`); break; }
    case 'coins': {
      const [phone, amount, ...reason] = args, u = await userBy(phone);
      if (!(await c.credit(u.id, Math.round(+amount), reason.join(' ') || 'Adjustment by ZIPI', 'cli'))) throw new Error('Not enough coins to remove');
      await c.audit(actor, 'coins adjusted from CLI', u.phone, `${amount} ${reason.join(' ')}`); out(`Done. Balance: ${Math.floor((await db.get('users', u.id)).coins || 0)}`); break;
    }
    case 'order': { const o = await orderBy(args[0]); out({ code: o.code, status: o.status, total: o.total, payment: o.payment, shop: (await db.get('vendors', o.vendorId))?.name, rider: o.riderId ? (await db.get('riders', o.riderId))?.name : null,
      placed: fmt(o.createdAt), timeline: o.timeline.map(t => `${fmt(t.at)}  ${t.status}${t.note ? '  ' + t.note : ''}`) }); break; }
    case 'cancel-order': {
      const o = await orderBy(args[0]), reason = args.slice(1).join(' ') || 'Cancelled by ZIPI support';
      const n = await db.tx(async tx => { const r = await c.setStatus(o, 'cancelled', { cancelReason: reason, note: `Cancelled by ZIPI: ${reason}`, refund: o.payment === 'UPI' ? o.total : 0 }, { from: ['scheduled', 'placed', 'accepted', 'ready', 'picked'], t: tx, by: actor.id });
        if (!r) throw new Error(`Order is already ${o.status}`); await c.refundOrder(o, { stock: o.status !== 'picked', t: tx }); return r; });
      await c.emitOrder(n); await c.audit(actor, 'order cancelled from CLI', o.code, reason); out(`${o.code} cancelled.${o.payment === 'UPI' ? ` Refund ₹${o.total} to process in your payment dashboard.` : ''}`); break;
    }
    case 'deliver-order': {
      const o = await orderBy(args[0]);
      const n = await db.tx(async tx => { const r = await c.setStatus(o, 'delivered', { deliveredAt: Date.now(), paid: true, note: 'Marked delivered by ZIPI support' }, { from: ['picked'], t: tx, by: actor.id }); if (!r) throw new Error(`Order is ${o.status}, not picked up`);
        if (o.payment === 'COD' && o.riderId) await tx.incr('riders', o.riderId, 'cashInHand', o.total); if (o.coinsEarn) await c.credit(o.customerId, o.coinsEarn, `Earned on ${o.code}`, o.id, tx); return r; });
      await c.emitOrder(n); await c.audit(actor, 'order delivered from CLI', o.code); out(`${o.code} marked delivered.`); break;
    }
    case 'unassign-order': {
      const o = await orderBy(args[0]);
      const n = await db.updateIf('orders', o.id, { status: { $in: ['accepted', 'ready'] } }, { riderId: null, autoAssigned: false, timeline: [...o.timeline, { status: 'rider', at: Date.now(), note: 'Finding another delivery partner' }] }, { by: actor.id });
      if (!n) throw new Error('Only accepted or ready orders can be unassigned'); await c.emitOrder(n); await c.autoAssign(n); await c.audit(actor, 'order unassigned from CLI', o.code); out(`${o.code} is open for another rider.`); break;
    }
    case 'stats': {
      const rows = []; for (const coll of COLLECTIONS) rows.push([coll, await db.count(coll)]);
      const size = (await db.q('SELECT pg_size_pretty(pg_database_size(current_database())) AS s')).rows[0].s;
      out(rows.map(([k, n]) => `${k.padEnd(10)} ${String(n).padStart(10)}`).join('\n') + `\n\nDatabase size: ${size}`); break;
    }
    case 'check': {
      const r = await app.handle('GET', '/api/admin/ops', { user: { ...actor, perms: ['*'], roles: ['admin'] }, app: 'admin' });
      if (r.status !== 200) throw new Error(r.data.error);
      for (const ch of r.data.checks) console.log(`${ch.count ? '✗' : '✓'} ${ch.title}${ch.count ? `: ${ch.count}  (${ch.items.slice(0, 8).map(i => i.label).join(', ')})` : ''}`);
      if (flag('fix')) for (const ch of r.data.checks.filter(x => x.count && x.key !== 'old_open_tickets')) {
        const f = await app.handle('POST', '/api/admin/ops/fix', { body: { check: ch.key }, user: { ...actor, perms: ['*'], roles: ['admin'] }, app: 'admin' }); console.log(`  fixed ${f.data.fixed}/${f.data.total}: ${ch.title}`);
      }
      break;
    }
    case 'backup': out(await backupAll(db, { manual: true })); break;
    case 'backups': out(listBackups().map(b => `${b.name}  ${(b.bytes / 1048576).toFixed(1)} MB  ${fmt(b.at)}`).join('\n') || 'No backups yet'); break;
    case 'restore': {
      const file = args[0]; if (!file || !fs.existsSync(file)) throw new Error('Give the path to a backup file');
      const mode = flag('replace') ? 'replace' : 'merge', only = flag('only');
      if (mode === 'replace') console.log('Replacing: the chosen collections are emptied before restoring.');
      out(await restoreFile(db, file, { mode, only: typeof only === 'string' ? only.split(',') : null })); await c.invalidate();
      await c.audit(actor, 'backup restored from CLI', file, mode); break;
    }
    case 'export': {
      const coll = args[0]; if (!COLLECTIONS.includes(coll)) throw new Error('Unknown collection. One of: ' + COLLECTIONS.join(', '));
      const file = args[1] || `${coll}-${new Date().toISOString().slice(0, 10)}.json`, ws = fs.createWriteStream(file); ws.write('[\n'); let last = '', n = 0;
      for (;;) { const r = await db.q(`SELECT id, data FROM "${coll}" WHERE id > $1 ORDER BY id LIMIT 2000`, [last]); for (const x of r.rows) ws.write((n++ ? ',\n' : '') + JSON.stringify(x.data)); if (r.rows.length < 2000) break; last = r.rows.at(-1).id; }
      ws.end('\n]\n'); await c.audit(actor, 'data exported from CLI', coll, `${n} records`); out(`${n} records written to ${file}`); break;
    }
    case 'history': { const r = await db.q('SELECT hid, op, by, at, data FROM history WHERE coll = $1 AND doc_id = $2 ORDER BY at DESC LIMIT 30', [args[0], args[1]]);
      out(r.rows.map(x => `#${x.hid}  ${fmt(+x.at)}  ${x.op}  by ${x.by || 'system'}\n   ${JSON.stringify(x.data).slice(0, 200)}`).join('\n') || 'No history'); break; }
    case 'restore-version': {
      const r = await app.handle('POST', '/api/admin/recovery/restore', { body: { hid: +args[0] }, user: { ...actor, perms: ['*'], roles: ['admin'] }, app: 'admin' });
      if (r.status !== 200) throw new Error(r.data.error); out('Restored.'); break;
    }
    case 'cleanup': {
      const t = Date.now(), D = 86400000;
      for (const [sql, p] of [[`DELETE FROM history WHERE at < $1`, t - config.historyDays * D], [`DELETE FROM otps WHERE (data->>'exp')::numeric < $1`, t], [`DELETE FROM ratelimit WHERE reset_at < $1`, t], [`DELETE FROM idem WHERE at < $1`, t - 2 * D], [`DELETE FROM events WHERE (data->>'at')::numeric < $1`, t - config.eventDays * D]])
        await db.q(sql, [p]);
      out('Old data cleaned up.'); break;
    }
    default: console.log(`Unknown command "${cmd}".\n\n${HELP}`); process.exitCode = 1;
  }
} catch (err) { console.error('Error:', err.message); process.exitCode = 1; }
await app.close();
