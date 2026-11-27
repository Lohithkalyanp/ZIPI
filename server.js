// ZIPI server entry point.
//   node server.js                      development: embedded PostgreSQL in ./data, one process, dev login codes
//   NODE_ENV=production node server.js  production: needs DATABASE_URL, ZIPI_SECRET, ZIPI_DATA_KEY (see deploy/.env.example)
// In production it starts one worker per CPU core (WEB_CONCURRENCY to override). Workers share nothing but the database.
process.env.TZ ||= process.env.APP_TZ || 'Asia/Kolkata';
import cluster from 'node:cluster';
import { config } from './src/config.js';
import { log } from './src/log.js';

if (cluster.isPrimary && config.workers > 1) {
  log.info(`ZIPI starting ${config.workers} workers`, { port: config.port });
  // run migrations once before workers start, so they never race each other
  const { connect } = await import('./src/db/connect.js'), { migrate } = await import('./src/db/schema.js');
  const conn = await connect(config); await migrate(conn); await conn.close();
  for (let i = 0; i < config.workers; i++) cluster.fork();
  cluster.on('exit', (w, code, sig) => { if (!shuttingDown) { log.error('worker died, starting a new one', { pid: w.process.pid, code, sig }); setTimeout(() => cluster.fork(), 1000); } });
  let shuttingDown = false;
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { shuttingDown = true; for (const w of Object.values(cluster.workers)) w.process.kill('SIGTERM'); setTimeout(() => process.exit(0), 12000).unref(); });
} else {
  const { createApp } = await import('./src/app/index.js');
  const { makeServer, issueToken } = await import('./src/http.js');
  const { seedIfEmpty, ensureDemoCatalog } = await import('./src/db/seed.js');
  const app = await createApp(config, { issueToken, migrateOnStart: config.workers === 1 });
  if (!config.prod) { await seedIfEmpty(app); await ensureDemoCatalog(app).catch(err => log.warn('demo catalog skipped', { err: err.message })); }
  const { server, clients } = makeServer(app);
  app.jobs.start();
  server.listen(config.port, () => {
    log.info(`ZIPI running on http://localhost:${config.port}`, { db: app.conn.kind, devOtp: config.devOtp, sms: app.c.otp.providers().join(' → ') || 'dev codes', storage: app.c.storage.driver });
    if (config.devOtp) log.warn('Dev login codes are ON: codes are shown on screen. Never use this in production (set NODE_ENV=production).');
  });
  let closing = false;
  const shutdown = async sig => {
    if (closing) return; closing = true;
    log.info('shutting down gracefully', { sig });
    app.jobs.stop();
    server.close();
    for (const cl of clients) cl.res.end();
    setTimeout(() => process.exit(1), 10000).unref();
    try { await app.close(); } catch { }
    process.exit(0);
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', err => log.error('unhandled promise rejection', { err }));
  process.on('uncaughtException', err => { log.error('uncaught exception', { err }); shutdown('uncaughtException'); });
}
