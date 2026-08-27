// Run the whole-report extractor across a corpus and write a predictions file.
//
//   node run-corpus.mjs --corpus reports.json --out predictions.json [--model M] [--limit N]
//
// extract.mjs handles one report. This runs it over a drawn corpus and produces the file score.mjs
// reads. Inference is kept separate from scoring on purpose: a scoring rule can change and be
// re-scored against the same inference run, and re-running inference to answer a question about
// arithmetic would be both slow and a quiet way to change two things at once.
//
// The numbers for prompt v0.1 and v0.2 in RESULTS.md were produced with this file.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { extract, PROMPT_VERSION } from './extract.mjs';

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (!isMain) {
  throw new Error('run-corpus.mjs is a command, not a module. Import extract.mjs instead.');
}

const args = process.argv.slice(2);
const get = (f, d = null) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
const corpusPath = get('--corpus');
const outPath = get('--out');
const model = get('--model', 'qwen2.5:7b-instruct-q4_K_M');
const limit = Number(get('--limit', '0')) || Infinity;

if (!corpusPath || !outPath) {
  console.error('usage: node run-corpus.mjs --corpus <reports.json> --out <predictions.json> '
    + '[--model M] [--limit N]');
  process.exit(2);
}

const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
const reports = (corpus.reports ?? corpus).slice(0, limit);

const predictions = [];
let failed = 0;
const started = Date.now();

for (const [i, r] of reports.entries()) {
  const t0 = Date.now();
  let output;
  try {
    output = await extract(r.text, { model, language: 'en' });
  } catch (err) {
    // A failed report is recorded rather than dropped. A predictions file missing a report and one
    // where the model found nothing are different claims, and the loader is entitled to tell them
    // apart.
    failed++;
    output = { error: String(err?.message ?? err) };
  }
  predictions.push({ report_id: r.id, output });
  console.log(`[${String(i + 1).padStart(3)}/${reports.length}] ${r.id.padEnd(18)} `
    + `${output.recommendations?.length ?? 0} rec, ${output.rejected?.length ?? 0} rejected, `
    + `${Date.now() - t0}ms${output.error ? '  ERROR: ' + output.error : ''}`);
}

writeFileSync(outPath, JSON.stringify({
  // The corpus name must match the gold standard's, or score.mjs refuses the pair. That check
  // exists because scoring one corpus against another's labels produces numbers rather than errors.
  corpus: corpus.corpus ?? corpusPath,
  model,
  prompt_version: PROMPT_VERSION,
  predictions,
}, null, 2) + '\n', 'utf8');

console.log(`\nwrote ${outPath}: ${predictions.length} reports, ${failed} errored, `
  + `${((Date.now() - started) / 1000).toFixed(0)}s`);
