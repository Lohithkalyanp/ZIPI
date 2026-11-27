# Running ZIPI day to day

For whoever keeps ZIPI running: support leads, operations staff and engineers on call.

## Where to look first

| Question | Where |
|---|---|
| Is everything up? | **Admin → System health**: database, background jobs, live orders, SMS, and 9 automatic checks for stuck data with one-click fixes |
| Is the server alive? | `GET /healthz` (process) and `GET /readyz` (process + database) |
| What happened to an order? | Admin → Orders, search the code, open it. Or `node scripts/zipi.js order ZP1234` |
| Who changed this? | **Admin → Audit log** (every staff action that touches money, partners or access), and the record's **History** in Data & recovery |
| Errors | Server logs: JSON lines in production. Every error has a `rid` (request id) that customers also see as "ref" in error messages. |

## Fixing common problems

Each fix below can be done in the admin console or from the server's command line (`node scripts/zipi.js help`). Every change lands in the audit log and in record history, so it can be undone.

| Problem | Console | Command line |
|---|---|---|
| Order stuck "waiting for shop" | System health → *Cancel and refund* | `cancel-order ZP1234 "Shop closed"` |
| Order accepted but no rider | Orders → Assign, or System health → *Try auto-assign again* | `unassign-order ZP1234` |
| Rider delivered but forgot to complete | System health → *Mark delivered* | `deliver-order ZP1234` |
| Customer upset, wants compensation | Support → ticket → *Give goodwill coins* | `coins 98XXXXXXXX 50 "Sorry for the delay"` |
| Account misused | Access control → Manage → Block, or Sign out everywhere | `block 98XXXXXXXX`, `signout 98XXXXXXXX` |
| Admin locked out / first admin | n/a | `create-admin 98XXXXXXXX "Name"` |
| Wrong coin balance | System health → *Recalculate balance from history* | `check --fix` |
| A staff member changed a shop, item, coupon or setting by mistake | Data & recovery → open the record → **History** → *Restore this* | `history vendors <id>`, then `restore-version <hid>` |
| Something was deleted | Data & recovery → **History & trash** → Restore | `restore-version <hid>` |

## Recovering data

There are three layers, from small to large:

1. **One record:** every change to users, shops, items, riders, orders, coupons, zones, settings, payouts, tickets, shifts and cash deposits keeps the previous version for `HISTORY_DAYS` (90). Restore any version from the admin console. Restoring keeps the current version too, so nothing is lost.
2. **App backups:** a compressed copy of every record, made daily (last 7 kept) and on demand (Data & recovery → Back up now, or `node scripts/zipi.js backup`). Download it from the console, then restore with:
   ```bash
   node scripts/zipi.js restore data/backups/zipi-2026-11-27.ndjson.gz                    # merge: put back missing records, overwrite changed ones
   node scripts/zipi.js restore <file> --only orders,items                                # just some collections
   node scripts/zipi.js restore <file> --replace --only coupons                           # empty those collections first
   ```
3. **Database backups:** your PostgreSQL provider's automatic backups and point-in-time recovery restore the whole database to any minute. Use this after a serious incident. Test it once a quarter.

Copy app backups off the server, for example with a nightly `aws s3 sync data/backups s3://your-bucket/zipi-backups`.

## Data protection

- PAN, Aadhaar digits, driving licence, RC and bank account numbers are **encrypted** (AES-256-GCM). Screens show them masked. Managers can reveal them when checking an application, and every reveal is logged.
- Login codes are stored only as a hash. Login tokens are signed and tied to one app. Blocking, pausing an app or "sign out everywhere" invalidates them immediately.
- Customers can **download all their data** and **delete their account** from the app (DPDP Act). Deletion removes the person from the record. Orders are kept for tax purposes without personal details.
- Staff see only what their permissions allow. Reports mask phone numbers unless the admin has access-control permission. Every report download, data export and backup download is logged.
- Old data is removed on schedule: login codes (1 day), login history (180 days), app analytics events (`EVENT_DAYS`, 180), record history (`HISTORY_DAYS`, 90).

## Reports for staff

Admin → **Reports** (or Zone manager → Reports for their own zone) downloads CSV files that open in Excel or Google Sheets:

- Orders and daily summary
- Shop payouts and rider earnings
- Shop performance
- Customers (head office only)
- Ratings and feedback
- Support tickets
- Item sales

Exports stream from the database in batches, so a year of orders is fine.

## Customer feedback and support

- After delivery, customers rate the order and the rider, give an NPS score and say what else ZIPI should deliver. This shows up in Market insights and the Ratings & feedback report.
- **Help** in every app (customer, shop, rider) opens a support request, optionally about a specific order and with photos.
- Staff work the **Support inbox**:
  - Urgent and high-priority tickets come first.
  - Assign yourself, reply, or add internal notes the customer never sees.
  - Give goodwill coins, then resolve.
- Customers rate the help they got. Zone managers see their zone's tickets.
- Track first-reply time, resolution time and satisfaction in the Support tickets report.

## How orders get a rider

- When a shop accepts an order, and every 15 seconds after that, ZIPI matches **all waiting orders in the zone to all free online riders at once**. The goal is to make the longest pickup as short as possible, then to have as few orders as possible at that distance, then the lowest total distance. Riders who declined an order are never offered it again, and no rider is sent more than 15 km to a pickup.
- A rider can tap "Can't take it" and the order moves to the next best rider. Managers can still assign by hand (Orders → Assign), and auto-assignment can be switched off in Admin → Fees & growth.
- **Waiting spots.** Free riders see "Best place to wait near …". The spots come from the p-center method, which places the free riders so the farthest open shop is as close as possible to a rider. Managers see the spots and their coverage circles on the Live map.
- **How many riders?** Live map → "How many riders do we need?" shows, for 1, 2, 3… riders, how far the farthest shop would be. Use it with Rider shifts to plan staffing (for example, enough riders that every shop is within 2 km).
- **Multi-shop orders.** A grocery order from several shops has a basket code (ZB…) and one ZP… order per shop. All of them share the customer's delivery code. Shops whose parts ride together form one trip. That trip is offered or auto-assigned only when every shop in it has accepted, and it always goes to a single rider. If a rider declines, the whole trip moves on. The rider can complete delivery only after picking up every bag in the trip. If one shop rejects, its part is refunded and the rest still comes. Settings: `extraShopFee` (added to the customer's delivery fee for each extra shop) and `riderPerStop` (paid to the rider for each extra pickup).

## Scaling checklist (when traffic grows)

- Watch `/metrics`: request latency, `zipi_db_pool_waiting` (above 0 for long means more DB connections or PgBouncer), and memory.
- Add app servers behind the load balancer. They share nothing but the database and object storage.
- Add a read replica for heavy reporting if exports slow down live traffic.
- Partition `orders` and `events` by month when they pass a few crore rows.
- Run your own OSRM and Nominatim before public launch (see DEPLOY.md).
