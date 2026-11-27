// Uploaded files (shop photos, partner documents).
//  STORAGE_DRIVER=local  files in DATA_DIR/uploads (single server)
//  STORAGE_DRIVER=s3     any S3-compatible bucket (AWS S3, DigitalOcean Spaces, Cloudflare R2, MinIO) so every server sees
//                        the same files. Requests are signed with AWS Signature V4; no SDK needed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
export const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
export const FILE_RX = /^[a-f0-9]{24}\.(png|jpg|webp|pdf)$/;

export function makeStorage() {
  const s3 = config.storage.driver === 's3' ? makeS3(config.storage.s3) : null;
  const dir = path.join(config.dataDir, 'uploads'); fs.mkdirSync(dir, { recursive: true });
  return {
    driver: s3 ? 's3' : 'local',
    async save(mime, buf) {
      const name = crypto.randomBytes(12).toString('hex') + '.' + EXT[mime];
      if (s3) await s3.put(name, buf, mime); else await fs.promises.writeFile(path.join(dir, name), buf);
      return { name, url: '/uploads/' + name };
    },
    // returns { stream|buffer, size } or null
    async open(name) {
      if (!FILE_RX.test(name)) return null;
      if (s3) { const r = await s3.get(name); return r && { buffer: r, size: r.length }; }
      const f = path.join(dir, name);
      try { const st = await fs.promises.stat(f); return { stream: fs.createReadStream(f), size: st.size }; } catch { return null; }
    },
    async list() {
      if (s3) return s3.list();
      const names = await fs.promises.readdir(dir);
      return Promise.all(names.filter(n => FILE_RX.test(n)).map(async n => { const st = await fs.promises.stat(path.join(dir, n)); return { name: n, bytes: st.size, at: st.mtimeMs, url: '/uploads/' + n }; }));
    },
    async remove(name) {
      if (!FILE_RX.test(name)) return false;
      if (s3) return s3.del(name);
      try { await fs.promises.unlink(path.join(dir, name)); return true; } catch { return false; }
    },
  };
}

function makeS3({ endpoint, region, bucket, key, secret }) {
  if (!bucket || !key || !secret) throw new Error('S3 storage needs S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY');
  const base = new URL(endpoint || `https://s3.${region}.amazonaws.com`);
  const hash = d => crypto.createHash('sha256').update(d).digest('hex');
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  async function req(method, objKey = '', { body = Buffer.alloc(0), type, query = '' } = {}) {
    const u = new URL(`${base.origin}/${bucket}/${objKey}${query ? '?' + query : ''}`);
    const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amz.slice(0, 8), ph = hash(body);
    const headers = { host: u.host, 'x-amz-content-sha256': ph, 'x-amz-date': amz, ...(type ? { 'content-type': type } : {}) };
    const signed = Object.keys(headers).sort();
    const canonQuery = [...u.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const canon = [method, u.pathname, canonQuery, signed.map(h => `${h}:${headers[h]}\n`).join(''), signed.join(';'), ph].join('\n');
    const scope = `${day}/${region}/s3/aws4_request`;
    const sts = ['AWS4-HMAC-SHA256', amz, scope, hash(canon)].join('\n');
    const kSig = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), 's3'), 'aws4_request');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${crypto.createHmac('sha256', kSig).update(sts).digest('hex')}`;
    delete headers.host;
    return fetch(u, { method, headers, body: method === 'PUT' ? body : undefined, signal: AbortSignal.timeout(15000) });
  }
  return {
    async put(name, buf, type) { const r = await req('PUT', 'uploads/' + name, { body: buf, type }); if (!r.ok) throw new Error('S3 upload failed: ' + r.status); },
    async get(name) { const r = await req('GET', 'uploads/' + name); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; },
    async del(name) { const r = await req('DELETE', 'uploads/' + name); return r.ok; },
    async list() {
      const out = []; let token = '';
      do {
        const r = await req('GET', '', { query: `list-type=2&prefix=uploads%2F${token ? '&continuation-token=' + encodeURIComponent(token) : ''}` });
        const x = await r.text();
        for (const m of x.matchAll(/<Contents>[\s\S]*?<Key>uploads\/([^<]+)<\/Key>[\s\S]*?<LastModified>([^<]+)<\/LastModified>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g))
          if (FILE_RX.test(m[1])) out.push({ name: m[1], at: Date.parse(m[2]), bytes: +m[3], url: '/uploads/' + m[1] });
        token = /<IsTruncated>true<\/IsTruncated>/.test(x) ? (/<NextContinuationToken>([^<]+)</.exec(x)?.[1] || '') : '';
      } while (token);
      return out;
    },
  };
}
