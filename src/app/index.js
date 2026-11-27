// Builds the application: connection, migrations, services, routes, jobs.
import { connect } from '../db/connect.js';
import { migrate } from '../db/schema.js';
import { makeRepo } from '../db/repo.js';
import { makeBus } from '../services/bus.js';
import { makeOtp } from '../services/otp.js';
import { makeMaps } from '../services/maps.js';
import { makeStorage } from '../services/storage.js';
import { makeContext } from './context.js';
import { makeRouter } from './router.js';
import { makeJobs } from './jobs.js';
import { makeDispatcher } from './dispatcher.js';
import account from './routes/account.js';
import catalog from './routes/catalog.js';
import orders from './routes/orders.js';
import partners from './routes/partners.js';
import vendor from './routes/vendor.js';
import rider from './routes/rider.js';
import manage from './routes/manage.js';
import admin from './routes/admin.js';
import support from './routes/support.js';
import reports from './routes/reports.js';
import data from './routes/data.js';
import grocery from './routes/grocery.js';
import baskets from './routes/baskets.js';

export async function createApp(cfg, { issueToken, migrateOnStart = true } = {}) {
  const conn = await connect(cfg);
  if (migrateOnStart) await migrate(conn);
  const db = makeRepo(conn), bus = makeBus(conn);
  await bus.start();
  const c = await makeContext({ db, bus, otp: makeOtp(db), maps: makeMaps(db), storage: makeStorage() });
  c.issueToken = issueToken; c.dbStats = conn.stats;
  makeDispatcher(c); // p-center based order assignment, rider staging and coverage planning
  const router = makeRouter(c);
  for (const mod of [account, catalog, orders, partners, vendor, rider, manage, admin, support, reports, data, grocery, baskets]) mod(router.route, c);
  const jobs = makeJobs(c);
  return { c, db, conn, bus, router, jobs, handle: router.handle, can: router.can, close: () => conn.close() };
}
