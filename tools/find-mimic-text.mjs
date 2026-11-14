// Find, and with --fix remove, MIMIC report wording in the files this repository tracks.
//
//   node tools/find-mimic-text.mjs                 report only
//   node tools/find-mimic-text.mjs --fix           replace each run with [report wording removed]
//   node tools/find-mimic-text.mjs --corpus a.json --corpus b.json
//   node tools/find-mimic-text.mjs --only .md --fix   only files whose path starts or ends with this
//
// Each run is printed with the number of corpus reports that hold all of it. A run held by many
// reports is standard report phrasing; a run held by one is a quotation of that report.
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
const only = args.flatMap((a, i) => (a === '--only' ? [args[i + 1]] : []));
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

// Each run of WORDS words, and the reports that hold it. The same report may sit in more than one
// corpus file, so reports are counted by text, not by file.
const grams = new Map();
const seenText = new Map();
for (const path of corpora) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  for (const r of data.reports ?? data) {
    if (typeof r.text !== 'string') continue;
    if (!seenText.has(r.text)) seenText.set(r.text, seenText.size);
    const n = seenText.get(r.text);
    const ws = words(r.text);
    for (let i = 0; i + WORDS <= ws.length; i++) {
      const k = key(ws, i);
      if (!grams.has(k)) grams.set(k, new Set());
      grams.get(k).add(n);
    }
  }
}
const reports = seenText.size;

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
  .filter((f) => TEXT_FILES.test(f) && !f.startsWith('tools/find-mimic-text'))
  .filter((f) => !only.length || only.some((p) => f.startsWith(p) || f.endsWith(p)));

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
    // Reports holding every WORDS-word run inside this span (an upper bound on those holding it all).
    let held = null;
    for (let g = i; g + WORDS <= j + 1; g++) {
      const has = grams.get(key(ws, g));
      if (!has) continue;
      held = held ? new Set([...held].filter((x) => has.has(x))) : new Set(has);
    }
    spans.push({ s: ws[i].s, e: ws[j].e, n: j - i + 1, in: held ? held.size : 0 });
    i = j;
  }
  if (!spans.length) continue;
  total += spans.length;
  const lineOf = (pos) => text.slice(0, pos).split('\n').length;
  hit.push(`${f}: ${spans.length} run(s), at line ${spans.map((x) => `${lineOf(x.s)} (${x.n} words, in ${x.in} report${x.in === 1 ? '' : 's'})`).join(', ')}`);
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
