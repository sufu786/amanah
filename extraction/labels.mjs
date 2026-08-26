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
      // Carried through rather than dropped. Nothing in the harness scores on it, but the
      // labelling tool shows it as context, and it displayed "modality unrecorded" for every
      // report while this loader was quietly discarding the field the draw had written.
      modality: r.modality ?? null,
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
  const redacted = Boolean(raw.redacted);
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

    const recommendations = [];
    for (const [k, rec] of entry.recommendations.entries()) {
      const rw = `${where} rec[${k}]`;

      if (redacted) {
        // A redacted set carries spans and no quoted text, so that labels can be published under
        // a data use agreement that forbids redistributing the corpus. The span is the claim, and
        // the verbatim string is derived from the reader's own copy of the report.
        //
        // Nothing checkable is lost. The people who can judge a labelling call are the people who
        // can read the report it came from, and under a per-person DUA those are exactly the
        // people who can rebuild the corpus. text_sha256 proves they rebuilt the right one.
        if (rec.recommendation_verbatim != null || rec.finding_verbatim != null) {
          push(`${rw}: this set is marked redacted but still carries quoted text. Redaction is `
            + 'all or nothing; a half-stripped file is the worst of both.');
        }
        const okRec = rangeCheck(rw, 'recommendation', rec.recommendation_span, report.text, push);
        const okFinding = rec.finding_span == null
          || rangeCheck(rw, 'finding', rec.finding_span, report.text, push);
        recommendations.push({
          ...rec,
          recommendation_verbatim: okRec ? sliceSpan(report.text, rec.recommendation_span) : null,
          finding_verbatim: rec.finding_span && okFinding
            ? sliceSpan(report.text, rec.finding_span) : null,
        });
      } else {
        if (typeof rec.recommendation_verbatim !== 'string' || !rec.recommendation_verbatim) {
          push(`${rw}: recommendation_verbatim must be a non-empty string`);
        }
        validateSpan(rw, 'recommendation', rec.recommendation_span, rec.recommendation_verbatim,
          report.text, push);
        if (rec.finding_verbatim != null || rec.finding_span != null) {
          validateSpan(rw, 'finding', rec.finding_span, rec.finding_verbatim, report.text, push);
        }
        recommendations.push(rec);
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
      // Section 7.6. An equivalent span is another place the SAME sentence appears. It is not a
      // second recommendation and it is not a licence to make the gold standard match anything:
      // each one must quote the same words as the canonical span, or the check fails.
      if (rec.equivalent_spans != null) {
        if (!Array.isArray(rec.equivalent_spans)) {
          push(`${rw}: equivalent_spans must be an array of [start, end] spans`);
        } else {
          const canonical = normaliseQuote(
            sliceSpan(report.text, rec.recommendation_span ?? [0, 0]));
          for (const [q, span] of rec.equivalent_spans.entries()) {
            const ew = `${rw} equivalent[${q}]`;
            if (!rangeCheck(ew, 'equivalent', span, report.text, push)) continue;
            if (spanOverlap(span, rec.recommendation_span) > 0) {
              push(`${ew}: overlaps the canonical span. An equivalent is a repeat `
                + 'elsewhere in the report, not a wider selection of the same sentence.');
              continue;
            }
            if (normaliseQuote(sliceSpan(report.text, span)) !== canonical) {
              push(`${ew}: quotes different words from the canonical span. `
                + 'Equivalent spans record the same sentence written twice, so a span that says '
                + 'something else is either a second instance or a mistake.');
            }
          }
        }
      }
    }

    // Cross-instance guard. If one instance's equivalent lands on another instance's canonical
    // span, the two are competing for the same words and matching would become order-dependent.
    // Report 19303239-RR-45 is the shape that makes this reachable: two findings, two follow-up
    // sentences, and nothing stopping a radiologist wording both the same way.
    for (const [k, rec] of recommendations.entries()) {
      for (const span of rec.equivalent_spans ?? []) {
        for (const [k2, other] of recommendations.entries()) {
          if (k === k2) continue;
          if (spanOverlap(span, other.recommendation_span) > 0) {
            push(`${where} rec[${k}]: an equivalent span overlaps the canonical span of `
              + `rec[${k2}]. Two instances cannot claim the same words. Drop the equivalent `
              + 'and label the occurrences separately.');
          }
        }
      }
    }

    labels.set(entry.report_id, {
      report_id: entry.report_id,
      date_found: entry.date_found ?? null,
      recommendations,
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
    redacted,
    labelling: raw.labelling ?? null,
    labels,
  };
}

const sliceSpan = (text, [s, e]) => text.slice(s, e);

/** Shape and range only. Used for redacted sets, where there is no quoted text to compare against. */
function rangeCheck(where, field, span, text, push) {
  if (!Array.isArray(span) || span.length !== 2
      || !Number.isInteger(span[0]) || !Number.isInteger(span[1])) {
    push(`${where}: ${field}_span must be [start, end] integers`);
    return false;
  }
  const [s, e] = span;
  if (s < 0 || e > text.length || s >= e) {
    push(`${where}: ${field}_span [${s}, ${e}] is out of range for a ${text.length}-char report`);
    return false;
  }
  return true;
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

/**
 * Whitespace-collapsed form of a quote. Line wrapping in clinical reports is arbitrary, so two
 * spans quoting the same sentence can differ by a newline and nothing else.
 */
export const normaliseQuote = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * Every span an instance may legitimately be quoted from: the canonical one first, then any
 * equivalent occurrence of the same sentence elsewhere in the report. Section 7.6.
 */
export const spansOf = (rec) => [rec.recommendation_span, ...(rec.equivalent_spans ?? [])];

/**
 * Find every other place the same sentence appears in the report, whitespace-insensitively.
 *
 * Used to derive equivalent_spans at labelling time rather than asking a labeller to hunt for
 * duplicates. Deterministic, and derived from text the labeller already selected, so it invents
 * nothing. The caller is responsible for the collision guard: an occurrence that overlaps another
 * instance's canonical span belongs to that instance, not this one.
 */
export function findRepeats(text, span) {
  const target = normaliseQuote(text.slice(span[0], span[1]));
  if (!target) return [];

  // Map collapsed offsets back to real ones, so returned spans point at real source characters.
  const map = [];
  let collapsed = '';
  let prevWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (prevWasSpace) continue;
      collapsed += ' ';
      map.push(i);
      prevWasSpace = true;
    } else {
      collapsed += text[i];
      map.push(i);
      prevWasSpace = false;
    }
  }

  const out = [];
  for (let idx = collapsed.indexOf(target); idx !== -1; idx = collapsed.indexOf(target, idx + 1)) {
    const start = map[idx];
    const end = map[Math.min(idx + target.length - 1, map.length - 1)] + 1;
    if (start === span[0] && end === span[1]) continue;      // the canonical span itself
    if (spanOverlap([start, end], span) > 0) continue;        // overlapping is not a repeat
    out.push([start, end]);
  }
  return out;
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
      // Section 7.6: a recommendation stated twice is one instance, labelled from the impression.
      // An extractor quoting the other occurrence found the same duty, so every acceptable span is
      // considered and the best overlap wins. Matching on text instead would pair the model with
      // the wrong finding whenever two findings carry the same wording.
      let ov = 0;
      for (const sa of spansOf(listA[i])) {
        for (const sb of spansOf(listB[j])) ov = Math.max(ov, spanOverlap(sa, sb));
      }
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
