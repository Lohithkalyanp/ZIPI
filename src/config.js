// All configuration comes from environment variables (see deploy/.env.example).
// Nothing secret is hard-coded. In development, missing secrets are generated once and kept in DATA_DIR.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// read .env next to the app (or ZIPI_ENV_FILE) if present; variables already set in the environment win
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw); if (!m || raw.trim().startsWith('#')) continue;
    let v = m[2]; if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(process.env.ZIPI_ENV_FILE || path.join(ROOT, '.env'));
const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase()));
const int = (v, d) => (v === undefined || v === '' || !Number.isFinite(+v) ? d : Math.round(+v));

const PROD = env.NODE_ENV === 'production';
// demo / testing deployment: sample shops and test accounts, login codes on screen, no paid SMS needed. Never for real customers.
const DEMO = /^(1|true|yes|on)$/i.test(env.ZIPI_DEMO || '');
if (PROD && !env.DATABASE_URL && env.ZIPI_ALLOW_EMBEDDED !== '1') throw new Error('DATABASE_URL must be set in production (PostgreSQL). See deploy/DEPLOY.md');
const DATA = path.resolve(env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA, { recursive: true });

// a secret that must be stable across restarts and identical on every server
function secret(name, file) {
  if (env[name]) return env[name];
  if (PROD) throw new Error(`${name} must be set in production (32+ random bytes, the same on every server)`);
  const f = path.join(DATA, file);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, s, { mode: 0o600 }); return s;
}

export const config = {
  prod: PROD,
  port: int(env.PORT, 3000),
  // worker processes per machine (cluster). Embedded dev database supports only one.
  workers: env.DATABASE_URL ? Math.max(1, int(env.WEB_CONCURRENCY, PROD ? os.availableParallelism() : 1)) : 1,
  dataDir: DATA,
  databaseUrl: env.DATABASE_URL || '',
  dbPool: int(env.DB_POOL_SIZE, 20),
  dbSsl: bool(env.DB_SSL, false),
  secret: secret('ZIPI_SECRET', 'secret.key'),            // signs login tokens and hashes OTPs
  dataKey: secret('ZIPI_DATA_KEY', 'data.key'),           // encrypts ID and bank details at rest
  devOtp: bool(env.ZIPI_DEV_OTP, !PROD || DEMO),
  demo: DEMO,
  // development only: these demo numbers get on-screen codes even when a real SMS service is set up (ignored in production)
  devPhones: PROD && !DEMO ? [] : (env.ZIPI_DEV_PHONES ?? '9000000001-9000000099,9100000001-9100000099').split(',').map(x => x.trim()).filter(Boolean),
  trustProxy: bool(env.ZIPI_TRUST_PROXY, false),
  publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '', // Render sets RENDER_EXTERNAL_URL automatically
  metricsToken: env.METRICS_TOKEN || '',
  logLevel: env.LOG_LEVEL || (PROD ? 'info' : 'debug'),
  historyDays: int(env.HISTORY_DAYS, 90),
  eventDays: int(env.EVENT_DAYS, 180),
  backupKeep: int(env.ZIPI_BACKUP_DAYS, 7),

  otp: {
    ttlSec: int(env.OTP_TTL_SEC, 300), maxTries: 5, resendSec: int(env.OTP_RESEND_SEC, 30),
    per10min: 5, perDay: int(env.OTP_PER_DAY, 15), perIp10min: int(env.OTP_PER_IP_10MIN, 20),
  },
  // which SMS services send login codes, in order; the next one is tried if one fails. Default: every configured one.
  // SMS wording for services where ZIPI writes the text (twilio, sns). Must match your DLT-approved template exactly.
  // {code} and {minutes} are filled in; \n is a new line. Empty = ZIPI's default wording.
  smsText: (env.SMS_TEXT || '').replace(/\\n/g, '\n'),
  smsProviders: (env.SMS_PROVIDERS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
  twilio: {
    // auth: Account SID + Auth Token, or (better) an API key SID + secret with the Account SID
    accountSid: env.TWILIO_ACCOUNT_SID || '', authToken: env.TWILIO_AUTH_TOKEN || '',
    apiKey: env.TWILIO_API_KEY || '', apiSecret: env.TWILIO_API_SECRET || '',
    verifySid: env.TWILIO_VERIFY_SERVICE_SID || '',            // Twilio Verify: Twilio creates, sends and checks the code
    from: env.TWILIO_NUMBER || env.TWILIO_FROM || '',          // Twilio Messages: ZIPI's code sent as a normal SMS from this number / sender ID
    messagingSid: env.TWILIO_MESSAGING_SERVICE_SID || '',      // ...or from a Messaging Service (preferred over a single number)
    timeoutMs: int(env.TWILIO_TIMEOUT_MS, 8000),
    apiBase: (env.TWILIO_API_BASE || 'https://api.twilio.com').replace(/\/$/, ''), verifyBase: (env.TWILIO_VERIFY_BASE || 'https://verify.twilio.com').replace(/\/$/, ''),
  },
  sns: {
    // AWS SNS SMS. Use an IAM user that may only call sns:Publish (+ the two read calls used by sms-check).
    key: env.SNS_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || '', secret: env.SNS_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || '', token: env.AWS_SESSION_TOKEN || '',
    region: env.SNS_REGION || env.AWS_REGION || 'ap-south-1',                // Mumbai
    endpoint: env.SNS_ENDPOINT || '',                                        // default https://sns.<region>.amazonaws.com/
    senderId: env.SNS_SENDER_ID || '',                                       // your DLT-registered 6-letter header, e.g. ZIPIIN
    entityId: env.SNS_DLT_ENTITY_ID || '', templateId: env.SNS_DLT_TEMPLATE_ID || '', // required by Indian carriers
    timeoutMs: int(env.SNS_TIMEOUT_MS, 8000),
  },
  msg91: {
    authKey: env.MSG91_AUTH_KEY || '', templateId: env.MSG91_TEMPLATE_ID || '',
    url: env.MSG91_OTP_URL || 'https://control.msg91.com/api/v5/otp', timeoutMs: int(env.MSG91_TIMEOUT_MS, 8000),
  },
  fast2sms: {
    key: env.FAST2SMS_API_KEY || '',
    route: (env.FAST2SMS_ROUTE || 'otp').toLowerCase(),        // otp = Fast2SMS's own OTP message (no DLT of your own); dlt = your DLT template
    senderId: env.FAST2SMS_SENDER_ID || '', templateId: env.FAST2SMS_TEMPLATE_ID || '', // only for route dlt (Fast2SMS "Message ID")
    url: (env.FAST2SMS_URL || 'https://www.fast2sms.com/dev').replace(/\/$/, ''), timeoutMs: int(env.FAST2SMS_TIMEOUT_MS, 8000),
  },
  maps: {
    // public OpenStreetMap servers are for light use only; point these at your own Nominatim / OSRM in production
    nominatimUrl: (env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, ''),
    osrmUrl: (env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, ''),
    userAgent: env.MAPS_USER_AGENT || 'ZIPI-delivery/2.0',
    countryCodes: env.MAPS_COUNTRY || 'in',
    enabled: bool(env.MAPS_ONLINE, true),
    timeoutMs: int(env.MAPS_TIMEOUT_MS, 2500),
  },
  storage: {
    driver: env.STORAGE_DRIVER || 'local', // local | s3
    s3: { endpoint: env.S3_ENDPOINT || '', region: env.S3_REGION || 'ap-south-1', bucket: env.S3_BUCKET || '', key: env.S3_ACCESS_KEY || '', secret: env.S3_SECRET_KEY || '', publicUrl: env.S3_PUBLIC_URL || '' },
  },
};
