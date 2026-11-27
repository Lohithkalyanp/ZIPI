// Structured logging: one JSON object per line in production (ready for CloudWatch, Loki, Datadog),
// readable lines in development. Never log OTPs, tokens or full phone numbers.
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[config.logLevel] ?? 20;
const pid = process.pid;

function write(level, msg, fields = {}) {
  if (LEVELS[level] < min) return;
  if (fields.err instanceof Error) fields = { ...fields, err: { message: fields.err.message, stack: fields.err.stack?.split('\n').slice(0, 6).join('\n') } };
  if (config.prod) {
    process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, pid, msg, ...fields }) + '\n');
  } else {
    const extra = Object.keys(fields).length ? ' ' + JSON.stringify(fields) : '';
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${new Date().toISOString().slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${extra}\n`);
  }
}
export const log = {
  debug: (m, f) => write('debug', m, f), info: (m, f) => write('info', m, f),
  warn: (m, f) => write('warn', m, f), error: (m, f) => write('error', m, f),
};
export const maskPhone = p => (p ? String(p).slice(0, 2) + '••••••' + String(p).slice(-2) : '');
