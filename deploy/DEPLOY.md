# Deploying ZIPI

This guide covers two setups: one strong server to start, and several servers behind a load balancer for 24/7 operation. ZIPI is the same code in both. Only the settings change.

## What you need

| Item | Why | Suggested |
|---|---|---|
| PostgreSQL 14 or newer | All data | Managed: AWS RDS, DigitalOcean Managed PostgreSQL, Google Cloud SQL. Turn on automatic backups and point-in-time recovery. |
| Node.js 22.5 or newer | Runs ZIPI | Installed on the server, or use the Docker image |
| A domain and HTTPS | Phones only share GPS over HTTPS, and logins must be encrypted | Nginx with a free Let's Encrypt certificate |
| AWS SNS, Twilio Verify or MSG91 (two for fallback) | Real login codes by SMS | Twilio Verify needs no DLT setup of your own. MSG91 or Twilio Messages need a DLT-registered sender ID and template. Set up two for automatic fallback. |
| Object storage (several servers only) | Shop photos and documents shared by all servers | AWS S3, DigitalOcean Spaces or Cloudflare R2 |

## Settings

Copy `deploy/.env.example` to `.env` and fill it in. Never commit `.env`. Every variable is explained in the file.

- `ZIPI_SECRET` and `ZIPI_DATA_KEY` must be long random values (`openssl rand -hex 32`) and **identical on every server**.
- Store `ZIPI_DATA_KEY` in a password manager or secrets vault. Without it, the encrypted PAN, Aadhaar digits, licence, RC and bank numbers cannot be read.
- Set `ZIPI_DEV_OTP=0`. Production refuses to start without these secrets, and with dev codes off it refuses to log anyone in until an SMS service (Twilio or MSG91) is set up.

## Option A: one server (start here)

A single 8 CPU / 16 GB server with the database on a managed PostgreSQL comfortably handles a city launch.

```bash
# on the server (Ubuntu)
sudo useradd -m zipi && sudo mkdir -p /opt/zipi && sudo chown zipi /opt/zipi
# copy the project to /opt/zipi, then:
cd /opt/zipi && npm ci --omit=dev
cp deploy/.env.example .env && nano .env        # fill it in
node scripts/zipi.js migrate                    # create tables and indexes
node scripts/zipi.js create-admin 98XXXXXXXX "Your Name"
sudo cp deploy/zipi.service /etc/systemd/system/ && sudo systemctl enable --now zipi
sudo cp deploy/nginx.conf /etc/nginx/sites-enabled/zipi && sudo certbot --nginx -d zipi.example.com
```

ZIPI starts one worker per CPU core. If a worker crashes, it restarts on its own, and systemd restarts the whole service if needed.

Or with Docker (PostgreSQL included):

```bash
cp deploy/.env.example .env   # also add POSTGRES_PASSWORD=...
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec app node scripts/zipi.js create-admin 98XXXXXXXX "Your Name"
```

## Option R: Render (no server to manage)

`render.yaml` in the project root is a Render Blueprint. It creates the web service and a PostgreSQL database, and generates `ZIPI_SECRET` and `ZIPI_DATA_KEY`.

1. Render dashboard → **New → Blueprint** → connect GitHub and pick the ZIPI repo → **Apply**.
2. Render asks for the `sync: false` values (SNS keys, sender ID, DLT IDs). Type them there; they are never stored in GitHub.
3. After the first deploy, copy `ZIPI_DATA_KEY` (service → Environment) to a password manager.
4. Create the first admin from your computer, using the database's **External Database URL** (database page → Connect):
   `DATABASE_URL='<external url>' DB_SSL=1 NODE_ENV=production ZIPI_SECRET='<from Render>' ZIPI_DATA_KEY='<from Render>' node scripts/zipi.js create-admin 98XXXXXXXX "Your Name"`
5. Every push to `main` deploys again automatically. `PUBLIC_URL` defaults to the `onrender.com` address; set it when you add your own domain.

Limits: the free web service sleeps after 15 idle minutes (the first visit then takes about a minute), and the free database is deleted after 30 days. Render's disk is wiped on every deploy, so set `STORAGE_DRIVER=s3` and the `S3_*` variables to keep shop photos and documents.

## Option B: several servers (24/7, no single point of failure)

1. **Database:** a managed PostgreSQL with a standby replica in another availability zone (automatic failover).
2. **App servers:** two or more, each running ZIPI with the same `.env`. Set `STORAGE_DRIVER=s3` so all of them see uploaded files.
3. **Load balancer:** AWS ALB, a DigitalOcean load balancer, or Nginx (see `deploy/nginx.conf`). Health check `/readyz`. Allow long-lived connections on `/api/stream` (1 hour idle timeout).
4. **Live updates:** these work across servers automatically through PostgreSQL `LISTEN/NOTIFY`. No Redis is needed.
5. **Background jobs** (auto-cancel, scheduled orders, rider re-assignment, clean-up): every server runs the timer, but a database lock makes sure only one runs each job at a time.

### Sizing guide

| Load | App servers | PostgreSQL |
|---|---|---|
| Up to ~20,000 orders a day | 1 × 4 CPU | 2 CPU / 4 GB |
| Up to ~2 lakh orders a day | 3 × 8 CPU | 8 CPU / 32 GB + read replica |
| More | Add app servers behind the load balancer | 16+ CPU, consider partitioning `orders` and `events` by month |

Keep `WEB_CONCURRENCY × DB_POOL_SIZE × servers` below the database's `max_connections`, or put PgBouncer in front of PostgreSQL.

Measured on a laptop with the embedded database and 3 lakh orders, 1 lakh customers and 3,000 shops (`node scripts/seed-large.js`): shop lists, menus, search, "my orders" and logins all answer in under 10 ms. The admin dashboard takes about 1.4 s and is cached for 60 s.

## Maps

ZIPI uses free OpenStreetMap services. Address search and pin-to-address use Nominatim. Road distance and the route on the tracking map use OSRM. Results are cached in the database, and everything falls back to straight-line distance if the service is down.

The public servers allow only light use (about one search a second, no heavy apps). Before real traffic, run your own:

- **OSRM** with the India extract from Geofabrik (`osrm-backend`, about 8 GB RAM to build). Set `OSRM_URL`.
- **Nominatim** with the India extract (`mediagis/nominatim`, about 64 GB disk, takes hours to import). Set `NOMINATIM_URL`.

Both are commented out in `deploy/docker-compose.yml`. Map tiles come from `tile.openstreetmap.org`. For heavy use, switch to a paid tile provider (MapTiler, Stadia) and update the tile URL in `public/js/map.js` and the CSP `img-src` in `src/http.js`.

## Login SMS (Fast2SMS, AWS SNS, Twilio, MSG91)

### Option F: Fast2SMS (quickest for India)

1. Sign up at fast2sms.com, finish the business details and website verification they ask for, and add wallet balance.
2. Dev API: copy the API key. Put it in `FAST2SMS_API_KEY` (Render: Environment; server: `.env`). Never commit it.
3. `FAST2SMS_ROUTE=otp` sends Fast2SMS's own pre-approved OTP text, so you need no DLT registration of your own. To send your own wording, register a DLT sender ID and template, add it in Fast2SMS, then set `FAST2SMS_ROUTE=dlt`, `FAST2SMS_SENDER_ID` and `FAST2SMS_TEMPLATE_ID` (their Message ID).
4. `SMS_PROVIDERS=fast2sms,sns` uses Fast2SMS first and falls back to SNS. `node scripts/zipi.js sms-check` checks the key and wallet, `test-sms <phone>` sends a real code.

The server creates, sends and checks every code. The browser never sees the code except as the SMS the person receives, and the code is never sent to the page. Codes are valid for 5 minutes, with 5 tries. Sending is limited to one every 30 s, 5 per 10 min and 15 per day per phone, and 20 per 10 min per network. If someone is locked out, support can clear it in Admin → Access control → the person → "Reset login code limit", or run `node scripts/zipi.js unlock-otp <phone>`.

**Option S: AWS SNS**
1. **DLT first (India).** On a DLT portal (Jio TrueConnect, Airtel, Vi), register as a Principal Entity, then register a 6-letter header (for example `ZIPIIN`) and this Service-Implicit content template:
   `{#var#} is your ZIPI login code. Valid for {#var#} minutes. Do not share it.`
   Note the Entity ID and the Template ID (19 digits each). Approval usually takes a few working days.
2. **IAM user.** IAM → Policies → Create policy → JSON → paste `deploy/aws-sns-policy.json`. This policy can only text phone numbers, not publish to topics, plus two read calls used by `sms-check`. Create a user with only this policy, then create an access key for it.
3. **SNS in Mumbai (ap-south-1).** Text messaging (SMS):
   - New accounts start in the **SMS sandbox** and can text only numbers you verify there. Add your own number to test, then choose **Exit SMS sandbox** (an AWS Support request).
   - The default **spend limit is USD 1 per month**. Ask AWS Support to raise it, giving an estimate of your daily logins.
   - Set the default message type to **Transactional**. ZIPI also sends it with every message.
4. Fill in `SNS_ACCESS_KEY_ID`, `SNS_SECRET_ACCESS_KEY`, `SNS_SENDER_ID`, `SNS_DLT_ENTITY_ID` and `SNS_DLT_TEMPLATE_ID`. Keep `SMS_TEXT` word for word the same as the DLT template, or carriers drop the SMS.
5. Run `node scripts/zipi.js sms-check`. It reports bad keys, sandbox mode, a low spend limit and missing DLT details. Then run `test-sms` to your phone.

ZIPI signs AWS requests itself (Signature V4, no SDK). `node scripts/check-aws-sign.js` checks the signing against the AWS documentation example.

**Option A: Twilio Verify (recommended to start)**
1. Create a Twilio account and upgrade it from trial. Trial accounts only text numbers you have verified.
2. Console → Verify → Services → Create. Set the friendly name to `ZIPI` (it appears in the SMS) and the code length to 6. Copy the Service SID (`VA…`).
3. Console → Account → API keys → Create a Standard key. Set `TWILIO_ACCOUNT_SID` (`AC…`), `TWILIO_API_KEY` (`SK…`), `TWILIO_API_SECRET` and `TWILIO_VERIFY_SERVICE_SID`. Using `TWILIO_AUTH_TOKEN` instead of an API key also works.
4. Twilio sends through its own pre-registered Indian templates, so you don't need your own DLT registration. Twilio Verify charges per successful verification. Check current India pricing in the console.

**Option B: Twilio Messages (ZIPI writes the SMS)**
- Set `TWILIO_MESSAGING_SERVICE_SID` (preferred) or `TWILIO_NUMBER`. To reach Indian numbers reliably, register a sender ID and this template on DLT and link them in Twilio:
  `{#var#} is your ZIPI login code. Valid for 5 minutes. Do not share it with anyone.`
- When `PUBLIC_URL` is set, the SMS ends with `@your-domain #123456`. Android Chrome then fills the code in by itself.

**Option C: MSG91**
1. Register your sender ID and an OTP template on the DLT portal (Jio, Vodafone or Airtel), for example: `##OTP## is your ZIPI login code. Valid for 5 minutes. Do not share it.`
2. Add the template in MSG91, then set `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID`.

**Fallback.** `SMS_PROVIDERS=twilio-verify,msg91` uses Twilio Verify first. If Twilio is down or refuses the request, MSG91 sends the code instead. Every failure is logged as `sms provider failed`. Check the setup before launch:

```
node scripts/zipi.js sms-check             # checks the keys with Twilio (trial or paid, Verify service, code length) without sending
node scripts/zipi.js sms-status            # which services are active, in order
node scripts/zipi.js test-sms 98XXXXXXXX   # sends a real code to your phone
```

ZIPI reads a `.env` file in the app folder on start (variables already set in the environment take priority). In development, the demo numbers 9000000001–099 and 9100000001–099 keep getting on-screen codes even with Twilio on, so test logins still work (`ZIPI_DEV_PHONES`). Production never shows codes.

**Keep keys secret.** Put them only in the server's `.env` or your host's secret settings. Never commit them to Git. If a key has ever been pushed to GitHub, delete it in the Twilio console and create a new one.

## Before going live

- [ ] `NODE_ENV=production`, `ZIPI_DEV_OTP=0`, SMS service configured (SNS out of sandbox with a raised spend limit, or Twilio Verify / MSG91). `sms-check` all ✓, `test-sms` reaches a Jio, an Airtel and a Vi phone. Test a real login.
- [ ] HTTPS working, and `http://` redirects to `https://`
- [ ] Database automatic backups and point-in-time recovery on. Do a test restore.
- [ ] `ZIPI_DATA_KEY` stored safely outside the server
- [ ] Own OSRM/Nominatim, or an agreement with a maps provider
- [ ] Payments: UPI is still simulated. Integrate Razorpay or Cashfree, mark orders paid from their webhook, and automate refunds.
- [ ] Monitoring: point Prometheus/Grafana or your provider at `/metrics` (set `METRICS_TOKEN`) and `/readyz`, and alert on errors and slow requests from the JSON logs
- [ ] Legal: terms, privacy policy (DPDP Act 2023), FSSAI rules for food, pharmacy rules if you list medicines
- [ ] Load test your setup (`node scripts/seed-large.js` against a staging database)
