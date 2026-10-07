// The checking step: what a patient is shown, and what their answers become. Phase 2, stage 2.
//
// Pure functions, so every rule here is tested without a browser or a model. server.mjs only moves
// requests in and out of them, and checks nothing of its own.
//
// Four rules from PHASE2_PLAN.md decide the shape of this file.
//
//   Nothing becomes an obligation without the patient. Every item, first tier or second, is a
//   question the patient answers. The model's own score is shown, labelled as the app's score and
//   not a measured accuracy, because R7 says confidence is never hidden. It routes nothing: with
//   every item checked by a person, there is nothing for a threshold to send to review instead.
//
//   The second tier is shown in full. Stage 1 found verification doubting a plain recommendation
//   on an invented report, the weakness Phase 1 measured. With a patient alone, quietly means no
//   reminder until confirmed. It never means out of sight.
//
//   A condition is never turned into a due date. A conditional item the patient confirms is kept
//   as a note to raise with a clinician, with the condition in the report's words.
//
//   The patient can add what the app missed. They select the sentence; the span is checked against
//   the report text here, so what is stored is always the report's own words.

import { randomUUID } from 'node:crypto';
import { proposalsFromExtraction, acceptProposal, NOTHING_FOUND_NOTICE } from '../obligation/from-extraction.mjs';
import { modalityCode } from '../obligation/modality.mjs';

export const ACTIONS = ['imaging', 'laboratory', 'referral', 'treatment_initiation', 'procedure', 'specialist_review'];
export const UNITS = ['day', 'week', 'month', 'year'];

export const MAY_HAVE_MISSED =
  'This app can miss recommendations. Read your report yourself, and add any recommendation the app did not mark.';
export const NOT_READ_NOTICE =
  'The app has not read this report. Mark each recommendation in it yourself.';
export const INCOMPLETE_NOTICE =
  'The reading stopped partway. Some items below were not fully checked by the app, and are marked.';

const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The items the patient checks, from a reading (pipeline.mjs) and the report date they confirmed.
 * `manual` is a report the app did not read at all.
 */
export function prepareCheck({ result, run }, { date, manual = false, makeId = () => randomUUID() }) {
  if (!isIsoDate(date)) throw new Error('the report date is needed first: every due date is counted from it');
  const withDate = { ...result, document: { ...result.document, date_found: date } };
  const out = proposalsFromExtraction(withDate, {
    subject_ref: 'local',
    threshold: 0,
    makeId,
    reviewer: 'patient_only',
    source_kind: 'paste',
  });

  const unverified = new Set((run.unverified ?? []).map((s) => s.join(':')));
  const view = (p, tier) => ({
    id: p.id,
    tier,
    quote: p.recommendation.text_verbatim,
    span: p.source_span,
    action: p.recommendation.action,
    modality: p.recommendation.modality,
    interval: p.recommendation.interval,
    interval_verbatim: p.recommendation.interval_verbatim,
    // The pipeline flags a condition but does not return its wording on its own, so this is null
    // more often than not; the screen then points at the sentence, which contains the condition.
    conditional: Boolean(p.recommendation.conditional),
    condition: p.recommendation.condition_verbatim ?? null,
    already_scheduled: p.recommendation.already_scheduled,
    finding: p.finding.text_verbatim,
    finding_absence: p.finding.absence,
    finding_by_nearest_match: p.finding.location === 'nearest_sentence',
    score: tier === 'first' ? p.confidence : null,
    unverified: Boolean(p.source_span && unverified.has(p.source_span.join(':'))),
    needs_details: tier === 'second',
    doubt_reason: p.doubt_reason ?? null,
  });

  const notices = [];
  if (manual) notices.push(NOT_READ_NOTICE);
  else if (result.extraction.unparseable) notices.push(out.notice);
  else {
    if (out.notice === NOTHING_FOUND_NOTICE) notices.push(NOTHING_FOUND_NOTICE);
    notices.push(MAY_HAVE_MISSED);
    if (run.incomplete) notices.push(INCOMPLETE_NOTICE);
  }

  return {
    date,
    notices,
    // Proposals and the review queue are shown alike: the patient checks both.
    items: [...out.proposals, ...out.review_queue].map((p) => view(p, 'first')),
    less_sure: out.second_tier.map((p) => view(p, 'second')),
    not_needed: out.not_indicated_evidence.map((p) => ({ id: p.id, quote: p.recommendation.text_verbatim, span: p.source_span })),
    proposals: Object.fromEntries([...out.proposals, ...out.review_queue, ...out.second_tier].map((p) => [p.id, p])),
  };
}

function checkDetails(d, where) {
  if (!ACTIONS.includes(d.action)) throw new Error(`${where}: choose what the report asks for`);
  let interval = null;
  if (d.interval != null) {
    const value = Number(d.interval.value);
    if (!(value > 0) || !UNITS.includes(d.interval.unit)) throw new Error(`${where}: the time needs a number and a unit`);
    interval = { value, unit: d.interval.unit };
  }
  const modality = typeof d.modality === 'string' && d.modality.trim() ? d.modality.trim() : null;
  return { action: d.action, modality, modality_code: modalityCode(modality), interval };
}

/**
 * The patient's answers, made into obligations and notes. `decisions` are
 * {id, answer: 'yes' | 'no', details?} for items shown; `added` are {span, details} for sentences the
 * patient selected. Returns {obligations, notes, log}; the log records what was answered, for C4.
 */
export function applyDecisions(check, { text, decisions = [], added = [], at, patient = 'local' }) {
  const actor = { kind: 'patient', ref: patient };
  const owner = { kind: 'patient', ref: patient };
  const obligations = [];
  const notes = [];
  const log = [];

  for (const d of decisions) {
    const p = check.proposals[d.id];
    if (!p) throw new Error(`unknown item ${d.id}`);
    const second = p.fields_filled === false;
    log.push({ at, event: d.answer === 'yes' ? 'confirmed' : 'rejected', tier: second ? 'second' : 'first', quote: p.recommendation.text_verbatim });
    if (d.answer !== 'yes') continue;

    let proposal = p;
    const corrections = [];
    if (d.details || second) {
      if (second && !d.details) throw new Error(`"${p.recommendation.text_verbatim}": the app did not read this one, so its details are needed`);
      const fixed = checkDetails(d.details, `"${p.recommendation.text_verbatim}"`);
      for (const k of ['action', 'modality', 'interval']) {
        if (JSON.stringify(p.recommendation[k] ?? null) !== JSON.stringify(fixed[k])) {
          corrections.push({ field: `recommendation.${k}`, from: p.recommendation[k] ?? null, to: fixed[k] });
        }
      }
      proposal = {
        ...p,
        fields_filled: true,
        recommendation: { ...p.recommendation, ...fixed },
        // A second-tier item's finding was never read; it is not "not stated" but not located.
        finding: second ? { ...p.finding, absence: 'not_located', category: 'none', text_verbatim: null } : p.finding,
        confidence: typeof p.confidence === 'number' ? p.confidence : 0,
        flags: (p.flags ?? []).filter((f) => f !== 'second_tier'),
      };
    }

    if (proposal.flags?.includes('conditional')) {
      notes.push({
        kind: 'conditional',
        quote: proposal.recommendation.text_verbatim,
        condition: proposal.recommendation.condition_verbatim ?? null,
        document_date: check.date,
        at,
      });
      continue;
    }
    // A second-tier item was never filled by the model; the patient supplied its details. It is
    // recorded that way rather than carrying a model score it never had.
    const extraction = second ? { method: 'patient_completed' } : {};
    obligations.push(acceptProposal(proposal, { subject_ref: patient, owner, actor, at, extraction, corrections }));
  }

  for (const [i, a] of added.entries()) {
    const [s, e] = a.span ?? [];
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > text.length || e - s < 3) {
      throw new Error(`added item ${i + 1}: select the sentence in the report`);
    }
    const quote = text.slice(s, e).trim();
    const fixed = checkDetails(a.details ?? {}, `"${quote}"`);
    log.push({ at, event: 'added', tier: 'patient', quote });
    obligations.push(acceptProposal({
      id: randomUUID(),
      confidence: 1,
      language: 'en',
      source_span: [s, e],
      finding: {
        text_verbatim: null, category: 'none', anatomy: null, laterality: null, measurement: null,
        location: null, match_score: null, absence: 'not_located',
      },
      recommendation: {
        text_verbatim: quote, ...fixed, interval_verbatim: null, conditional: false,
        condition_verbatim: null, already_scheduled: false, guideline: null,
      },
      source: { kind: 'paste', document_date: check.date, locator: null, quote_offset: [s, e], retained: false },
      flags: [],
    }, {
      subject_ref: patient, owner, actor, at,
      // The patient found this sentence, not the extractor. Recorded as such rather than given a
      // model score it never had.
      extraction: { method: 'patient_selected' },
    }));
  }
  return { obligations, notes, log };
}
