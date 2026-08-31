// A local labelling tool. Serves a page on 127.0.0.1 and writes label files to disk.
//
//   node label-server.mjs --corpus C:/mimic/pilot/reports-A.json --out C:/mimic/pilot/labels-A.json
//
// NOTHING LEAVES THE MACHINE. The server binds to 127.0.0.1 only, so it is unreachable from the
// network. It makes no outbound request of any kind. The page it serves loads no fonts, no scripts
// and no styles from anywhere. This matters because the corpus is MIMIC, held under a data use
// agreement that is per person, and a labelling tool that quietly posted a report somewhere would
// be a breach rather than a bug.
//
// WHY THE BROWSER VALIDATES NOTHING
//
// The page collects a selection and some dropdown values and sends them here. Every check runs on
// this side, through the same loadLabelSet that gates scoring. A label the scorer would reject
// cannot be saved, so the failure surfaces while the report is still on screen and the labeller
// can see what they meant, rather than hours later against a file of five hundred.
//
// The check that matters most is the span round-trip. A span off by two characters still loads,
// still looks well-formed, and points at the wrong sentence. Here the span comes from the
// browser's own selection offsets into text this server sent, and is then verified against that
// same text before anything is written.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadCorpus, loadLabelSet, sha256, findRepeats, spanOverlap, PROTOCOL_VERSION,
} from './labels.mjs';
import { FINDING_CATEGORIES, ACTIONS } from './extract.mjs';
import { sortKey } from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Build one report's label entry from what the page sent.
 *
 * Exported for testing. Everything here is a pure function of the request and the corpus text, so
 * the interesting failures can be provoked without a browser.
 */
export function buildEntry(report, body) {
  const recommendations = (body.recommendations ?? []).map((r, i) => {
    const span = r.recommendation_span;
    if (!Array.isArray(span) || span.length !== 2) {
      throw new Error(`recommendation ${i + 1}: no text selected for the recommendation`);
    }
    const [s, e] = span;
    const quoted = report.text.slice(s, e);
    if (!quoted.trim()) throw new Error(`recommendation ${i + 1}: the selected span is empty`);

    // The span is authoritative and the quote is derived from it, never the other way round. If
    // the page ever sent a quote that disagreed with its own offsets, taking the offsets means the
    // stored label matches the report rather than matching what a widget believed.
    const out = {
      recommendation_verbatim: quoted,
      recommendation_span: [s, e],
      finding_verbatim: null,
      finding_span: null,
      anatomy: r.anatomy?.trim() || null,
      modality: r.modality?.trim() || null,
      interval: null,
      interval_verbatim: r.interval_verbatim?.trim() || null,
      finding: r.finding,
      action: r.action,
      conditional: Boolean(r.conditional),
      negated: Boolean(r.negated),
      already_scheduled: Boolean(r.already_scheduled),
    };

    if (Array.isArray(r.finding_span) && r.finding_span.length === 2) {
      const [fs, fe] = r.finding_span;
      const f = report.text.slice(fs, fe);
      if (f.trim()) {
        out.finding_verbatim = f;
        out.finding_span = [fs, fe];
      }
    }

    if (r.interval_value !== '' && r.interval_value != null && r.interval_unit) {
      const value = Number(r.interval_value);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`recommendation ${i + 1}: interval value must be a positive number`);
      }
      out.interval = { value, unit: r.interval_unit };
      if (!out.interval_verbatim) {
        throw new Error(`recommendation ${i + 1}: an interval was entered but the words it was read `
          + 'from were not quoted. Section 4 requires interval_verbatim whenever a value is given.');
      }
      // Section 7.1. A de-identified interval has no readable number, so a value here would be a
      // guess, which is the one thing section 4 forbids outright.
      if (out.interval_verbatim.includes('___')) {
        throw new Error(`recommendation ${i + 1}: interval_verbatim contains a de-identified `
          + 'placeholder, so no value can be read from it. Leave the value empty and keep the '
          + 'placeholder quoted. See LABELLING.md 7.1.');
      }
    }

    if (!FINDING_CATEGORIES.includes(out.finding)) {
      throw new Error(`recommendation ${i + 1}: pick a finding category`);
    }
    if (!ACTIONS.includes(out.action)) {
      throw new Error(`recommendation ${i + 1}: pick an action`);
    }
    return out;
  });

  // Section 7.6. A recommendation stated twice is one instance, labelled from the impression, and
  // an extractor quoting the other copy has found the same duty. The labeller is not asked to hunt
  // for the duplicate: it is derived here by searching for the same sentence, whitespace-
  // insensitively, so it is deterministic and invents nothing.
  //
  // The guard matters more than the derivation. Where two instances carry the same wording against
  // different findings, an occurrence belongs to whichever instance quoted it, so anything landing
  // on another instance's canonical span is dropped rather than claimed by both.
  const canonical = recommendations.map((r) => r.recommendation_span);
  for (const [i, rec] of recommendations.entries()) {
    const repeats = findRepeats(report.text, rec.recommendation_span)
      .filter((span) => !canonical.some((c, j) => j !== i && spanOverlap(span, c) > 0));
    if (repeats.length) rec.equivalent_spans = repeats;
  }

  return {
    report_id: report.id,
    text_sha256: sha256(report.text),
    date_found: body.date_found?.trim() || null,
    recommendations,
    ...(body.note?.trim() ? { note: body.note.trim() } : {}),
  };
}

function main() {
  const args = process.argv.slice(2);
  const get = (f, d = null) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
  const labeller = get('--labeller', 'A');
  const port = Number(get('--port', '7777'));
  const orderSeed = get('--order-seed', 'amanah-labelling-order');

  // --corpus and --out may each be given more than once, one pair per stratum. Serving the strata
  // together is what makes section 6 step 5 possible: a labeller who knows a report came from the
  // cue-enriched stratum expects to find something, and expecting to find something is how the C1
  // boundary gets crossed. One file at a time would tell them by construction.
  const pairs = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--corpus') pairs.push({ corpusPath: args[i + 1], outPath: null });
    if (args[i] === '--out') {
      const open = pairs.filter((x) => x.outPath === null).at(-1);
      if (open) open.outPath = args[i + 1];
    }
  }
  if (!pairs.length || pairs.some((x) => !x.outPath)) {
    console.error('usage: node label-server.mjs --corpus <reports.json> --out <labels.json>');
    console.error('                             [--corpus <more.json> --out <more-labels.json>]');
    console.error('                             [--labeller A] [--port 7777] [--order-seed S]');
    console.error('');
    console.error('Give one --corpus/--out pair per stratum. Reports are served in one shuffled');
    console.error('order with the stratum hidden, and each label is written to its own file.');
    process.exit(2);
  }

  for (const s of pairs) s.data = loadCorpus(s.corpusPath);

  // One shuffled order across every stratum, keyed by the same sha256(seed | id) the draw uses.
  // Deterministic, so the order a labeller saw is reproducible rather than merely asserted.
  const reports = pairs
    .flatMap((s) => [...s.data.reports.values()].map((r) => ({ ...r, _source: s })))
    .map((r) => ({ ...r, _key: sortKey(orderSeed, r.id) }))
    .sort((a, b) => (a._key < b._key ? -1 : a._key > b._key ? 1 : 0));

  // Resume. A seventeen-hour job that loses its place on a crash is a job nobody finishes.
  for (const s of pairs) {
    s.entries = new Map();
    if (existsSync(s.outPath)) {
      const existing = JSON.parse(readFileSync(s.outPath, 'utf8'));
      for (const e of existing.labels ?? []) s.entries.set(e.report_id, e);
    }
  }
  const doneCount = () => pairs.reduce((n, s) => n + s.entries.size, 0);
  if (doneCount()) console.log(`resuming: ${doneCount()} of ${reports.length} already labelled`);

  // Each stratum keeps its own label set on disk. Section 6 forbids pooling them for scoring, so
  // they are never pooled in storage either: a file that exists cannot be scored by mistake.
  // Labels are written in the stratum's own draw order, not the shuffled presentation order.
  const writeOut = () => {
    for (const s of pairs) {
      const doc = {
        corpus: s.data.corpus,
        labeller,
        protocol_version: PROTOCOL_VERSION,
        labels: [...s.data.reports.values()]
          .filter((r) => s.entries.has(r.id))
          .map((r) => s.entries.get(r.id)),
      };
      mkdirSync(dirname(s.outPath), { recursive: true });
      writeFileSync(s.outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

      // Validated by the loader that gates scoring. `partial` because a set in progress is
      // legitimately incomplete; everything else is checked exactly as it will be when scored.
      loadLabelSet(s.outPath, s.data, { partial: true });
    }
  };

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/label.html')) {
      return send(res, 200, readFileSync(join(here, 'label.html'), 'utf8'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/data') {
      // Section 6 step 5. The stratum a report was drawn from is deliberately absent here, not
      // merely unused by the page: a labeller who could read it from the network tab would be as
      // biased as one who was told.
      return send(res, 200, {
        corpus: pairs.map((s) => s.data.corpus).join(' + '),
        labeller,
        findings: FINDING_CATEGORIES,
        actions: ACTIONS,
        reports: reports.map((r) => ({ id: r.id, text: r.text, modality: r.modality ?? null })),
        done: pairs.flatMap((s) => [...s.entries.keys()]),
        entries: Object.fromEntries(pairs.flatMap((s) => [...s.entries])),
      });
    }

    if (req.method === 'POST' && url.pathname === '/save') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        try {
          const body = JSON.parse(raw);
          const source = pairs.find((s) => s.data.reports.has(body.report_id));
          if (!source) throw new Error(`unknown report ${body.report_id}`);
          const report = source.data.reports.get(body.report_id);
          const entries = source.entries;
          const entry = buildEntry(report, body);
          const previous = entries.get(report.id);
          entries.set(report.id, entry);
          try {
            writeOut();
          } catch (e) {
            // Put it back. A rejected label must not leave the file in a state the scorer refuses.
            if (previous) entries.set(report.id, previous); else entries.delete(report.id);
            writeOut();
            throw e;
          }
          send(res, 200, { ok: true, done: doneCount(), entry });
        } catch (e) {
          send(res, 400, { ok: false, error: e.message });
        }
      });
      return undefined;
    }

    return send(res, 404, { error: 'not found' });
  });

  // 127.0.0.1 explicitly, never 0.0.0.0. The corpus is credentialed data and this must not be
  // reachable from anything but this machine.
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Labelling ${reports.length} reports from ${pairs.map((s) => s.data.corpus).join(' + ')}`);
    for (const s of pairs) console.log(`    ${s.data.corpus} -> ${s.outPath}`);
    console.log(`\n  Open  http://127.0.0.1:${port}\n`);
    console.log('  Bound to 127.0.0.1 only. Nothing is sent anywhere else.');
    console.log('  Every save is validated by the same loader that gates scoring.');
    console.log(`  Order shuffled by seed "${orderSeed}"; which stratum a report came from is`);
    console.log('  not sent to the page at all (section 6 step 5).\n');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
