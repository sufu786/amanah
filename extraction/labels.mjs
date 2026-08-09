// Shared machinery for the labelling harness: loading, validation, instance matching and kappa.
//
// Used by agreement.mjs (two labellers against each other, before resolution) and score.mjs
// (extractor against the resolved gold standard). Both need identical matching, because a
// disagreement figure computed one way and a recall figure computed another are not comparable,
// and the temptation to quietly use a looser rule for whichever number looks bad is exactly the
// failure LABELLING.md was written before any model ran to prevent.
//
// Nothing here is a metric. Metrics live in the two callers, reported separately per section 6.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FINDING_CATEGORIES, ACTIONS } from './extract.mjs';

export const PROTOCOL_VERSION = '0.1';
const INTERVAL_UNITS = ['day', 'week', 'month', 'year'];

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path}: ${e.message}`);
  }
};

/**
 * A corpus is the text the spans point into. It is loaded separately from the labels so that two
 * labellers, and the extractor, are demonstrably working over identical characters.
 */
export function loadCorpus(path) {
  const raw = readJson(path);
  if (!raw.corpus || !Array.isArray(raw.reports)) {
    throw new Error(`${path}: expected { corpus, reports: [...] }`);
  }
  const reports = new Map();
  for (const r of raw.reports) {
    if (!r.id || typeof r.text !== 'string') {
      throw new Error(`${path}: every report needs an id and text`);
    }
    if (reports.has(r.id)) throw new Error(`${path}: duplicate report id ${r.id}`);
    reports.set(r.id, {
      id: r.id,
      language: r.language ?? 'en',
      text: r.text,
      sha256: sha256(r.text),
    });
  }
  return { corpus: raw.corpus, reports };
}

/**
 * Load one labeller's set and validate it hard.
 *
 * Validation is not a convenience. An invalid span is the single most dangerous defect available
 * here: it round-trips to the wrong sentence, which means the verification screen would highlight
 * text the patient never had recommended, and it does so while looking entirely well-formed. So a
 * bad span is a load failure, never a warning.
 *
 * Every error is collected before throwing. A labeller fixing thirty spans one exception at a time
 * is a labeller who stops labelling.
 */
export function loadLabelSet(path, corpusData, { partial = false } = {}) {
  const raw = readJson(path);
  const errs = [];
  const push = (msg) => errs.push(`${path}: ${msg}`);

  if (raw.corpus !== corpusData.corpus) {
    push(`corpus is "${raw.corpus}", expected "${corpusData.corpus}"`);
  }
  if (raw.protocol_version !== PROTOCOL_VERSION) {
    push(`protocol_version is "${raw.protocol_version}", expected "${PROTOCOL_VERSION}"`);
  }
  if (!raw.labeller) push('missing labeller');
  if (!Array.isArray(raw.labels)) push('missing labels array');

  const labels = new Map();
  // Entries rejected above are not also reported as missing below. "You did not label this" sent
  // to someone who did label it, and got it rejected two lines earlier, is a wrong instruction.
  const rejectedIds = new Set();
  for (const [n, entry] of (raw.labels ?? []).entries()) {
    const where = `label[${n}] (${entry.report_id ?? 'no report_id'})`;
    const report = corpusData.reports.get(entry.report_id);
    if (!report) {
      push(`${where}: report_id not present in the corpus`);
      continue;
    }
    if (labels.has(entry.report_id)) {
      push(`${where}: duplicate label for this report`);
      continue;
    }
    if (entry.text_sha256 && entry.text_sha256 !== report.sha256) {
      // The corpus text changed after labelling. Every offset in this entry now points somewhere
      // else, so the labels are wrong rather than stale, and there is no safe way to auto-repair.
      push(`${where}: text_sha256 does not match the corpus text. The text changed after `
        + `labelling; these spans no longer point where the labeller looked. Relabel or restore `
        + `the original text.`);
      rejectedIds.add(entry.report_id);
      continue;
    }
    if (!Array.isArray(entry.recommendations)) {
      push(`${where}: missing recommendations array (use [] for a report with none)`);
      rejectedIds.add(entry.report_id);
      continue;
    }

    for (const [k, rec] of entry.recommendations.entries()) {
      const rw = `${where} rec[${k}]`;
      if (typeof rec.recommendation_verbatim !== 'string' || !rec.recommendation_verbatim) {
        push(`${rw}: recommendation_verbatim must be a non-empty string`);
      }
      validateSpan(rw, 'recommendation', rec.recommendation_span, rec.recommendation_verbatim,
        report.text, push);
      if (rec.finding_verbatim != null || rec.finding_span != null) {
        validateSpan(rw, 'finding', rec.finding_span, rec.finding_verbatim, report.text, push);
      }
      if (!FINDING_CATEGORIES.includes(rec.finding)) {
        push(`${rw}: finding "${rec.finding}" is not in the controlled vocabulary`);
      }
      if (!ACTIONS.includes(rec.action)) {
        push(`${rw}: action "${rec.action}" is not in the controlled vocabulary`);
      }
      if (rec.interval != null) {
        const iv = rec.interval;
        if (!Number.isFinite(iv.value) || iv.value <= 0 || !INTERVAL_UNITS.includes(iv.unit)) {
          push(`${rw}: interval must be {value > 0, unit in ${INTERVAL_UNITS.join('|')}} or null`);
        }
      }
    }

    labels.set(entry.report_id, {
      report_id: entry.report_id,
      date_found: entry.date_found ?? null,
      recommendations: entry.recommendations,
      note: entry.note ?? null,
    });
  }

  // Section 1: reports with no recommendation are not optional. A set that silently omits them
  // measures nothing about false positives, which is the headline figure.
  //
  // Section 5 as amended allows a second labeller to cover only an agreement subset, so a partial
  // set is legitimate for that labeller and only that labeller. It is never legitimate for the
  // gold standard, which has to cover the corpus it is scored against. `partial` is opt-in for
  // that reason: the caller has to say which case it is, rather than the loader guessing from
  // whether anything happens to be missing.
  const missing = [...corpusData.reports.keys()]
    .filter((id) => !labels.has(id) && !rejectedIds.has(id));
  if (missing.length && !partial) {
    push(`${missing.length} corpus report(s) unlabelled: ${missing.slice(0, 5).join(', ')}`
      + `${missing.length > 5 ? ', ...' : ''}. A report with no recommendation is labelled with `
      + `an empty array, not left out. If this is a second labeller covering only the agreement `
      + `subset (section 5), load it with {partial: true}.`);
  }

  // Section 5c. A gold standard has to say how it was made, because that is part of what a number
  // scored against it means. Required only on a resolved set: an individual labeller's pass is not
  // ground truth for anything and has nothing to declare yet.
  if (raw.resolved) {
    const l = raw.labelling;
    const AGREEMENT = ['reported', 'not_measured', 'intra_rater_only'];
    if (!l || typeof l !== 'object') {
      push('a resolved set must declare how it was made: '
        + '{labelling: {labellers, agreement}}. See section 5c. score.mjs prints this above every '
        + 'metrics table and will not run without it.');
    } else {
      if (!Number.isInteger(l.labellers) || l.labellers < 1) {
        push('labelling.labellers must be a positive integer');
      }
      if (!AGREEMENT.includes(l.agreement)) {
        push(`labelling.agreement must be one of ${AGREEMENT.join(', ')}`);
      }
      if (l.agreement === 'reported' && l.labellers < 2) {
        push('labelling.agreement is "reported" but only one labeller is declared. Agreement '
          + 'between people cannot be measured by one person.');
      }
      if (l.agreement !== 'reported' && typeof l.inter_rater_kappa === 'number') {
        push('labelling.inter_rater_kappa is set but agreement was not reported. Section 5a is '
          + 'explicit that an intra-rater figure is never presented as agreement between people.');
      }
    }
  }

  if (errs.length) throw new Error(`invalid label set\n  ${errs.join('\n  ')}`);

  return {
    corpus: raw.corpus,
    labeller: raw.labeller,
    resolved: Boolean(raw.resolved),
    labelling: raw.labelling ?? null,
    labels,
  };
}

function validateSpan(where, field, span, verbatim, text, push) {
  if (!Array.isArray(span) || span.length !== 2
      || !Number.isInteger(span[0]) || !Number.isInteger(span[1])) {
    push(`${where}: ${field}_span must be [start, end] integers`);
    return;
  }
  const [s, e] = span;
  if (s < 0 || e > text.length || s >= e) {
    push(`${where}: ${field}_span [${s}, ${e}] is out of range for a ${text.length}-char report`);
    return;
  }
  if (typeof verbatim === 'string' && text.slice(s, e) !== verbatim) {
    push(`${where}: ${field}_span does not round-trip.\n`
      + `      span says: ${JSON.stringify(text.slice(s, e))}\n`
      + `      label says: ${JSON.stringify(verbatim)}`);
  }
}

/**
 * Predictions are extract.mjs output, saved rather than regenerated.
 *
 * Scoring reads a file instead of calling the model, so that a change to the matching rule below
 * can be re-scored against the same inference run. Otherwise every adjustment to how a match is
 * counted silently rides on a fresh set of model outputs, and nobody can tell which of the two
 * moved the number.
 */
export function loadPredictions(path, corpusData) {
  const raw = readJson(path);
  if (raw.corpus !== corpusData.corpus) {
    throw new Error(`${path}: corpus is "${raw.corpus}", expected "${corpusData.corpus}"`);
  }
  if (!Array.isArray(raw.predictions)) throw new Error(`${path}: missing predictions array`);

  const byReport = new Map();
  for (const p of raw.predictions) {
    if (!corpusData.reports.has(p.report_id)) {
      throw new Error(`${path}: prediction for unknown report ${p.report_id}`);
    }
    byReport.set(p.report_id, p.output);
  }
  return {
    model: raw.model ?? null,
    prompt_version: raw.prompt_version ?? null,
    byReport,
  };
}

export const spanOverlap = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
};

/**
 * Match two lists of recommendation instances over the same report, by character overlap of the
 * recommendation span, one-to-one, greedily, largest overlap first.
 *
 * The rule is stated here because it determines every number downstream.
 *
 *   - Any overlap counts. Both parties are quoting the same sentence, so requiring a threshold
 *     mostly punishes where a quote starts, which is not what is being measured.
 *   - One-to-one. A single prediction spanning two labelled instances matches one and leaves the
 *     other a miss. That is the intended reading: the merged-recommendation defect in RESULTS.md
 *     loses a real obligation, and the metric must show it as a loss rather than absorb it.
 *   - Deterministic ties. Sorted by overlap, then by index on both sides, so the same inputs give
 *     the same pairing on every machine and every run.
 */
export function matchBySpan(listA, listB) {
  const candidates = [];
  for (let i = 0; i < listA.length; i++) {
    for (let j = 0; j < listB.length; j++) {
      const ov = spanOverlap(listA[i].recommendation_span, listB[j].recommendation_span);
      if (ov > 0) candidates.push({ i, j, ov });
    }
  }
  candidates.sort((x, y) => y.ov - x.ov || x.i - y.i || x.j - y.j);

  const takenA = new Set();
  const takenB = new Set();
  const pairs = [];
  for (const c of candidates) {
    if (takenA.has(c.i) || takenB.has(c.j)) continue;
    takenA.add(c.i);
    takenB.add(c.j);
    pairs.push({ a: c.i, b: c.j, overlap: c.ov });
  }

  return {
    pairs,
    unmatchedA: listA.map((_, i) => i).filter((i) => !takenA.has(i)),
    unmatchedB: listB.map((_, j) => j).filter((j) => !takenB.has(j)),
  };
}

/**
 * Cohen's kappa on a binary judgement, one value per report.
 *
 * Returns kappa: null where it is undefined rather than a number that looks like agreement. When
 * both labellers put every report in the same class, pe is 1, chance agreement is total, and the
 * statistic does not exist. Reporting 1.0 there, or 0, would be an invented figure, and section 5
 * gates relabelling on this number.
 */
export function cohenKappaBinary(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return { n: 0, po: null, pe: null, kappa: null, undefined_reason: 'no reports' };

  let agree = 0;
  let aPos = 0;
  let bPos = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    if (a[i]) aPos++;
    if (b[i]) bPos++;
  }
  const po = agree / n;
  const pa = aPos / n;
  const pb = bPos / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);

  if (1 - pe < 1e-12) {
    return {
      n,
      po,
      pe,
      kappa: null,
      undefined_reason:
        'both labellers assigned every report to the same class, so chance agreement is total '
        + 'and kappa is undefined. This usually means the corpus has no positives, which is the '
        + 'Open-i problem, not a labelling problem.',
    };
  }
  return { n, po, pe, kappa: (po - pe) / (1 - pe), undefined_reason: null };
}

export const intervalsEqual = (x, y) => {
  if (x == null && y == null) return true;
  if (x == null || y == null) return false;
  return x.value === y.value && x.unit === y.unit;
};

export const pct = (num, den) => (den === 0 ? '  n/a' : `${(100 * num / den).toFixed(1)}%`);

/** Group report ids by corpus language. Section 6 forbids pooling languages. */
export function byLanguage(corpusData, ids) {
  const groups = new Map();
  for (const id of ids) {
    const lang = corpusData.reports.get(id).language;
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang).push(id);
  }
  return groups;
}
