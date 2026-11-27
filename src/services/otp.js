// Real login codes.
//  - The server decides everything: the browser never sees or checks the code (unlike a client-side demo).
//  - Limits: 30 s between sends, 5 per 10 min and 15 per day per phone, 20 per 10 min per network, 5 wrong tries per code.
//    Limits live in the database so they hold across every server.
//  - SMS services, tried in order (SMS_PROVIDERS, default: every configured one), so login keeps working if one is down:
//      twilio-verify  Twilio Verify creates, sends and checks the code (pre-registered templates, the easy route for India).
//      twilio         ZIPI creates the code and Twilio Messages delivers it as a normal SMS (needs a DLT sender ID for India).
//      sns            ZIPI creates the code and AWS SNS delivers it (needs DLT sender ID, entity ID and template ID for India).
//      msg91          ZIPI creates the code and MSG91's OTP API delivers it with a DLT-approved template.
//      fast2sms       ZIPI creates the code and Fast2SMS delivers it (route otp: their pre-approved OTP text; route dlt: your template).
//    When ZIPI creates the code it is 6 digits from a cryptographic random source and only an HMAC of phone+code is stored.
//  - Without any provider (development) the code is printed to the log and, while ZIPI_DEV_OTP is on, shown on screen.
import { config } from '../config.js';
import { log, maskPhone } from '../log.js';
import { hmac, safeEqual, randomDigits } from './crypto.js';
import { awsQuery } from './aws.js';

export class OtpError extends Error { constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; } }
class SendError extends Error { constructor(message, { retry = false } = {}) { super(message); this.retry = retry; } }

/* ---------- providers ---------- */
const T = config.twilio, M = config.msg91, A = config.sns, F = config.fast2sms;
const snsEndpoint = () => A.endpoint || `https://sns.${A.region}.amazonaws.com/`;
const sns = params => awsQuery({ endpoint: snsEndpoint(), region: A.region, service: 'sns', params: { Version: '2010-03-31', ...params }, key: A.key, secret: A.secret, token: A.token, timeoutMs: A.timeoutMs });
const twilioAuth = () => 'Basic ' + Buffer.from(`${T.apiKey || T.accountSid}:${T.apiSecret || T.authToken}`).toString('base64');
const twilioReady = () => !!(T.accountSid && (T.authToken || (T.apiKey && T.apiSecret)));
async function twilioPost(url, form) {
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { authorization: twilioAuth(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(T.timeoutMs) }); }
  catch (err) { throw new SendError(`network: ${err.message}`, { retry: true }); }
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}
const e164 = phone => `+91${phone}`;
const smsText = code => {
  if (config.smsText) return config.smsText.replaceAll('{code}', code).replaceAll('{minutes}', String(Math.ceil(config.otp.ttlSec / 60)));
  const host = (() => { try { return config.publicUrl ? new URL(config.publicUrl).host : ''; } catch { return ''; } })();
  // the last line lets Chrome/Android fill the code automatically (WebOTP); it is ignored elsewhere
  return `${code} is your ZIPI login code. Valid for ${Math.ceil(config.otp.ttlSec / 60)} minutes. Do not share it with anyone.${host ? `\n\n@${host} #${code}` : ''}`;
};

export const PROVIDERS = {
  'twilio-verify': {
    kind: 'verify', ready: () => twilioReady() && !!T.verifySid,
    async start(phone) {
      const { status, body } = await twilioPost(`${T.verifyBase}/v2/Services/${T.verifySid}/Verifications`, { To: e164(phone), Channel: 'sms' });
      if (status === 201 || status === 200) return body.sid;
      throw new SendError(`twilio verify ${status} ${body.code || ''} ${body.message || ''}`.trim(), { retry: status >= 500 || status === 429 });
    },
    async check(phone, code) {
      const { status, body } = await twilioPost(`${T.verifyBase}/v2/Services/${T.verifySid}/VerificationCheck`, { To: e164(phone), Code: code });
      if (status === 200) return body.status === 'approved' ? 'ok' : 'wrong';
      if (status === 404) return 'expired'; // Twilio forgets a verification once it expires, is approved or runs out of tries
      if (status === 429) return 'locked';
      throw new SendError(`twilio verify check ${status} ${body.code || ''} ${body.message || ''}`.trim(), { retry: status >= 500 });
    },
  },
  twilio: {
    kind: 'deliver', ready: () => twilioReady() && !!(T.from || T.messagingSid),
    async deliver(phone, code) {
      const { status, body } = await twilioPost(`${T.apiBase}/2010-04-01/Accounts/${T.accountSid}/Messages.json`,
        { To: e164(phone), Body: smsText(code), ...(T.messagingSid ? { MessagingServiceSid: T.messagingSid } : { From: T.from }) });
      if (status === 201 || status === 200) return body.sid;
      throw new SendError(`twilio sms ${status} ${body.code || ''} ${body.message || ''}`.trim(), { retry: status >= 500 || status === 429 });
    },
  },
  sns: {
    kind: 'deliver', ready: () => !!(A.key && A.secret),
    async deliver(phone, code) {
      const attrs = [['AWS.SNS.SMS.SMSType', 'Transactional'], ...(A.senderId ? [['AWS.SNS.SMS.SenderID', A.senderId]] : []),
        ...(A.entityId ? [['AWS.MM.SMS.EntityId', A.entityId]] : []), ...(A.templateId ? [['AWS.MM.SMS.TemplateId', A.templateId]] : [])];
      const params = { Action: 'Publish', PhoneNumber: e164(phone), Message: smsText(code) };
      attrs.forEach(([k, v], i) => { const p = `MessageAttributes.entry.${i + 1}`; params[`${p}.Name`] = k; params[`${p}.Value.DataType`] = 'String'; params[`${p}.Value.StringValue`] = v; });
      let r; try { r = await sns(params); } catch (err) { throw new SendError(`network: ${err.message}`, { retry: true }); }
      if (r.status === 200 && r.get('MessageId')) return r.get('MessageId');
      throw new SendError(`aws sns ${r.status} ${r.code || ''} ${r.message || ''}`.trim(), { retry: r.status >= 500 || r.code === 'Throttling' || r.code === 'ThrottlingException' });
    },
  },
  msg91: {
    kind: 'deliver', ready: () => !!(M.authKey && M.templateId),
    async deliver(phone, code) {
      const url = `${M.url}?template_id=${encodeURIComponent(M.templateId)}&mobile=91${phone}&otp=${code}&otp_expiry=${Math.ceil(config.otp.ttlSec / 60)}&otp_length=6`;
      let r; try { r = await fetch(url, { method: 'POST', headers: { authkey: M.authKey, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ OTP: code }), signal: AbortSignal.timeout(M.timeoutMs) }); }
      catch (err) { throw new SendError(`network: ${err.message}`, { retry: true }); }
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.type !== 'error') return body.request_id || body.message;
      throw new SendError(`msg91 ${r.status} ${body.message || ''}`.trim(), { retry: r.status >= 500 });
    },
  },
  fast2sms: {
    kind: 'deliver', ready: () => !!F.key && (F.route !== 'dlt' || !!(F.senderId && F.templateId)),
    async deliver(phone, code) {
      const body = F.route === 'dlt' ? { route: 'dlt', sender_id: F.senderId, message: F.templateId, variables_values: code, numbers: phone, flash: '0' }
        : { route: 'otp', variables_values: code, numbers: phone, flash: '0' };
      let r; try { r = await fetch(`${F.url}/bulkV2`, { method: 'POST', headers: { authorization: F.key, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(F.timeoutMs) }); }
      catch (err) { throw new SendError(`network: ${err.message}`, { retry: true }); }
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.return === true) return j.request_id || 'sent';
      throw new SendError(`fast2sms ${r.status} ${j.status_code || ''} ${[].concat(j.message || '').join(' ')}`.trim(), { retry: r.status >= 500 });
    },
  },
};
export function activeProviders() {
  const names = config.smsProviders.length ? config.smsProviders : Object.keys(PROVIDERS);
  for (const n of names) if (!PROVIDERS[n]) throw new Error(`Unknown SMS provider "${n}" in SMS_PROVIDERS (use ${Object.keys(PROVIDERS).join(', ')})`);
  return names.filter(n => PROVIDERS[n].ready());
}
// check the SMS settings without sending anything: are the keys right, is the account a trial, does the Verify service exist
export async function checkProviders() {
  const out = [], get = async url => { const r = await fetch(url, { headers: { authorization: twilioAuth(), accept: 'application/json' }, signal: AbortSignal.timeout(T.timeoutMs) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const names = config.smsProviders.length ? config.smsProviders : Object.keys(PROVIDERS);
  if (names.some(n => n.startsWith('twilio')) && (T.accountSid || T.authToken || T.apiKey)) {
    if (!twilioReady()) out.push({ provider: 'twilio', ok: false, msg: 'Set TWILIO_ACCOUNT_SID plus TWILIO_AUTH_TOKEN (or TWILIO_API_KEY + TWILIO_API_SECRET)' });
    else if (!/^AC[0-9a-f]{32}$/i.test(T.accountSid)) out.push({ provider: 'twilio', ok: false, msg: 'TWILIO_ACCOUNT_SID should start with AC and be 34 characters' });
    else {
      try {
        const a = await get(`${T.apiBase}/2010-04-01/Accounts/${T.accountSid}.json`);
        if (a.status === 401 || a.status === 403) out.push({ provider: 'twilio', ok: false, msg: 'Twilio refused the keys (wrong SID, token or API key, or the key was deleted)' });
        else if (a.status !== 200) out.push({ provider: 'twilio', ok: false, msg: `Twilio answered ${a.status}: ${a.body.message || ''}` });
        else {
          out.push({ provider: 'twilio account', ok: a.body.status === 'active', msg: `"${a.body.friendly_name}" is ${a.body.status}, ${a.body.type === 'Trial' ? 'TRIAL: it can only text numbers verified in the Twilio console. Upgrade before launch.' : 'paid account'}` });
          if (names.includes('twilio-verify')) {
            if (!T.verifySid) out.push({ provider: 'twilio-verify', ok: false, msg: 'Not set: add TWILIO_VERIFY_SERVICE_SID (VA...) from Verify > Services' });
            else { const v = await get(`${T.verifyBase}/v2/Services/${T.verifySid}`);
              out.push(v.status === 200 ? { provider: 'twilio-verify', ok: true, msg: `service "${v.body.friendly_name}", ${v.body.code_length}-digit codes${v.body.code_length !== 6 ? ' (WARNING: set code length to 6 in the Twilio console; the login screen has 6 boxes)' : ''}` }
                : { provider: 'twilio-verify', ok: false, msg: v.status === 404 ? 'No Verify service with that SID in this account' : `Twilio answered ${v.status}: ${v.body.message || ''}` }); }
          }
          if (names.includes('twilio') && (T.from || T.messagingSid)) out.push({ provider: 'twilio', ok: true, msg: `SMS from ${T.messagingSid ? 'messaging service ' + T.messagingSid : T.from}${T.from?.startsWith('+1') ? ' (a US number: Indian carriers often block these; use a DLT-registered sender ID)' : ''}` });
        }
      } catch (err) { out.push({ provider: 'twilio', ok: false, msg: `Could not reach Twilio: ${err.message}` }); }
    }
  }
  if (names.includes('sns') && (A.key || A.secret)) {
    if (!PROVIDERS.sns.ready()) out.push({ provider: 'sns', ok: false, msg: 'Set both SNS_ACCESS_KEY_ID and SNS_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)' });
    else {
      try {
        const sb = await sns({ Action: 'GetSMSSandboxAccountStatus' });
        if (sb.status === 403 && /SignatureDoesNotMatch|InvalidClientTokenId|UnrecognizedClient/.test(sb.code || '')) out.push({ provider: 'sns', ok: false, msg: `AWS refused the keys (${sb.code}). Check the access key ID and secret.` });
        else {
          if (sb.status === 200) out.push({ provider: 'sns sandbox', ok: sb.get('IsInSandbox') !== 'true', msg: sb.get('IsInSandbox') === 'true' ? 'SANDBOX: SNS only texts phone numbers verified in the SNS console. Request production access (SNS > Text messaging > Exit SMS sandbox) before launch.' : 'production access (can text any number)' });
          else out.push({ provider: 'sns sandbox', ok: true, msg: `could not read (${sb.code || sb.status}); give the IAM user sns:GetSMSSandboxAccountStatus to see this` });
          const at = await sns({ Action: 'GetSMSAttributes' });
          const limit = at.status === 200 ? (/<key>MonthlySpendLimit<\/key>\s*<value>([^<]*)<\/value>/.exec(at.xml) || [])[1] : null;
          out.push(limit != null ? { provider: 'sns spend limit', ok: +limit > 1, msg: `USD ${limit} per month${+limit <= 1 ? ' (the AWS default; texts stop when it is used up. Ask AWS Support to raise it)' : ''}` }
            : { provider: 'sns spend limit', ok: true, msg: `could not read (${at.code || at.status}); give the IAM user sns:GetSMSAttributes to see this` });
          const missing = [!A.senderId && 'SNS_SENDER_ID', !A.entityId && 'SNS_DLT_ENTITY_ID', !A.templateId && 'SNS_DLT_TEMPLATE_ID'].filter(Boolean);
          out.push({ provider: 'sns india (DLT)', ok: !missing.length, msg: missing.length ? `missing ${missing.join(', ')}: Indian carriers drop SMS without a registered sender ID, entity ID and template ID` : `sender ${A.senderId}, entity ${A.entityId}, template ${A.templateId}` });
          out.push({ provider: 'sns', ok: true, msg: `region ${A.region}` });
        }
      } catch (err) { out.push({ provider: 'sns', ok: false, msg: `Could not reach AWS: ${err.message}` }); }
    }
  }
  if (names.includes('msg91') && PROVIDERS.msg91.ready()) out.push({ provider: 'msg91', ok: true, msg: 'keys set (MSG91 cannot be checked without sending; use test-sms)' });
  if (names.includes('fast2sms') && F.key) {
    if (F.route === 'dlt' && !(F.senderId && F.templateId)) out.push({ provider: 'fast2sms', ok: false, msg: 'FAST2SMS_ROUTE=dlt needs FAST2SMS_SENDER_ID and FAST2SMS_TEMPLATE_ID (the Message ID of your DLT template in Fast2SMS)' });
    else {
      try {
        const r = await fetch(`${F.url}/wallet`, { headers: { authorization: F.key, accept: 'application/json' }, signal: AbortSignal.timeout(F.timeoutMs) });
        const j = await r.json().catch(() => ({}));
        if (j.return === true) out.push({ provider: 'fast2sms', ok: +j.wallet > 0, msg: `key accepted, wallet ₹${j.wallet}${+j.wallet > 0 ? '' : ' (recharge before launch: texts fail with an empty wallet)'}, route ${F.route}` });
        else out.push({ provider: 'fast2sms', ok: false, msg: `Fast2SMS refused the key or answered ${r.status}: ${[].concat(j.message || '').join(' ')}` });
      } catch (err) { out.push({ provider: 'fast2sms', ok: false, msg: `Could not reach Fast2SMS: ${err.message}` }); }
    }
  }
  return out;
}
// one retry for network / server errors, then give up on this provider
async function attempt(name, fn) {
  for (let i = 1; i <= 2; i++) {
    try { return await fn(); }
    catch (err) { log.warn('sms provider failed', { provider: name, attempt: i, err: err.message }); if (!err.retry || i === 2) throw err; }
  }
}

export function makeOtp(db) {
  const C = config.otp;
  const providers = activeProviders();
  if (providers.length) log.info('login SMS', { providers });
  else if (config.prod && !config.devOtp) log.error('no SMS provider is configured: nobody can log in. Set Twilio or MSG91 keys (deploy/DEPLOY.md)');

  // generic fixed-window counter in the ratelimit table
  async function hit(key, max, windowMs) {
    const t = Date.now();
    const r = await db.q(`INSERT INTO ratelimit (k, n, reset_at) VALUES ($1, 1, $2)
      ON CONFLICT (k) DO UPDATE SET n = CASE WHEN ratelimit.reset_at < $3 THEN 1 ELSE ratelimit.n + 1 END,
                                    reset_at = CASE WHEN ratelimit.reset_at < $3 THEN $2 ELSE ratelimit.reset_at END
      RETURNING n, reset_at`, [key, t + windowMs, t]);
    const { n, reset_at } = r.rows[0];
    return { ok: n <= max, retryAfter: Math.ceil((Number(reset_at) - t) / 1000) };
  }

  async function send(phone, ip) {
    const t = Date.now(), prev = await db.get('otps', phone);
    if (prev && t - prev.sentAt < C.resendSec * 1000) { const wait = Math.ceil((C.resendSec * 1000 - (t - prev.sentAt)) / 1000); throw new OtpError(429, `Please wait ${wait} seconds before asking for another code`, wait); }
    for (const [key, max, win, msg] of [[`otp:p10:${phone}`, C.per10min, 600000, 'Too many codes for this number. Try again in a few minutes.'], [`otp:pday:${phone}`, C.perDay, 86400000, 'Daily code limit reached for this number. Try again tomorrow or contact support.'],
      ...(ip ? [[`otp:ip:${ip}`, C.perIp10min, 600000, 'Too many code requests from this network. Try again in 10 minutes.']] : [])]) {
      const r = await hit(key, max, win); if (!r.ok) throw new OtpError(429, msg, r.retryAfter);
    }
    const base = { id: phone, exp: t + C.ttlSec * 1000, tries: 0, sentAt: t };
    let doc = null, code = null;
    const devPhone = !config.prod && config.devOtp && config.devPhones.some(r => { const [a, z = a] = r.split('-'); return phone >= a && phone <= z && phone.length === a.length; });
    if (!providers.length || devPhone) {
      if (config.prod && !config.devOtp) throw new OtpError(503, 'Login by SMS is not set up yet. Please try again later.');
      code = randomDigits(6); doc = { ...base, via: 'dev', hash: hmac(phone + ':' + code) };
      log.info(`dev OTP for ${maskPhone(phone)}: ${code}${devPhone && providers.length ? ' (demo number, no SMS sent)' : ''}`);
    } else {
      for (const name of providers) {
        const p = PROVIDERS[name];
        try {
          if (p.kind === 'verify') { const ref = await attempt(name, () => p.start(phone)); doc = { ...base, via: name, ref }; }
          else { code = randomDigits(6); const ref = await attempt(name, () => p.deliver(phone, code)); doc = { ...base, via: name, ref, hash: hmac(phone + ':' + code) }; }
          log.info('otp sent', { phone: maskPhone(phone), provider: name }); break;
        } catch { code = null; /* try the next provider */ }
      }
      if (!doc) throw new OtpError(502, 'We could not send the SMS right now. Please try again in a minute.');
    }
    if (prev) await db.update('otps', phone, doc); else await db.insert('otps', doc);
    // the on-screen code is only for development; never for a code a real SMS service sent
    return { code: config.devOtp && doc.via === 'dev' ? code : undefined, ttl: C.ttlSec, resendIn: C.resendSec };
  }

  async function verify(phone, code) {
    const o = await db.get('otps', phone);
    if (!o || o.exp < Date.now()) throw new OtpError(400, 'Code expired. Ask for a new one.');
    if (o.tries >= C.maxTries) throw new OtpError(429, 'Too many wrong attempts. Ask for a new code.');
    code = String(code ?? '').trim();
    const wrong = async () => {
      await db.incr('otps', phone, 'tries', 1);
      const left = C.maxTries - o.tries - 1;
      throw new OtpError(400, left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong code. Ask for a new one.');
    };
    if (PROVIDERS[o.via]?.kind === 'verify') {
      if (!/^\d{4,10}$/.test(code)) return wrong();
      let res;
      try { res = await attempt(o.via, () => PROVIDERS[o.via].check(phone, code)); }
      catch { throw new OtpError(502, 'We could not check the code right now. Please try again.'); } // not counted as a wrong try
      if (res === 'expired') { await db.remove('otps', phone); throw new OtpError(400, 'Code expired. Ask for a new one.'); }
      if (res === 'locked') throw new OtpError(429, 'Too many wrong attempts. Ask for a new code.');
      if (res !== 'ok') return wrong();
    } else if (!/^\d{6}$/.test(code) || !o.hash || !safeEqual(hmac(phone + ':' + code), o.hash)) return wrong();
    await db.remove('otps', phone);
    return true;
  }

  return { send, verify, hit, providers: () => providers };
}
