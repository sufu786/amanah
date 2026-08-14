// Scores extractor output against the resolved gold standard, per LABELLING.md section 6.
//
// Six metrics, reported separately and never combined. There is deliberately no F1 in this file:
// section 6 rules it out because recall and precision have different clinical consequences here.
// A miss is false reassurance; a false positive is an invented obligation. Averaging them asserts
// the two are interchangeable, and they are not.
//
//   node score.mjs --corpus <reports.json> --gold <resolved-labels.json> \
//                  --predictions <predictions.json> [--json]
//
// Predictions are saved extract.mjs output rather than a live model call, so that the matching
// rule can change and be re-scored against the same inference run. See loadPredictions.

import {
  loadCorpus, loadLabelSet, loadPredictions, matchBySpan, intervalsEqual, byLanguage, pct,
} from './labels.mjs';

// Section 6: never pool a language with fewer than this many labelled reports into a combined
// figure. A combined number carried by one well-resourced language is how a system gets deployed
// into a language nobody measured.
const MIN_POOL = 200;

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export function computeMetrics(corpusData, gold, preds, ids) {
  let goldInstances = 0;
  let predInstances = 0;
  let matched = 0;

  let cleanReports = 0;
  let cleanReportsWithPrediction = 0;

  let categorySame = 0;
  let intervalSame = 0;
  let intervalGoldStated = 0;
  let intervalSameWhereGoldStated = 0;
  let intervalDeidentified = 0;
  let intervalScorable = 0;

  let spansExact = 0;
  let spansNormalised = 0;

  let unparseable = 0;
  let rejected = 0;
  let mergedPredictions = 0;

  const flags = {
    conditional: { same: 0, missed: 0 },
    negated: { same: 0, missed: 0 },
    already_scheduled: { same: 0, missed: 0 },
  };

  const misses = [];
  const falsePositives = [];

  for (const id of ids) {
    const report = corpusData.reports.get(id);
    const goldRecs = gold.labels.get(id).recommendations;
    const out = preds.byReport.get(id);
    const predRecs = out.recommendations ?? [];

    goldInstances += goldRecs.length;
    predInstances += predRecs.length;
    rejected += (out.rejected ?? []).length;
    if (out.extraction?.unparseable) unparseable++;

    if (goldRecs.length === 0) {
      cleanReports++;
      if (predRecs.length > 0) {
        cleanReportsWithPrediction++;
        for (const r of predRecs) {
          falsePositives.push({ report_id: id, quote: r.recommendation_verbatim, confidence: r.confidence });
        }
      }
    }

    for (const r of predRecs) {
      const [s, e] = r.recommendation_span ?? [];
      const sliced = report.text.slice(s, e);
      if (sliced === r.recommendation_verbatim) spansExact++;
      if (norm(sliced) === norm(r.recommendation_verbatim)) spansNormalised++;
    }

    const m = matchBySpan(goldRecs, predRecs);
    matched += m.pairs.length;

    // One prediction covering two labelled instances. RESULTS.md defect 1, counted rather than
    // absorbed: the second obligation is real and was lost.
    const predUseCount = new Map();
    for (const p of m.pairs) predUseCount.set(p.b, (predUseCount.get(p.b) ?? 0) + 1);
    for (const gi of m.unmatchedA) {
      const g = goldRecs[gi];
      const covered = predRecs.some((r) => {
        const [ps, pe] = r.recommendation_span ?? [0, 0];
        const [gs, ge] = g.recommendation_span;
        return ps <= gs && pe >= ge;
      });
      if (covered) mergedPredictions++;
      misses.push({
        report_id: id,
        quote: g.recommendation_verbatim,
        finding: g.finding,
        action: g.action,
        negated: Boolean(g.negated),
        already_scheduled: Boolean(g.already_scheduled),
        swallowed_by_a_merged_prediction: covered,
      });
    }
    for (const pj of m.unmatchedB) {
      if (goldRecs.length > 0) {
        falsePositives.push({
          report_id: id,
          quote: predRecs[pj].recommendation_verbatim,
          confidence: predRecs[pj].confidence,
        });
      }
    }

    for (const p of m.pairs) {
      const g = goldRecs[p.a];
      const r = predRecs[p.b];
      if (g.finding === r.finding) categorySame++;
      // A de-identified interval is excluded from interval accuracy entirely. 7,687 reports in
      // MIMIC-IV-Note carry a real recommendation whose interval the de-identification replaced
      // with ___, as in "repeat Chest CT in ___ weeks". The correct label is interval null with
      // the placeholder kept in interval_verbatim, and an extractor that returns null there is
      // right for a reason that has nothing to do with its ability to read an interval. Counting
      // it as a correct null inflates the figure with cases where there was nothing to read. It
      // is an artefact of the corpus and would not occur in deployment. See LABELLING.md 7.1.
      const deidentifiedInterval = /___/.test(g.interval_verbatim ?? '');
      if (deidentifiedInterval) {
        intervalDeidentified++;
      } else {
        const same = intervalsEqual(g.interval ?? null, r.interval ?? null);
        if (same) intervalSame++;
        intervalScorable++;
        if (g.interval != null) {
          intervalGoldStated++;
          if (same) intervalSameWhereGoldStated++;
        }
      }
      for (const f of Object.keys(flags)) {
        if (Boolean(g[f]) === Boolean(r[f])) flags[f].same++;
        else if (Boolean(g[f]) && !r[f]) flags[f].missed++;
      }
    }
  }

  return {
    reports: ids.length,
    gold_instances: goldInstances,
    predicted_instances: predInstances,
    matched,

    detection_recall: { n: matched, of: goldInstances },
    detection_precision: { n: matched, of: predInstances },
    false_positive_rate_on_clean_reports: { n: cleanReportsWithPrediction, of: cleanReports },
    interval_accuracy: { n: intervalSame, of: intervalScorable },
    interval_accuracy_where_gold_states_one: { n: intervalSameWhereGoldStated, of: intervalGoldStated },
    interval_excluded_deidentified: intervalDeidentified,
    category_accuracy: { n: categorySame, of: matched },
    span_validity_exact: { n: spansExact, of: predInstances },
    span_validity_whitespace_normalised: { n: spansNormalised, of: predInstances },

    flags,
    merged_predictions: mergedPredictions,
    rejected_by_verbatim_check: rejected,
    unparseable_reports: unparseable,
    misses,
    false_positives: falsePositives,
  };
}

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };

const corpusPath = get('--corpus');
const goldPath = get('--gold');
const predPath = get('--predictions');

if (!corpusPath || !goldPath || !predPath) {
  console.error('usage: node score.mjs --corpus <reports.json> --gold <labels.json> --predictions <predictions.json> [--json]');
  process.exit(2);
}

// The people who hit these errors are labellers, not Node developers. A stack trace tells them
// nothing they can act on, and the message already says exactly which label is wrong and why.
const load = (fn) => {
  try {
    return fn();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
};

const corpusData = load(() => loadCorpus(corpusPath));
const gold = load(() => loadLabelSet(goldPath, corpusData));
const preds = load(() => loadPredictions(predPath, corpusData));

if (!gold.resolved) {
  // Scoring against one labeller's independent pass measures agreement with that person, not
  // correctness, and it silently skips the kappa gate in section 5.4.
  console.error(`${goldPath} is not marked resolved. Score against the post-resolution gold `
    + 'standard produced under section 5.2, after agreement.mjs has passed.');
  process.exit(2);
}

const missing = [...corpusData.reports.keys()].filter((id) => !preds.byReport.has(id));
if (missing.length) {
  console.error(`predictions missing for ${missing.length} report(s): ${missing.slice(0, 5).join(', ')}`);
  console.error('Scoring a subset silently changes every denominator. Run the extractor over the whole corpus.');
  process.exit(2);
}

const groups = byLanguage(corpusData, [...corpusData.reports.keys()]);
const perLanguage = [...groups.entries()].map(([language, ids]) => ({
  language,
  eligible_for_pooling: ids.length >= MIN_POOL,
  ...computeMetrics(corpusData, gold, preds, ids),
}));

const poolable = [...groups.entries()].filter(([, ids]) => ids.length >= MIN_POOL);
const excluded = [...groups.entries()]
  .filter(([, ids]) => ids.length < MIN_POOL)
  .map(([lang, ids]) => `${lang} (n=${ids.length})`);
const pooled = poolable.length
  ? computeMetrics(corpusData, gold, preds, poolable.flatMap(([, ids]) => ids))
  : null;

const report = {
  corpus: corpusData.corpus,
  model: preds.model,
  prompt_version: preds.prompt_version,
  protocol_version: '0.1',
  min_reports_to_pool: MIN_POOL,
  per_language: perLanguage,
  pooled,
  languages_excluded_from_pooled: excluded,
};

if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const line = (label, m) => console.log(`  ${label.padEnd(38)} ${pct(m.n, m.of).padStart(6)}  (${m.n}/${m.of})`);

// The model is printed first and unconditionally. There is no such thing as an extraction metric
// independent of the model and prompt that produced it, and a table circulated without them is a
// table that will eventually be read as a property of the system.
console.log(`corpus ${report.corpus}`);
console.log(`model ${report.model ?? '(UNRECORDED)'}   prompt v${report.prompt_version ?? '(UNRECORDED)'}   protocol v0.1`);

// Section 5c. The same reasoning as the model line above it: a metric is not independent of the
// ground truth it was scored against. A reader given the recall but not told that one person wrote
// every label has a number without what is needed to weigh it.
{
  const l = gold.labelling;
  const people = `${l.labellers} labeller${l.labellers === 1 ? '' : 's'}`;
  const agreement = {
    reported: `agreement between people reported${l.inter_rater_kappa != null ? `, kappa ${l.inter_rater_kappa}` : ''}`,
    not_measured: 'agreement between people NOT measured',
    intra_rater_only: `agreement between people NOT measured; intra-rater consistency only${l.intra_rater_kappa != null ? `, kappa ${l.intra_rater_kappa}` : ''}`,
  }[l.agreement];
  console.log(`labels ${people}, ${agreement}`);
  if (l.note) console.log(`  ${l.note}`);
}

for (const m of perLanguage) {
  console.log(`\n=== ${m.language}  (${m.reports} reports, ${m.gold_instances} labelled instances) ===`);
  line('false positives on clean reports', m.false_positive_rate_on_clean_reports);
  line('detection recall', m.detection_recall);
  line('detection precision', m.detection_precision);
  line('interval accuracy', m.interval_accuracy);
  line('  where gold states an interval', m.interval_accuracy_where_gold_states_one);
  if (m.interval_excluded_deidentified) {
    console.log(`  ${m.interval_excluded_deidentified} matched instance(s) excluded from interval`);
    console.log('  accuracy: the interval was de-identified to ___, so there was nothing to read');
  }
  line('category accuracy', m.category_accuracy);
  line('span validity, exact', m.span_validity_exact);
  line('span validity, whitespace-normalised', m.span_validity_whitespace_normalised);

  if (m.span_validity_exact.n !== m.span_validity_exact.of) {
    console.log('  span validity is below 100%: the verification screen would highlight text that');
    console.log('  is not what was extracted. Treat as a defect, not a metric.');
  }
  console.log(`  supplementary: ${m.merged_predictions} labelled instance(s) swallowed by a merged `
    + `prediction, ${m.rejected_by_verbatim_check} rejected by the verbatim check, `
    + `${m.unparseable_reports} unparseable`);
  for (const [f, v] of Object.entries(m.flags)) {
    console.log(`    flag ${f.padEnd(18)} agreed on ${v.same}/${m.matched} matched, missed ${v.missed}`);
  }
}

if (pooled) {
  console.log(`\n=== pooled (languages with n >= ${MIN_POOL} only) ===`);
  line('false positives on clean reports', pooled.false_positive_rate_on_clean_reports);
  line('detection recall', pooled.detection_recall);
  line('detection precision', pooled.detection_precision);
} else {
  console.log(`\nNo pooled figure. No language reaches ${MIN_POOL} labelled reports.`);
}
if (excluded.length) {
  console.log(`Excluded from any pooled figure: ${excluded.join(', ')}`);
}

console.log('\nNo F1 is reported. Section 6: recall and precision have different clinical');
console.log('consequences and must not be traded against each other silently.');

if (pooled === null && perLanguage.every((m) => m.gold_instances === 0)) {
  console.log('\nThis corpus contains no labelled recommendations, so recall is not measured here,');
  console.log('only false positives. That was the Open-i result. See RESULTS.md.');
}
