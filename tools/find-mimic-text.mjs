// Find, and with --fix remove, MIMIC report wording in the files this repository tracks.
//
//   node tools/find-mimic-text.mjs                 report only
//   node tools/find-mimic-text.mjs --fix           replace each run with [report wording removed]
//   node tools/find-mimic-text.mjs --corpus a.json --corpus b.json
//
// The MIMIC data use agreement does not allow report text to be redistributed, and PhysioNet has not
// said whether short quotations are allowed. So none is kept: any run of WORDS or more consecutive
// words that also occurs in a corpus report counts as report wording, wherever it appears.
//
// Only file names, line numbers and counts are printed, never the matched text, so the output can be
// shared or pasted without repeating any report. The corpus is read from your own copy and goes
// nowhere. Exit status 1 when anything is found, so this can run before a release.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const WORDS = 8;
const REPLACEMENT = '[report wording removed]';
const TEXT_FILES = /\.(md|mjs|js|json|cff|html|svg|txt|ya?ml)$/i;
const DEFAULT_DIRS = ['C:/mimic/corpus', 'C:/mimic/pilot'];

const args = process.argv.slice(2);
const fix = args.includes('--fix');
let corpora = args.flatMap((a, i) => (a === '--corpus' ? [args[i + 1]] : []));
if (!corpora.length) {
  corpora = DEFAULT_DIRS.filter(existsSync).flatMap((d) => readdirSync(d)
    .filter((f) => /^reports-.*\.json$/.test(f)).map((f) => join(d, f)));
}
if (!corpora.length) {
  console.error('No corpus found. Pass --corpus <reports.json>, one per file.');
  process.exit(2);
}

const words = (text) => [...text.matchAll(/[a-z0-9]+/gi)].map((m) => ({ w: m[0].toLowerCase(), s: m.index, e: m.index + m[0].length }));
const key = (ws, i) => ws.slice(i, i + WORDS).map((x) => x.w).join(' ');

const grams = new Set();
let reports = 0;
for (const path of corpora) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  for (const r of data.reports ?? data) {
    if (typeof r.text !== 'string') continue;
    reports++;
    const ws = words(r.text);
    for (let i = 0; i + WORDS <= ws.length; i++) grams.add(key(ws, i));
  }
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
  .filter((f) => TEXT_FILES.test(f) && !f.startsWith('tools/find-mimic-text'));

let total = 0;
const hit = [];
for (const f of files) {
  const path = join(root, f);
  const text = readFileSync(path, 'utf8');
  const ws = words(text);
  // Mark every word covered by a matching run, then join covered words into spans.
  const covered = new Array(ws.length).fill(false);
  for (let i = 0; i + WORDS <= ws.length; i++) {
    if (grams.has(key(ws, i))) for (let j = i; j < i + WORDS; j++) covered[j] = true;
  }
  const spans = [];
  for (let i = 0; i < ws.length; i++) {
    if (!covered[i]) continue;
    let j = i;
    while (j + 1 < ws.length && covered[j + 1]) j++;
    spans.push({ s: ws[i].s, e: ws[j].e, n: j - i + 1 });
    i = j;
  }
  if (!spans.length) continue;
  total += spans.length;
  const lineOf = (pos) => text.slice(0, pos).split('\n').length;
  hit.push(`${f}: ${spans.length} run(s), at line ${spans.map((x) => `${lineOf(x.s)} (${x.n} words)`).join(', ')}`);
  if (fix) {
    let out = text;
    for (const x of spans.reverse()) out = out.slice(0, x.s) + REPLACEMENT + out.slice(x.e);
    writeFileSync(path, out, 'utf8');
  }
}

console.log(`Read ${reports} reports from ${corpora.length} corpus file(s); checked ${files.length} tracked files.`);
if (!total) {
  console.log('No report wording found.');
} else {
  for (const h of hit) console.log(h);
  console.log(`${total} run(s) of ${WORDS} or more words from a report${fix ? ', each replaced' : ''}.`);
  if (!fix) process.exit(1);
}
