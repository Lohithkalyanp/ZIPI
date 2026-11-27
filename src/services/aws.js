// Minimal AWS Signature V4 signing for query-style AWS APIs (SNS), so no AWS SDK is needed.
// Checked against the worked example in the AWS docs (IAM ListUsers, see scripts/check-aws-sign.js).
import crypto from 'node:crypto';

const sha = d => crypto.createHash('sha256').update(d).digest('hex');
const mac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** returns the headers to send (including authorization) */
export function signV4({ method = 'POST', url, region, service, body = '', headers = {}, key, secret, token, now = new Date() }) {
  const u = new URL(url), amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amz.slice(0, 8);
  const h = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, 'x-amz-date': amz, ...(token ? { 'x-amz-security-token': token } : {}) };
  const names = Object.keys(h).sort();
  const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canon = [method, u.pathname || '/', query, names.map(n => `${n}:${h[n]}\n`).join(''), names.join(';'), sha(body)].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canon)].join('\n');
  const kSig = mac(mac(mac(mac('AWS4' + secret, day), region), service), 'aws4_request');
  h.authorization = `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${names.join(';')}, Signature=${crypto.createHmac('sha256', kSig).update(toSign).digest('hex')}`;
  delete h.host; // fetch sets it
  return h;
}

/** call a query-style AWS API (form-encoded POST, XML answer). Returns { status, xml, code, message, get(tag) } */
export async function awsQuery({ endpoint, region, service, params, key, secret, token, timeoutMs = 8000 }) {
  const body = new URLSearchParams(params).toString();
  const headers = signV4({ url: endpoint, region, service, body, key, secret, token, headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' } });
  const r = await fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const xml = await r.text();
  const get = tag => (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml) || [])[1];
  return { status: r.status, xml, code: get('Code'), message: get('Message'), get };
}
