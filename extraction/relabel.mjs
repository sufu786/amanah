// Draw the blind relabel subset, and score the two passes against each other.
//
//   node relabel.mjs draw  --seed amanah-relabel-2026-10-04 --a 70 --b 30 --out-dir relabel/
//   node relabel.mjs check --dir relabel/
//
// LABELLING.md 5a step 2: a subset of at least 100 reports is relabelled blind by the same person,
// after at least two weeks, with the first labels not consulted. CORPUS.md 6.4 records the seed and
// the sizes, committed before this file was written.
//
// The draw produces three files. `reports-relabel.json` is the corpus the labelling tool is pointed
// at. `labels-relabel-pass1.json` is the existing labels for those reports, extracted so the two
// passes can be compared later, and it is not to be opened before the second pass is finished.
// `labels-relabel-pass2.json` does not exist yet: the tool creates it, which is what keeps the pass
// blind. The tool loads only the file named by --out, so pointing it at a fresh path means there
// are no prior labels for it to show.
//
// Blindness is a property of how this is run, not something a program can enforce. What the code
// can do is avoid putting the first labels anywhere the second pass will see them, and that is what
// the file layout above is for.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sortKey } from './corpus.mjs';
import { loadCorpus, loadLabelSet, matchBySpan, cohenKappaBinary } from './labels.mjs';

export const RELABEL_CORPUS = 'mimic-radiology-relabel';

/**
 * Pick the first `n` report ids of a stratum by sha256(seed | id), the ordering corpus.mjs uses for
 * the draw itself. Deterministic, and rederivable by anyone holding the corpus and the seed.
 */
export function pickSubset(reports, seed, n) {
  return reports
    .map((r) => ({ id: r.id, key: sortKey(seed, r.id) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : (a.id < b.id ? -1 : 1)))
    .slice(0, n)
    .map((r) => r.id);
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const get = (f, d = null) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };

  if (cmd === 'draw') {
    const seed = get('--seed');
    const nA = Number(get('--a', '70'));
    const nB = Number(get('--b', '30'));
    const outDir = get('--out-dir', 'C:/mimic/corpus/relabel');
    if (!seed) {
      console.error('usage: node relabel.mjs draw --seed <seed> [--a 70] [--b 30] [--out-dir dir]');
      process.exit(2);
    }

    const picked = [];
    const labelEntries = [];
    for (const [s, n] of [['A', nA], ['B', nB]]) {
      const corpus = JSON.parse(readFileSync(`C:/mimic/corpus/reports-${s}.json`, 'utf8'));
      const labels = JSON.parse(readFileSync(`C:/mimic/corpus/labels-${s}.json`, 'utf8'));
      const ids = new Set(pickSubset(corpus.reports, seed, n));
      picked.push(...corpus.reports.filter((r) => ids.has(r.id)));
      labelEntries.push(...labels.labels.filter((e) => ids.has(e.report_id)));
      console.log(`stratum ${s}: ${ids.size} of ${corpus.reports.length}`);
    }

    // Presented in subset draw order, which is neither stratum order nor the order the first pass
    // saw. Section 6 step 5: stratum membership is not visible to the labeller.
    const order = new Map(picked.map((r) => [r.id, sortKey(seed, r.id)]));
    picked.sort((a, b) => (order.get(a.id) < order.get(b.id) ? -1 : 1));
    const byId = new Map(labelEntries.map((e) => [e.report_id, e]));

    mkdirSync(outDir, { recursive: true });
    const corpusPath = join(outDir, 'reports-relabel.json');
    const pass1Path = join(outDir, 'labels-relabel-pass1.json');
    if (existsSync(corpusPath)) {
      console.error(`${corpusPath} already exists. The subset is drawn once; delete it deliberately `
        + 'if it must be redrawn, and record why in CORPUS.md 6.4.');
      process.exit(1);
    }

    writeFileSync(corpusPath, JSON.stringify({
      corpus: RELABEL_CORPUS,
      note: 'Blind relabel subset under LABELLING.md 5a step 2. See CORPUS.md 6.4.',
      reports: picked,
    }, null, 2) + '\n', 'utf8');

    writeFileSync(pass1Path, JSON.stringify({
      corpus: RELABEL_CORPUS,
      labeller: 'A-pass1',
      protocol_version: '0.1',
      labels: picked.map((r) => byId.get(r.id)),
    }, null, 2) + '\n', 'utf8');

    // Nothing about the first pass is printed. How many of these reports carry an instance is the
    // single most useful thing a labeller could know before relabelling them, and an instruction to
    // ignore a number is not a substitute for not printing it.
    console.log(`\n${picked.length} reports drawn`);
    console.log(`\nwrote ${corpusPath}`);
    console.log(`wrote ${pass1Path}  <- set aside, do not open until pass two is finished`);
    console.log('\nRun the second pass with:');
    console.log(`  node label-server.mjs --corpus ${corpusPath} --out ${join(outDir, 'labels-relabel-pass2.json')}`);
    process.exit(0);
  }

  if (cmd === 'check') {
    const dir = get('--dir', 'C:/mimic/corpus/relabel');
    const corpusData = loadCorpus(join(dir, 'reports-relabel.json'));
    const p1 = loadLabelSet(join(dir, 'labels-relabel-pass1.json'), corpusData);
    const p2 = loadLabelSet(join(dir, 'labels-relabel-pass2.json'), corpusData, { partial: true });

    const ids = [...p2.labels.keys()];
    const binary = (set, id) => (set.labels.get(id)?.recommendations.length ?? 0) > 0;
    const kappa = cohenKappaBinary(
      ids.map((id) => binary(p1, id)),
      ids.map((id) => binary(p2, id)),
    );

    let agreed = 0;
    let instancesP1 = 0;
    let instancesP2 = 0;
    const differing = [];
    for (const id of ids) {
      const a = p1.labels.get(id)?.recommendations ?? [];
      const b = p2.labels.get(id)?.recommendations ?? [];
      instancesP1 += a.length;
      instancesP2 += b.length;
      const { pairs } = matchBySpan(a, b);
      if (a.length === b.length && pairs.length === a.length) agreed++;
      else differing.push(`${id}: pass one ${a.length}, pass two ${b.length}, matched ${pairs.length}`);
    }

    console.log(`reports relabelled      ${ids.length} of ${corpusData.reports.size}`);
    console.log(`instances, pass one     ${instancesP1}`);
    console.log(`instances, pass two     ${instancesP2}`);
    console.log(`same instance count     ${agreed} of ${ids.length}`);
    console.log(`\nintra-rater kappa, "does this report carry at least one recommendation"`);
    console.log(`  kappa ${kappa.kappa === null ? `n/a (${kappa.undefined_reason})` : kappa.kappa.toFixed(3)}`
      + `   observed agreement ${kappa.po === null ? 'n/a' : `${(100 * kappa.po).toFixed(1)}%`}`);
    console.log('\nThis is intra-rater consistency. It is not agreement between people and must not '
      + 'be reported as one. LABELLING.md 5a.');
    if (differing.length) {
      console.log(`\n${differing.length} report(s) differ:`);
      for (const d of differing) console.log(`  ${d}`);
    }
    process.exit(0);
  }

  console.error('usage: node relabel.mjs draw|check ...');
  process.exit(2);
}
