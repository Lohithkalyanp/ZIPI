# ZIPI: hyperlocal food and grocery delivery

Five separate apps, each at its own address with its own login:

| App | Address | Who can log in | What they do |
|---|---|---|---|
| Customer app | `/` | Anyone with a phone number | Browse shops, search, cart, coupons, coins, schedule, checkout, live tracking on a map, ratings, address book, help and support |
| Shop console | `/shop` | Approved restaurant and kirana owners | Accept orders, menu and stock, insights, earnings, help |
| Rider app | `/rider` | Approved delivery partners | Take orders, live GPS, directions, OTP delivery, shifts, earnings, help |
| Zone manager | `/manager` | Staff an admin made manager of a zone | Approve partners, live orders and map, stock, riders and cash, support tickets and reports for their zone |
| Admin console | `/admin` | Admins (with per-area permissions) | Access control, users, shops, riders, orders, support, reports, payouts, coupons, zones, settings, data & recovery, system health, audit log |

A login only works in the app it was made for, and the server checks access on every request.

## Run it on your computer

You need **Node.js 22.5 or newer**.

```bash
npm install
npm start            # http://localhost:3000
```

Development uses an embedded PostgreSQL stored in `data/pglite`, so there is nothing else to install. On first start, an existing `data/zipi.db` from an older version is moved over automatically. Otherwise sample data is created.

While dev login codes are on (the default outside production), each login page shows its own test accounts, and the 6-digit code appears on screen:

| App | Phone | Account |
|---|---|---|
| `/` | 9000000006 | Customer (Riya) |
| `/shop` | 9000000003 / 9000000004 | Restaurant owner / kirana owner |
| `/rider` | 9000000005 | Rider (Ravi) |
| `/manager` | 9000000002 / 9000000007 | Zone managers |
| `/admin` | 9000000001 | Super admin (Anita) |

## Put it in production

See **[deploy/DEPLOY.md](deploy/DEPLOY.md)**. In short:
1. Set up PostgreSQL.
2. Copy `deploy/.env.example` to `.env` and fill in the database, secrets and an SMS service (AWS SNS, Twilio Verify or MSG91).
3. Run `node scripts/zipi.js migrate` and `create-admin`.
4. Start with systemd or Docker behind Nginx with HTTPS.

Day-to-day running, fixing problems and recovering data: **[deploy/OPERATIONS.md](deploy/OPERATIONS.md)**.

## Built for scale and bad days

- **PostgreSQL with indexes on every common query.** Tested with 3 lakh orders, 1 lakh customers and 3,000 shops: customer screens answer in under 10 ms (`node scripts/seed-large.js`).
- **No double bookings.**
  - Stock is reserved atomically, so the last item can't be sold twice.
  - Only one rider can claim an order.
  - Status changes are conditional, so the shop, the customer and background jobs never clash.
  - A double-tapped "Place order" creates one order.
- **Many servers, 24/7.**
  - Uses every CPU core.
  - Live updates are shared through PostgreSQL, and background jobs take a database lock so they run once.
  - Uploads can live in S3-compatible storage.
  - Health checks, metrics, JSON logs, graceful shutdown and automatic worker restarts.
- **Recovery.**
  - Every change to important records keeps the previous version.
  - Deleted records go to a trash bin.
  - One-click restore, plus daily and on-demand backups and a restore tool.
- **Data protection.**
  - ID and bank details encrypted at rest and masked on screen.
  - Login codes hashed, and login codes limited per phone and per network.
  - Customers can download or delete their data (DPDP Act).
  - Every staff action is logged.
- **Manual fixes.** Admin → System health finds stuck orders and inconsistent data and fixes them in one click. `node scripts/zipi.js` does the same from the server, plus user, order, coin, backup and history commands.
- **Real services.** Login SMS through AWS SNS, Twilio Verify, Twilio Messages or MSG91, with automatic fallback from one to the next. OpenStreetMap (Nominatim + OSRM) for address search, pin-to-address, road distance and routes, with caching and fallbacks.
- **Staff reports.** CSV exports of orders, daily summaries, payouts, rider earnings, shop performance, customers, feedback, tickets and item sales, streamed so lakhs of rows are fine.
- **Smart dispatch (p-center method).** Based on "Binary GA with p-Center Refinement" (T. Pratyusha, SRM University–AP):
  - Waiting orders in a zone are matched to free riders together, minimising the longest pickup distance. Ties are broken by how many orders sit at that distance, then by total distance. This was checked against the exact optimum on 208 random cases and in live testing.
  - Free riders get a suggested waiting spot chosen by the p-center GA + B_h-pC refinement, so every open shop has a rider close by.
  - Managers see how many riders keep every shop within a given distance.
  - Code: `src/app/dispatch.js`. Reproduce the OR-Library benchmark with `node scripts/bench-pcenter.js`.
- **Grocery by category.** The Grocery tab opens on categories (vegetables, fruits, dairy, staples, snacks, drinks, frozen, bakery, stationery, fancy and gifts, personal care, cleaning, medicines). It shows only what open shops can deliver to the customer's area, then lists matching items from every nearby shop with search, shop filters and price sorting. Existing items were categorised automatically, and shops choose a category when adding items.
- **One order from several grocery shops.** Customers can fill one cart from up to 6 shops (food stays one restaurant per order) and pay once, with one delivery fee, one coupon and one delivery code. Behind the scenes each shop gets its own order to accept and pack, and ZIPI decides **whether one delivery partner can collect everything or whether to send more**:
  - It checks every way of grouping the shops into rider trips (at most 203 for 6 shops) and every pickup order in each trip, simulating packing times and riding time.
  - A trip must fit one rider: up to 15 kg (8 kg on a cycle), 40 items and 3 shops. Weights are estimated from pack sizes such as "5 kg" or "500 ml".
  - It picks the plan where the last parcel arrives soonest. If using fewer riders costs at most 8 extra minutes, it uses fewer riders, and then the shortest distance.
  - The customer sees the plan and the reason at checkout (for example "2 delivery partners bring everything about 8 minutes sooner"). Each trip is offered to riders only once every shop in it has accepted. The rider sees every pickup in order, and the delivery code completes all bags at once.
  - Code: `src/app/basket.js` (planner) and `src/app/routes/baskets.js`.
- **Customer support.** Help in every app, tickets with photos, a staff inbox with internal notes, goodwill coins and satisfaction ratings.

## Commands

```bash
npm start                         # run the server
node scripts/zipi.js help         # operations tool (migrate, create-admin, user, block, coins, order fixes, check --fix, backup, restore, history...)
node scripts/seed-large.js        # load-test data into a throwaway database and time the busiest calls
```

## Code map

```
server.js                 entry: cluster of workers, graceful shutdown
src/config.js             all settings from environment variables
src/http.js               HTTP: static files, API, live events, uploads, CSV streaming, health and metrics
src/db/                   PostgreSQL connection (pool or embedded), repository, schema & indexes, seeding/migration
src/services/             otp (AWS SNS / Twilio / MSG91), aws (Signature V4), maps (Nominatim/OSRM), storage (local/S3), crypto, event bus, backups
src/app/context.js        shared business rules: pricing, surge, coins, orders, assignment, permissions
src/app/routes/           one file per area: account, catalog, orders, partners, vendor, rider, manage, admin, support, reports, data
src/app/jobs.js           background jobs (scheduled orders, auto-cancel, re-assignment, retention, backups)
scripts/zipi.js           operations tool for manual fixes and recovery
scripts/seed-large.js     scale test
scripts/bench-pcenter.js  p-center solver on the OR-Library pmed benchmark
src/app/dispatch.js       p-center GA + B_h-pC refinement, minimax order assignment
src/app/dispatcher.js     zone dispatch, rider waiting spots, coverage planning
src/app/basket.js         multi-shop basket planner: how many riders, which shops each visits
deploy/                   Dockerfile, docker-compose, Nginx, systemd, .env example, DEPLOY.md, OPERATIONS.md
public/                   the five web apps (no build step)
core/seed.js, memdb.js    sample data generator (used for development seeding only)
```

## Still to connect before public launch

- **Payments:** UPI is simulated. Integrate Razorpay or Cashfree, mark orders paid from their webhook, and automate refunds. Payouts are recorded manually; RazorpayX or Cashfree Payouts can automate them.
- **Own map servers** (OSRM, Nominatim) for production traffic.
- **Push notifications when the app is closed** (Web Push or Firebase). In-app and background-tab alerts work today.
- **Legal:** terms, privacy policy, FSSAI and pharmacy rules.
