// Runs the fixtures in fixtures/smoke.json through the extractor and checks the behaviours that
// matter most: no invented recommendations on clean reports, no invented intervals, no invented
// dates, and correct flagging of conditional / negated / already-scheduled follow-up.
//
// This is a smoke test. It does not measure performance; that requires a labelled corpus under
// LABELLING.md. It answers a narrower question: do the safety-critical failure modes behave?
//
//   node smoke.mjs [--model qwen2.5:3b-instruct-q4_K_M]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extract } from './extract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, 'fixtures', 'smoke.json'), 'utf8'));

const args = process.argv.slice(2);
const mi = args.indexOf('--model');
const model = mi === -1 ? undefined : args[mi + 1];

const results = [];
let totalMs = 0;

for (const c of suite.cases) {
  const out = await extract(c.report, { model, language: c.language });
  totalMs += out.elapsed_ms;

  const fails = [];
  const e = c.expect;
  const recs = out.recommendations;

  if (e.recommendation_count !== undefined && recs.length !== e.recommendation_count) {
    fails.push(`count ${recs.length}, expected ${e.recommendation_count}`);
  }
  if (e.no_recommendation_found !== undefined
      && out.extraction.no_recommendation_found !== e.no_recommendation_found) {
    fails.push(`no_recommendation_found ${out.extraction.no_recommendation_found}, expected ${e.no_recommendation_found}`);
  }
  if ('date_found' in e && out.document.date_found !== e.date_found) {
    fails.push(`date_found ${JSON.stringify(out.document.date_found)}, expected ${JSON.stringify(e.date_found)}`);
  }
  if ('interval' in e && recs.length > 0) {
    const got = recs[0].interval;
    const want = e.interval;
    const same = want === null
      ? got === null
      : got && got.value === want.value && got.unit === want.unit;
    if (!same) fails.push(`interval ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  }
  if (e.finding && recs.length > 0 && recs[0].finding !== e.finding) {
    fails.push(`finding ${recs[0].finding}, expected ${e.finding}`);
  }
  if (e.action && recs.length > 0 && recs[0].action !== e.action) {
    fails.push(`action ${recs[0].action}, expected ${e.action}`);
  }
  for (const flag of ['conditional', 'negated', 'already_scheduled']) {
    if (e[flag] !== undefined && recs.length > 0 && recs[0][flag] !== e[flag]) {
      fails.push(`${flag} ${recs[0][flag]}, expected ${e[flag]}`);
    }
  }

  // Span integrity is non-negotiable regardless of what the fixture expects: the verification
  // screen depends on it, and a bad span means a fabricated quote got through.
  for (const r of recs) {
    const [s, en] = r.recommendation_span ?? [];
    if (c.report.slice(s, en).replace(/\s+/g, ' ').trim()
        !== r.recommendation_verbatim.replace(/\s+/g, ' ').trim()) {
      fails.push('SPAN MISMATCH on recommendation_verbatim');
    }
  }

  results.push({ id: c.id, fails, out });

  const mark = fails.length === 0 ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${c.id}  (${(out.elapsed_ms / 1000).toFixed(1)}s, ${recs.length} rec, ${out.rejected.length} rejected)`);
  for (const f of fails) console.log(`        ${f}`);
  for (const r of recs) {
    const iv = r.interval ? `${r.interval.value} ${r.interval.unit}` : 'null';
    console.log(`        -> [${r.finding}/${r.action}] interval=${iv} conf=${r.confidence.toFixed(2)} "${r.recommendation_verbatim.slice(0, 70)}"`);
  }
  for (const rj of out.rejected) {
    console.log(`        -> REJECTED ${rj.reason}${rj.quote ? `: "${String(rj.quote).slice(0, 60)}"` : ''}`);
  }
}

const passed = results.filter(r => r.fails.length === 0).length;
console.log(`\n${passed}/${results.length} passed   total ${(totalMs / 1000).toFixed(1)}s   mean ${(totalMs / results.length / 1000).toFixed(1)}s/report`);

// The clean-report cases are the ones that matter most. Report them separately.
const cleanIds = ['clean-normal', 'finding-no-recommendation', 'boilerplate-only'];
const clean = results.filter(r => cleanIds.includes(r.id));
const falsePositives = clean.filter(r => r.out.recommendations.length > 0);
console.log(`false positives on clean reports: ${falsePositives.length}/${clean.length}` +
  (falsePositives.length ? `  (${falsePositives.map(r => r.id).join(', ')})` : ''));

process.exit(passed === results.length ? 0 : 1);
