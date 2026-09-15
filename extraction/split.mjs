// Cut a stratum into its development and test splits, by draw position.
//
//   node split.mjs --reports reports-A.json --labels labels-A.json --out-dir split/
//
// Writes reports-A-dev.json, reports-A-test.json, labels-A-dev.json and labels-A-test.json, each a
// complete corpus or gold standard that score.mjs accepts on its own. score.mjs refuses a
// predictions file that does not cover every report in its corpus, so a split has to be a corpus in
// its own right rather than a filter applied at scoring time.
//
// The cut points are CORPUS.md section 6.1, written into this file rather than taken as arguments.
// A split that can be passed on the command line can be re-rolled after seeing a result, and 6.1
// assigned by position precisely so that it could not be.
//
// The source label file is left untouched. Its hash is recorded in CORPUS.md 6.3 as the gold
// standard, and the split files carry that hash in their declaration so a split can be traced back
// to the labels it was cut from.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadCorpus, loadLabelSet } from './labels.mjs';

/** CORPUS.md section 6.1: the first n reports of each stratum, in draw order, are development. */
export const DEV_POSITIONS = {
  'mimic-radiology-A': 105,
  'mimic-radiology-B': 45,
};

/**
 * Split a corpus and its label set at `nDev`. Pure: returns the four documents and writes nothing.
 * Throws unless the labels cover the corpus in the same order, because a position split over two
 * files in different orders would put a report's labels in the other split from its text.
 */
export function splitByPosition(corpus, labels, nDev, declaration) {
  const reports = corpus.reports;
  const entries = labels.labels;
  if (!Number.isInteger(nDev) || nDev < 1 || nDev >= reports.length) {
    throw new Error(`development size ${nDev} does not cut a corpus of ${reports.length}`);
  }
  if (entries.length !== reports.length
      || entries.some((e, i) => e.report_id !== reports[i].id)) {
    throw new Error('labels are not in corpus draw order, or do not cover the corpus exactly');
  }

  const part = (name, from, to) => ({
    reports: { ...corpus, corpus: `${corpus.corpus}-${name}`, reports: reports.slice(from, to) },
    labels: {
      corpus: `${corpus.corpus}-${name}`,
      labeller: labels.labeller,
      protocol_version: labels.protocol_version,
      resolved: true,
      labelling: declaration,
      labels: entries.slice(from, to),
    },
  });
  return { dev: part('dev', 0, nDev), test: part('test', nDev, reports.length) };
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
  const reportsPath = get('--reports');
  const labelsPath = get('--labels');
  const outDir = get('--out-dir');
  if (!reportsPath || !labelsPath || !outDir) {
    console.error('usage: node split.mjs --reports <reports.json> --labels <labels.json> --out-dir <dir>');
    process.exit(2);
  }

  const labelBytes = readFileSync(labelsPath);
  const corpus = JSON.parse(readFileSync(reportsPath, 'utf8'));
  const labels = JSON.parse(labelBytes);
  const nDev = DEV_POSITIONS[corpus.corpus];
  if (!nDev) {
    console.error(`no development size recorded for corpus "${corpus.corpus}" in CORPUS.md 6.1`);
    process.exit(2);
  }

  // Section 5c. What a number scored against these labels means depends on how they were made.
  const declaration = {
    labellers: 1,
    agreement: 'not_measured',
    intra_rater_kappa: null,
    inter_rater_kappa: null,
    note: `Cut from ${labelsPath.split(/[\\/]/).pop()} sha256 `
      + `${createHash('sha256').update(labelBytes).digest('hex')} at position ${nDev} (CORPUS.md 6.1). `
      + 'Full draw under section 5a, one labeller. Intra-rater consistency (5a step 2) is not yet '
      + 'measured. Precedents 7.18 to 7.27 were written after labelling and applied back by a '
      + 'field-level consistency check; rules a pattern cannot check have not yet been applied back '
      + 'by re-reading (5a step 4). MODEL ASSISTANCE, ADVISORY (section 5d): every call was made by '
      + 'the labeller; a language model was shown report text the labeller chose, checked calls '
      + 'against section 7, and drafted precedent text from the labeller\'s decisions. Its agreement '
      + 'with the labeller is not an inter-annotator statistic. Section 5b has not been done. See '
      + 'CORPUS.md 6.3.',
  };

  const { dev, test } = splitByPosition(corpus, labels, nDev, declaration);
  mkdirSync(outDir, { recursive: true });
  const suffix = corpus.corpus.replace(/^mimic-radiology-/, '');
  for (const [name, part] of [['dev', dev], ['test', test]]) {
    const rp = join(outDir, `reports-${suffix}-${name}.json`);
    const lp = join(outDir, `labels-${suffix}-${name}.json`);
    writeFileSync(rp, JSON.stringify(part.reports, null, 2) + '\n', 'utf8');
    writeFileSync(lp, JSON.stringify(part.labels, null, 2) + '\n', 'utf8');
    // The split is only useful if the scorer accepts it, so the scorer's own loader checks it here.
    const g = loadLabelSet(lp, loadCorpus(rp));
    const positives = [...g.labels.values()].filter((e) => e.recommendations.length).length;
    console.log(`${name.padEnd(4)} ${part.reports.reports.length} reports, ${positives} positive  ${rp}`);
  }
}
