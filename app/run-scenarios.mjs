// Run the five invented reports through the app, with the real model, answering as a careful patient.
//
//   node app/run-scenarios.mjs [--model <name>] [--out <file.md>] [--dry]
//
// --dry reads nothing: the model is replaced by one that finds nothing, so every recommendation is
// added by hand. It checks the run itself in seconds before the model's turn.
//
// This stands in for the parts of the volunteer test that do not need a person (PHASE2_SAFETY.md
// section 3a). It drives the same server the page talks to, through the same requests, with a store
// in a temporary folder. It checks two different things and keeps them apart:
//
//   The app's rules. Things the app must always do whatever the model reads: list the date of birth
//   beside the report date and choose neither, show the may-have-missed notice, refuse a save with an
//   item unanswered, keep a condition as a question, ask before closing, refuse a scan by name. A
//   failure here is a defect, and the run exits 1.
//
//   The model's reading. Which recommendations it marked, doubted or missed, which details it got
//   right, and what it marked that asks for nothing. These are observations on five reports, not a
//   measurement; Phase 1 is the measurement.
//
// What this cannot do is the reason the volunteer test was designed: say whether a person notices
// what the app missed, or understands what a screen says. The careful patient here is a script that
// already knows the answers.

import { createServer, request } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from './server.mjs';
import { REGIONS } from './closing.mjs';
import { MAY_HAVE_MISSED } from './checking.mjs';
import { makePdf } from './fixtures.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { modalityCode } from '../obligation/modality.mjs';
import { DEFAULT_MODEL, extractReport } from '../extraction/pipeline.mjs';

const args = process.argv.slice(2);
const get = (f, d = null) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
const model = get('--model', DEFAULT_MODEL);
const outPath = get('--out');

const storePath = join(mkdtempSync(join(tmpdir(), 'amanah-scenarios-')), 'obligations.json');
const dry = args.includes('--dry');
const extract = dry ? (text, o) => extractReport(text, { ...o, stages: { detect: async () => ({ hits: [], asked: 0 }) } }) : extractReport;
const server = createServer(createApp({ storePath, model, extract }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = request({
      host: '127.0.0.1', port, path, method,
      headers: { host: `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw.startsWith('{') ? JSON.parse(raw) : raw }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const checks = [];
const rule = (scenario, what, ok, note = '') => checks.push({ scenario, what, ok: Boolean(ok), note });
const observations = [];

const spanOf = (text, quote) => { const s = text.indexOf(quote); return s === -1 ? null : [s, s + quote.length]; };
const overlaps = (a, b) => a && b && a[0] < b[1] && b[0] < a[1];
const sameInterval = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fieldsRight = (item, key) => Boolean(item.conditional) === Boolean(key.conditional) && fieldsMatch(item, key.details);
const fieldsMatch = (item, d) => item.action === d.action && modalityCode(item.modality) === modalityCode(d.modality) && sameInterval(item.interval, d.interval);
const TIER = { first: 'marked', second: 'marked, less sure', negated: 'read as not needed' };

// Every answer key is checked before anything is read, so a key that does not match its report
// stops the run at once rather than after minutes of reading.
for (const sc of SCENARIOS) {
  if (sc.study.region && !(sc.study.region in REGIONS)) throw new Error(`scenario ${sc.id}: unknown region ${sc.study.region}`);
  for (const r of sc.recommendations) {
    if (!sc.text.includes(r.quote)) throw new Error(`scenario ${sc.id}: the answer key quote is not in the report`);
  }
}

const obligationsOf = {};
const studyOf = {};

for (const sc of SCENARIOS) {
  const started = Date.now();
  const keys = sc.recommendations.map((r) => {
    const span = spanOf(sc.text, r.quote);
    if (!span) throw new Error(`scenario ${sc.id}: the answer key quote is not in the report`);
    return { ...r, span };
  });

  const start = await call('POST', '/api/start', { text: sc.text });
  const offered = start.body.dates.map((d) => d.date);
  rule(sc.id, 'the report date is offered', offered.includes(sc.report_date));
  if (sc.decoy_date) {
    rule(sc.id, 'the date of birth is listed too, with its words, and nothing is chosen for the patient',
      offered.includes(sc.decoy_date) && start.body.dates.every((d) => typeof d.context === 'string') && !('chosen' in start.body));
  }

  let job;
  do {
    await new Promise((r) => setTimeout(r, 2000));
    job = (await call('GET', `/api/job?id=${start.body.job}`)).body;
  } while (job.status === 'reading');
  if (job.status !== 'done') throw new Error(`scenario ${sc.id}: ${job.error}`);

  const check = (await call('POST', '/api/check', { job: start.body.job, date: sc.report_date })).body;
  rule(sc.id, 'the may-have-missed notice is shown', check.notices.includes(MAY_HAVE_MISSED));
  const shown = [...check.items, ...check.less_sure, ...check.not_needed];

  // The careful patient: yes to a sentence that asks for something, no to one that does not, the
  // details corrected where the app has them wrong, and anything the app did not mark added by hand.
  const decisions = [];
  const seen = new Set();
  const found = [];
  let falseItems = 0;
  for (const item of shown) {
    const key = keys.find((k) => overlaps(k.span, item.span));
    if (!key) { falseItems++; decisions.push({ id: item.id, answer: 'no' }); continue; }
    seen.add(key);
    const right = !item.needs_details && fieldsRight(item, key);
    found.push({ quote: key.quote, how: TIER[item.tier], right, typed: Boolean(item.needs_details), by_rule: Object.keys(item.filled_by ?? {}).filter((k) => item.filled_by[k] === 'rule') });
    decisions.push({ id: item.id, answer: 'yes', ...(right ? {} : { details: { ...key.details, conditional: Boolean(key.conditional) } }) });
  }
  const added = keys.filter((k) => !seen.has(k)).map((k) => ({ span: k.span, details: { ...k.details, conditional: Boolean(k.conditional) } }));
  for (const k of keys.filter((x) => !seen.has(x))) found.push({ quote: k.quote, how: 'missed, added by the patient', right: null, typed: true, by_rule: [] });

  if (decisions.length) {
    const partial = await call('POST', '/api/save', { job: start.body.job, decisions: decisions.slice(1), added, study: sc.study });
    rule(sc.id, 'a save with an item unanswered is refused', partial.status === 400 && /every item/.test(partial.body.error));
  }
  const saved = await call('POST', '/api/save', { job: start.body.job, decisions, added, study: sc.study });
  if (saved.status !== 200) throw new Error(`scenario ${sc.id}: save refused: ${saved.body.error}`);

  for (const k of keys) {
    const flat = (s) => s.replace(/\s+/g, ' ');
    if (k.conditional) {
      rule(sc.id, 'a conditional recommendation is kept as a question, with no due date',
        saved.body.notes.some((n) => flat(n.quote).includes(flat(k.quote)) || flat(k.quote).includes(flat(n.quote)))
        && !saved.body.saved.some((o) => overlaps(spanOf(sc.text, o.quote), k.span)));
    } else {
      const o = saved.body.saved.find((x) => overlaps(spanOf(sc.text, x.quote), k.span));
      rule(sc.id, `"${flat(k.quote)}" is saved with the right due date`, o && o.due_date === k.due, o ? `due ${o.due_date}` : 'not saved');
    }
  }
  obligationsOf[sc.id] = saved.body.saved;

  const list = (await call('GET', '/api/obligations')).body;
  if (sc.follow_up_of) {
    const earlier = SCENARIOS.find((x) => x.id === sc.follow_up_of);
    const ob = list.obligations.find((o) => o.document_date === earlier.report_date);
    const q = list.questions.find((x) => x.obligation_id === ob?.id);
    const cand = q?.candidates.find((c) => c.date === sc.report_date);
    rule(sc.id, 'the earlier follow-up is asked about, not closed', ob && cand && ob.tone !== 'closed');
    if (cand) {
      await call('POST', '/api/close', { id: ob.id, study_id: cand.study_id });
      const after = (await call('GET', '/api/obligations')).body.obligations.find((o) => o.id === ob.id);
      rule(sc.id, 'after the patient says yes, it is closed, and can be reopened', after.tone === 'closed'
        && (await call('POST', '/api/reopen', { id: ob.id })).status === 200);
    }
    const scan = await call('POST', '/api/pdf', { data: makePdf([[]]).toString('base64') });
    rule(sc.id, 'a scanned PDF is refused by name, never read as a report with nothing in it', scan.status === 400 && scan.body.kind === 'no_text');
  } else {
    rule(sc.id, 'a report is not asked about as the follow-up of its own follow-ups',
      !list.questions.some((x) => list.obligations.find((o) => o.id === x.obligation_id)?.document_date === sc.report_date));
  }
  studyOf[sc.id] = sc.study;

  observations.push({ id: sc.id, purpose: sc.purpose, seconds: Math.round((Date.now() - started) / 1000), found, falseItems });
}
server.close();

const lines = [];
lines.push(`${dry ? 'DRY RUN, no model. ' : ''}Model ${model}. Run ${new Date().toLocaleDateString('en-CA')}.`, '');
lines.push('### The app\'s rules', '', '| Report | Rule | Held |', '|---|---|---|');
for (const c of checks) lines.push(`| ${c.scenario} | ${c.what}${c.note ? ` (${c.note})` : ''} | ${c.ok ? 'yes' : '**NO**'} |`);
lines.push('', '### The model\'s reading', '', '| Report | Recommendation | What the app did | Details right as shown | Typed by the patient | Read by rule |', '|---|---|---|---|---|---|');
for (const o of observations) {
  for (const f of o.found) {
    lines.push(`| ${o.id} | ${f.quote.replace(/\s+/g, ' ')} | ${f.how} | ${f.right === null ? '' : f.right ? 'yes' : 'no'} | ${f.typed ? 'yes' : 'no'} | ${f.by_rule.join(', ')} |`);
  }
  if (!o.found.length) lines.push(`| ${o.id} | (none in this report) | | | | |`);
}
lines.push('', '| Report | Items shown that ask for nothing | Seconds to read |', '|---|---|---|');
for (const o of observations) lines.push(`| ${o.id} | ${o.falseItems} | ${o.seconds} |`);
const md = lines.join('\n') + '\n';
console.log(md);
if (outPath) writeFileSync(outPath, md, 'utf8');

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `${failed.length} rule(s) did not hold.` : `All ${checks.length} rules held.`);
process.exit(failed.length ? 1 : 0);
