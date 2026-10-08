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
import { modalityCode, modalityWords } from '../obligation/modality.mjs';

export const ACTIONS = ['imaging', 'laboratory', 'referral', 'treatment_initiation', 'procedure', 'specialist_review'];
export const UNITS = ['day', 'week', 'month', 'year'];

export const MAY_HAVE_MISSED =
  'This app can miss recommendations. Read your report yourself, and add any recommendation the app did not mark.';
export const NOT_READ_NOTICE =
  'The app has not read this report. Mark each recommendation in it yourself.';
export const DUPLICATE_NOTICE =
  'You may have saved this report before: follow-ups with the same words and the same report date are already saved. Saving again will list them twice.';
export const INCOMPLETE_NOTICE =
  'The reading stopped partway. Some items below were not fully checked by the app, and are marked.';

const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Reading by fixed rule, from the sentence alone. The model sometimes leaves a field empty that the
// sentence states plainly ("repeat chest radiograph", test not named), and every empty field was
// work handed to the patient. These rules only copy what the sentence says. They never fill a field
// the model did fill, never infer a time the sentence does not state, and skip anything that reads
// two ways, such as a range ("3 to 6 months") or two different times; those stay empty.
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, eighteen: 18 };
const NUMBER = `\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')}`;
const INTERVAL = new RegExp(`\\b(${NUMBER})[\\s-]*(day|week|month|year)s?\\b`, 'gi');
const RANGE = new RegExp(`\\b(${NUMBER})\\s*(?:-|to|or)\\s*(${NUMBER})[\\s-]*(day|week|month|year)`, 'i');
const YEARLY = /\b(annual|annually|yearly)\b/i;
// Codes a scan or X-ray belongs to. Endoscopy is a procedure and `other` names nothing, so neither
// tells the rule what kind of request this is.
const IMAGING_CODES = new Set(['radiograph', 'ct', 'mr', 'ultrasound', 'mammography', 'pet', 'nuclear_medicine', 'fluoroscopy', 'angiography', 'bone_densitometry']);

export function readBySentence(sentence) {
  const s = String(sentence ?? '');
  const out = { action: null, modality: null, interval: null, interval_verbatim: null };
  out.modality = modalityWords(s);
  if (out.modality && IMAGING_CODES.has(modalityCode(out.modality))) out.action = 'imaging';
  if (!RANGE.test(s)) {
    const found = [...s.matchAll(INTERVAL)].map((m) => ({
      value: NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]), unit: m[2].toLowerCase(), words: m[0],
    }));
    const distinct = new Set(found.map((f) => `${f.value} ${f.unit}`));
    if (found.length && distinct.size === 1 && found[0].value > 0) {
      out.interval = { value: found[0].value, unit: found[0].unit };
      out.interval_verbatim = found[0].words;
    } else if (!found.length && YEARLY.test(s)) {
      out.interval = { value: 1, unit: 'year' };
      out.interval_verbatim = s.match(YEARLY)[0];
    }
  }
  return out;
}

/**
 * The details an item is shown with, and saved with if the patient changes nothing. The model's
 * fields come first (for a doubted item, the fields it filled after doubting it); the rule fills only
 * what is still empty. `by` records where each field came from, so the screen and the saved follow-up
 * can say so.
 */
function prefill(rec, suggested, quote) {
  const base = suggested ?? rec;
  const rule = readBySentence(quote);
  // The quote check (validateRecommendation) only asks that the time's words exist somewhere in the
  // report. On an invented report the model gave "If symptoms persist, repeat chest radiograph." the
  // time "in 6 months" from the sentence before it. A time is kept only when its words are in the
  // sentence itself; otherwise it is dropped, and the follow-up waits for a date rather than carry
  // another sentence's.
  const own = base.interval && base.interval_verbatim
    && String(quote).toLowerCase().includes(String(base.interval_verbatim).toLowerCase());
  const details = {
    action: base.action && base.action !== 'unclear' ? base.action : null,
    modality: base.modality ?? null,
    interval: own ? base.interval : null,
    interval_verbatim: own ? base.interval_verbatim : null,
  };
  const by = {};
  for (const k of ['action', 'modality', 'interval']) {
    if (details[k] != null) by[k] = suggested ? 'model_after_doubt' : 'model';
    else if (rule[k] != null) {
      details[k] = rule[k];
      by[k] = 'rule';
      if (k === 'interval') details.interval_verbatim = rule.interval_verbatim;
    }
  }
  // A lab test is a blood or tissue test. A sentence that names a scan is not asking for one: the
  // same report had "Annual screening mammography is advised." read as a lab test. The rule's reading
  // wins only this one contradiction; a procedure or referral naming a scan is left as the model read it.
  if (details.action === 'laboratory' && rule.action === 'imaging') {
    details.action = 'imaging';
    by.action = 'rule';
  }
  return { details, by };
}

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
  const suggestions = new Map((run.doubted_fields ?? []).map((d) => [d.span.join(':'), d.fields]));
  const prefilled = {};
  const view = (p, tier) => {
    const suggested = tier === 'second' && p.source_span ? suggestions.get(p.source_span.join(':')) : undefined;
    // An item whose fields are placeholders is read only by rule; its placeholder action is not a reading.
    const pre = prefill(tier === 'second' ? {} : p.recommendation, suggested, p.recommendation.text_verbatim);
    prefilled[p.id] = { ...pre, suggested: Boolean(suggested) };
    return viewOf(p, tier, pre);
  };
  const viewOf = (p, tier, pre) => ({
    id: p.id,
    tier,
    quote: p.recommendation.text_verbatim,
    span: p.source_span,
    action: pre.details.action ?? (tier === 'second' ? null : p.recommendation.action),
    modality: pre.details.modality,
    interval: pre.details.interval,
    interval_verbatim: pre.details.interval_verbatim,
    filled_by: pre.by,
    // The pipeline flags a condition but does not return its wording on its own, so this is null
    // more often than not; the screen then points at the sentence, which contains the condition.
    conditional: Boolean(p.recommendation.conditional),
    condition: p.recommendation.condition_verbatim ?? null,
    already_scheduled: p.recommendation.already_scheduled,
    finding: p.finding.text_verbatim,
    finding_absence: p.finding.absence,
    finding_by_nearest_match: p.finding.location === 'nearest_sentence',
    score: tier === 'second' ? null : p.confidence,
    unverified: Boolean(p.source_span && unverified.has(p.source_span.join(':'))),
    // Only an item nothing could read the request of still needs the patient to say what it asks for.
    needs_details: tier === 'second' && !pre.details.action,
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
    // Stage 6 hazard log, H30. An item the model read as negated was once only listed, so a real
    // recommendation misread as "not needed" left the checking step without the patient answering
    // it. It is now asked like every other item, and counts toward the every-item rule.
    not_needed: out.not_indicated_evidence.map((p) => view(p, 'negated')),
    proposals: Object.fromEntries([...out.proposals, ...out.review_queue, ...out.second_tier, ...out.not_indicated_evidence].map((p) => [p.id, p])),
    prefilled,
  };
}

const sameDetails = (a, b) => a.action === b.action && (a.modality ?? null) === (b.modality ?? null)
  && JSON.stringify(a.interval ?? null) === JSON.stringify(b.interval ?? null);

// `asShown` is set when the details are the ones the patient was shown and left alone, where the
// model's own "unclear" may stand; a patient filling details in chooses an action.
function checkDetails(d, where, { asShown = false } = {}) {
  if (!ACTIONS.includes(d.action) && !(asShown && d.action === 'unclear')) throw new Error(`${where}: choose what the report asks for`);
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
    const negated = Boolean(p.recommendation?.negated) || check.not_needed?.some((x) => x.id === p.id);
    log.push({ at, event: d.answer === 'yes' ? 'confirmed' : 'rejected', tier: second ? 'second' : negated ? 'negated' : 'first', quote: p.recommendation.text_verbatim });
    if (d.answer !== 'yes') continue;

    let proposal = p;
    const corrections = [];
    // What the item was shown with. A yes with no details given accepts these as shown.
    const pre = check.prefilled?.[d.id] ?? { details: {}, by: {}, suggested: false };
    const shown = { ...pre.details, action: pre.details.action ?? p.recommendation.action };
    // Shown differently from the model's reading: a field read by rule, or a time dropped because
    // its words were not in the sentence. A yes then saves what was shown, not the model's reading.
    const adjusted = !second && !sameDetails(shown, p.recommendation);
    const given = d.details ?? ((second && pre.details.action) || adjusted ? shown : null);
    let extraction = {};
    if (given || second) {
      if (second && !given) throw new Error(`"${p.recommendation.text_verbatim}": the app did not read this one, so its details are needed`);
      const fixed = checkDetails(given, `"${p.recommendation.text_verbatim}"`, { asShown: given === shown });
      // A correction is a change the patient made to what they were shown, which is the training
      // signal section 2 keeps. A field filled by rule and left alone is not a correction.
      const base = second && !pre.details.action ? {} : shown;
      for (const k of ['action', 'modality', 'interval']) {
        if (JSON.stringify(base[k] ?? null) !== JSON.stringify(fixed[k])) {
          corrections.push({ field: `recommendation.${k}`, from: base[k] ?? null, to: fixed[k] });
        }
      }
      const unchanged = sameDetails(fixed, shown);
      // The time keeps the report's words it was read from, and loses them once the patient changes it.
      const sameTime = (x) => JSON.stringify(fixed.interval) === JSON.stringify(x ?? null);
      fixed.interval_verbatim = sameTime(pre.details.interval) ? pre.details.interval_verbatim ?? null
        : sameTime(p.recommendation.interval) ? p.recommendation.interval_verbatim ?? null : null;
      // Recorded on the follow-up: which fields a fixed rule read, and, for a doubted item, whether
      // the patient accepted the details the model filled or supplied their own.
      const byRule = unchanged ? Object.keys(pre.by).filter((k) => pre.by[k] === 'rule').map((k) => `recommendation.${k}`) : [];
      if (byRule.length) extraction.filled_by_rule = byRule;
      if (p.recommendation.interval && !pre.details.interval && !fixed.interval) {
        extraction.interval_not_in_sentence = p.recommendation.interval_verbatim ?? null;
      }
      if (second) extraction.method = unchanged && pre.details.action ? 'confirmed_after_doubt' : 'patient_completed';
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
    // A second-tier item carries no model score; its method says who supplied the details instead.
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
  // Every item shown must have an answer. The page enforces this too, but the server does not
  // trust it to: a page that dropped the less-sure items would otherwise save without the patient
  // ever having seen them (stage 6 hazard log, H3).
  const answered = new Set(decisions.map((d) => d.id));
  const unanswered = Object.keys(check.proposals).filter((id) => !answered.has(id));
  if (unanswered.length) {
    throw new Error(`every item needs a yes or a no before saving; ${unanswered.length} still need one`);
  }
  return { obligations, notes, log };
}
