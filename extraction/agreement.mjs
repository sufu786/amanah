// Inter-annotator agreement between two independent labellers, per LABELLING.md section 5.
//
// This runs BEFORE resolution and before any model is evaluated. Section 5.4 makes it a gate:
// below kappa 0.75 on the binary question, the protocol is too ambiguous, and the correct action
// is to fix the protocol and relabel, not to resolve the disagreements and carry on. So this exits
// non-zero there, for the same reason smoke.mjs exits non-zero on prompt drift. A gate that only
// prints a warning is a suggestion.
//
//   node agreement.mjs --corpus fixtures/labels-example/reports.json \
//                      --a fixtures/labels-example/labeller-a.json \
//                      --b fixtures/labels-example/labeller-b.json [--json]

import {
  loadCorpus, loadLabelSet, matchBySpan, cohenKappaBinary, intervalsEqual, byLanguage, pct,
} from './labels.mjs';

const KAPPA_GATE = 0.75;

export function agreement(corpusData, setA, setB) {
  const ids = [...corpusData.reports.keys()];

  const binA = ids.map((id) => setA.labels.get(id).recommendations.length > 0);
  const binB = ids.map((id) => setB.labels.get(id).recommendations.length > 0);
  const kappa = cohenKappaBinary(binA, binB);

  const perLanguage = [];
  for (const [lang, langIds] of byLanguage(corpusData, ids)) {
    perLanguage.push({
      language: lang,
      reports: langIds.length,
      ...cohenKappaBinary(
        langIds.map((id) => setA.labels.get(id).recommendations.length > 0),
        langIds.map((id) => setB.labels.get(id).recommendations.length > 0),
      ),
    });
  }

  // Field agreement is computed only over instances both labellers found, because a field cannot
  // be compared on an instance one of them did not record. That restriction flatters these
  // numbers, and it is the reason the instance counts below are printed next to them.
  let matched = 0;
  let findingSame = 0;
  let intervalSame = 0;
  let intervalBothStated = 0;
  let intervalSameWhereStated = 0;
  let actionSame = 0;
  const flagSame = { conditional: 0, negated: 0, already_scheduled: 0 };
  const disagreements = [];

  let instancesA = 0;
  let instancesB = 0;

  for (const id of ids) {
    const recsA = setA.labels.get(id).recommendations;
    const recsB = setB.labels.get(id).recommendations;
    instancesA += recsA.length;
    instancesB += recsB.length;

    const m = matchBySpan(recsA, recsB);
    for (const p of m.pairs) {
      const ra = recsA[p.a];
      const rb = recsB[p.b];
      matched++;
      if (ra.finding === rb.finding) findingSame++;
      else disagreements.push({ report_id: id, field: 'finding', a: ra.finding, b: rb.finding });
      if (ra.action === rb.action) actionSame++;
      else disagreements.push({ report_id: id, field: 'action', a: ra.action, b: rb.action });

      const same = intervalsEqual(ra.interval ?? null, rb.interval ?? null);
      if (same) intervalSame++;
      else {
        disagreements.push({
          report_id: id,
          field: 'interval',
          a: JSON.stringify(ra.interval ?? null),
          b: JSON.stringify(rb.interval ?? null),
        });
      }
      if (ra.interval != null && rb.interval != null) {
        intervalBothStated++;
        if (same) intervalSameWhereStated++;
      }
      for (const f of ['conditional', 'negated', 'already_scheduled']) {
        if (Boolean(ra[f]) === Boolean(rb[f])) flagSame[f]++;
        else disagreements.push({ report_id: id, field: f, a: Boolean(ra[f]), b: Boolean(rb[f]) });
      }
    }
    for (const i of m.unmatchedA) {
      disagreements.push({
        report_id: id, field: 'instance', a: recsA[i].recommendation_verbatim, b: '(not labelled)',
      });
    }
    for (const j of m.unmatchedB) {
      disagreements.push({
        report_id: id, field: 'instance', a: '(not labelled)', b: recsB[j].recommendation_verbatim,
      });
    }
  }

  return {
    reports: ids.length,
    labellers: [setA.labeller, setB.labeller],
    binary_kappa: kappa,
    per_language: perLanguage,
    instances: { a: instancesA, b: instancesB, matched },
    field_agreement: {
      finding: { same: findingSame, of: matched },
      action: { same: actionSame, of: matched },
      interval: { same: intervalSame, of: matched },
      interval_where_both_stated: { same: intervalSameWhereStated, of: intervalBothStated },
      flags: flagSame,
    },
    disagreements,
    gate: {
      threshold: KAPPA_GATE,
      // Undefined kappa does not pass. It means the question was never really put to the
      // labellers, most often because the corpus contains no positives at all.
      passed: kappa.kappa != null && kappa.kappa >= KAPPA_GATE,
    },
  };
}

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };

const corpusPath = get('--corpus');
const aPath = get('--a');
const bPath = get('--b');

if (!corpusPath || !aPath || !bPath) {
  console.error('usage: node agreement.mjs --corpus <reports.json> --a <labels.json> --b <labels.json> [--json]');
  process.exit(2);
}

// Labellers, not Node developers, are the people who hit these. The message already names the
// offending label and the reason; a stack trace on top of it only obscures that.
const load = (fn) => {
  try {
    return fn();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
};

const corpusData = load(() => loadCorpus(corpusPath));
const setA = load(() => loadLabelSet(aPath, corpusData));
const setB = load(() => loadLabelSet(bPath, corpusData));

if (setA.labeller === setB.labeller) {
  console.error(`both files are labelled "${setA.labeller}". Section 5 requires two independent labellers.`);
  process.exit(2);
}
if (setA.resolved || setB.resolved) {
  // Agreement measured after resolution is a measurement of the resolution process, and it always
  // looks excellent. Section 5.3 requires the figure from before.
  console.error('one of these sets is marked resolved. Agreement is reported before resolution, '
    + 'never after, or the number means nothing.');
  process.exit(2);
}

const result = agreement(corpusData, setA, setB);

if (args.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const k = result.binary_kappa;
  console.log(`corpus ${corpusData.corpus}  ${result.reports} reports  `
    + `labellers ${result.labellers.join(' vs ')}`);
  console.log();
  console.log('Binary question: does this report contain at least one recommendation?');
  console.log(`  observed agreement  ${pct(k.po * k.n, k.n)}`);
  console.log(`  chance agreement    ${(k.pe ?? 0).toFixed(3)}`);
  console.log(`  Cohen's kappa       ${k.kappa == null ? 'UNDEFINED' : k.kappa.toFixed(3)}`);
  if (k.undefined_reason) console.log(`    ${k.undefined_reason}`);

  if (result.per_language.length > 1) {
    console.log('\n  per language');
    for (const l of result.per_language) {
      console.log(`    ${l.language.padEnd(6)} n=${String(l.reports).padStart(4)}  `
        + `kappa ${l.kappa == null ? 'undefined' : l.kappa.toFixed(3)}`);
    }
  }

  const f = result.field_agreement;
  console.log(`\nInstances: ${result.instances.a} by ${result.labellers[0]}, `
    + `${result.instances.b} by ${result.labellers[1]}, ${result.instances.matched} matched.`);
  console.log('Field agreement, among matched instances only:');
  console.log(`  finding category    ${pct(f.finding.same, f.finding.of)}  (${f.finding.same}/${f.finding.of})`);
  console.log(`  action              ${pct(f.action.same, f.action.of)}  (${f.action.same}/${f.action.of})`);
  console.log(`  interval            ${pct(f.interval.same, f.interval.of)}  (${f.interval.same}/${f.interval.of})`);
  console.log(`  interval, where both stated one  ${pct(f.interval_where_both_stated.same, f.interval_where_both_stated.of)}`
    + `  (${f.interval_where_both_stated.same}/${f.interval_where_both_stated.of})`);
  for (const [flag, same] of Object.entries(f.flags)) {
    console.log(`  ${flag.padEnd(19)} ${pct(same, f.finding.of)}  (${same}/${f.finding.of})`);
  }

  if (result.disagreements.length) {
    console.log(`\n${result.disagreements.length} disagreement(s) to resolve under section 5.2:`);
    for (const d of result.disagreements.slice(0, 40)) {
      console.log(`  ${d.report_id}  ${d.field}`);
      console.log(`    ${result.labellers[0]}: ${d.a}`);
      console.log(`    ${result.labellers[1]}: ${d.b}`);
    }
    if (result.disagreements.length > 40) {
      console.log(`  ... and ${result.disagreements.length - 40} more, use --json for all`);
    }
  }

  console.log();
  if (result.gate.passed) {
    console.log(`GATE PASSED: kappa >= ${KAPPA_GATE}. Resolve disagreements, then score a model.`);
  } else {
    console.log(`GATE FAILED: kappa is below ${KAPPA_GATE}.`);
    console.log('Section 5.4: fix the protocol and relabel. Do not resolve these disagreements and');
    console.log('proceed to model evaluation on a set the humans cannot agree about.');
  }
}

process.exit(result.gate.passed ? 0 : 1);
