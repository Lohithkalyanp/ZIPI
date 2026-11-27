#!/usr/bin/env node
// Reproduce the p-center benchmark of the dispatch solver on the OR-Library pmed instances.
//   1. download pmedN.txt files from https://people.brunel.ac.uk/~mastjjb/jeb/orlib/pmedinfo.html into a folder
//   2. node scripts/bench-pcenter.js <folder> [secondsPerRun=10] [instances=1,2,3]
import fs from 'node:fs';
import path from 'node:path';
import { solvePCenter } from '../src/app/dispatch.js';
const OPT = [0, 127, 98, 93, 74, 48, 84, 64, 55, 37, 20, 59, 51, 36, 26, 18, 47, 39, 28, 18, 13, 40, 38, 22, 15, 11, 38, 32, 18, 13, 9, 30, 29, 15, 11, 30, 27, 15, 29, 23, 13];
const [dir, sec = '10', list = Array.from({ length: 40 }, (_, i) => i + 1).join(',')] = process.argv.slice(2);
if (!dir) { console.log('Usage: node scripts/bench-pcenter.js <folder with pmedN.txt> [secondsPerRun] [1,2,3]'); process.exit(1); }
let hits = 0, gaps = 0, n_ = 0;
for (const i of list.split(',').map(Number)) {
  const file = path.join(dir, `pmed${i}.txt`); if (!fs.existsSync(file)) { console.log(`pmed${i}: file missing`); continue; }
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
  const [n, , p] = rows[0], D = new Float64Array(n * n).fill(1e9);
  for (let v = 0; v < n; v++) D[v * n + v] = 0;
  for (const [a, b, w] of rows.slice(1)) { D[(a - 1) * n + b - 1] = w; D[(b - 1) * n + a - 1] = w; }
  for (let k = 0; k < n; k++) for (let a = 0; a < n; a++) { const dak = D[a * n + k]; if (dak >= 1e9) continue; for (let b = 0; b < n; b++) { const v = dak + D[k * n + b]; if (v < D[a * n + b]) D[a * n + b] = v; } }
  const r = solvePCenter(D, n, p, { timeMs: +sec * 1000, seed: i });
  const gap = 100 * (r.radius - OPT[i]) / OPT[i]; gaps += gap; n_++; if (r.radius === OPT[i]) hits++;
  console.log(`pmed${i}\tn=${n}\tp=${p}\toptimum=${OPT[i]}\tGA=${r.gaRadius}\trefined=${r.radius}\t${gap ? gap.toFixed(2) + '%' : 'optimal'}`);
}
console.log(`\n${hits}/${n_} optimal, average gap ${(gaps / Math.max(1, n_)).toFixed(2)}%`);
