// The seam between the extractor and the registry.
//
// Until now these were two halves that had never been joined. extraction/ produces structured
// fields from a report; obligation.mjs holds an obligation. Nothing turned one into the other, and
// the gap is where most of the safety constraints actually live.
//
// An extraction is NOT an obligation. It is a proposal for one. C3 says the patient is the
// validator: extracted fields are shown beside the highlighted source text and confirmed before
// anything becomes real. So this module produces proposals, and a separate call turns an accepted
// proposal into an obligation. The two-step shape is the constraint, not a convenience.
//
// NOTHING IS DROPPED
//
// C6: "Below-threshold extractions enter a review queue, and are never silently accepted or
// silently dropped." The concept note gives no number, so the threshold is a parameter here and
// never a default buried in code. What is not negotiable is the accounting: every recommendation
// the extractor returned leaves this module in exactly one bucket, and the buckets are counted.
// A recommendation that quietly vanished is the failure mode this whole project exists to correct,
// and it would be especially galling to reintroduce it in the plumbing.

import { createObligation, verify } from './obligation.mjs';
import { modalityCode } from './modality.mjs';

// C2, in the concept note's own words. Where extraction finds nothing, this is what must be said.
// It is not a formatting preference: a missed extraction producing false reassurance is described
// in the concept note as the single failure mode by which this system could kill someone.
export const NOTHING_FOUND_NOTICE =
  'No follow-up recommendation was found in this document. This does not mean there is not one.';

const nn = (v) => (v === null || v === undefined || v === '' ? null : v);

/**
 * The finding, in the shape section 2 of the specification gives it.
 *
 * Extraction output from before specification v0.5 has no location or absence fields. A finding
 * quote in that output was located exactly, because the validator then rejected anything else, and
 * a missing quote meant the report named none. Both readings are what the format change promises:
 * a 0.2 object is a 0.3 object with location read as `exact`.
 */
function findingFrom(rec) {
  const text = nn(rec.finding_verbatim);
  const absence = nn(rec.finding_absence) ?? (text ? null : 'not_stated');
  if (absence) {
    return {
      text_verbatim: null,
      category: 'none',
      anatomy: nn(rec.anatomy),
      laterality: nn(rec.laterality),
      measurement: null,
      location: null,
      match_score: null,
      absence,
    };
  }
  return {
    text_verbatim: text,
    category: rec.finding,
    anatomy: nn(rec.anatomy),
    laterality: nn(rec.laterality),
    measurement: rec.measurement ?? null,
    location: nn(rec.finding_location) ?? 'exact',
    match_score: rec.finding_match_score ?? null,
    absence: null,
  };
}

/**
 * Turn one extraction result into proposals, review items and blocked items.
 *
 * `threshold` is required. There is no sensible default: the right value depends on measured
 * performance for the model and language in use, and this repository has not measured recall for
 * any language yet. Supplying a number here would be inventing evidence.
 */
// Specification v0.5, section 3.2. Who will see a doubted candidate decides what happens to it.
export const REVIEWERS = ['professional', 'patient_only'];
export const SECOND_TIER_ROUTES = { professional: 'review_queue', patient_only: 'listed_quietly' };

export function proposalsFromExtraction(result, {
  subject_ref, threshold, makeId, source_kind = 'photo', locator = null, reviewer = null,
} = {}) {
  if (!subject_ref) throw new Error('subject_ref is required, and must be opaque and local');
  if (typeof threshold !== 'number') {
    throw new Error('threshold is required (C6). It depends on measured performance for this model '
      + 'and language, and no default would be honest: recall is currently unmeasured.');
  }
  if (typeof makeId !== 'function') throw new Error('makeId is required; ids are client-generated');

  const documentDate = nn(result.document?.date_found);
  const language = result.document?.language ?? result.extraction?.language ?? 'en';

  const out = {
    proposals: [],
    review_queue: [],
    blocked: [],
    not_indicated_evidence: [],
    second_tier: [],
    no_recommendation_found: Boolean(result.extraction?.no_recommendation_found),
    unparseable: Boolean(result.extraction?.unparseable),
    notice: null,
    rejected_by_extractor: result.rejected ?? [],
  };

  // C2. Never presented as an all-clear, and the wording is not left to the caller.
  if ((result.recommendations ?? []).length === 0) out.notice = NOTHING_FOUND_NOTICE;

  // An unreadable document is a failure, never a clean result (SCHEMA.json, `unparseable`).
  if (out.unparseable) {
    out.notice = 'This document could not be read. Nothing has been extracted from it, and that is '
      + 'a failure to read it rather than a finding that there is nothing in it.';
  }

  const buildItem = (rec, index) => ({
    id: makeId(index),
    index,
    confidence: rec.confidence,
    language,
    // C3: the verification screen highlights the source sentence, so the span travels with the
    // proposal. Without it there is nothing to highlight and the patient cannot validate.
    source_span: rec.recommendation_span ?? null,
    finding: findingFrom(rec),
    recommendation: {
      text_verbatim: rec.recommendation_verbatim,
      action: rec.action,
      modality: nn(rec.modality),
      // Section 7, v0.6. Read from the words by a fixed rule, never by the model, so the same words
      // always give the same code and a person correcting the words can see why the code changed.
      modality_code: modalityCode(rec.modality),
      interval: rec.interval ?? null,
      interval_verbatim: nn(rec.interval_verbatim),
      conditional: Boolean(rec.conditional),
      condition_verbatim: nn(rec.condition_verbatim),
      already_scheduled: Boolean(rec.already_scheduled),
      guideline: null, // never supplied by the extractor (R6); applied downstream, attributed
    },
    source: {
      kind: source_kind,
      document_date: documentDate,
      locator,
      quote_offset: rec.recommendation_span ?? null,
      retained: false,
    },
    flags: [],
  });

  const firstTier = result.recommendations ?? [];
  for (const [index, rec] of firstTier.entries()) {
    const item = buildItem(rec, index);

    // A negated statement is not an obligation. It is evidence for the not_indicated terminal
    // state, and LABELLING.md section 4 is explicit that it is captured rather than discarded.
    // Turning it into an obligation would create a duty the report expressly said was not owed.
    if (rec.negated) {
      out.not_indicated_evidence.push({
        ...item,
        why: 'the report states follow-up is not required; this supports not_indicated and is not '
          + 'an obligation',
      });
      continue;
    }

    // Conformance 8, specification v0.5. A finding chosen by nearest match may be the wrong
    // sentence, so the person verifying is told rather than shown it as though it were quoted. A
    // finding that could not be located at all is a gap a person can fill, and they are told that
    // too. A report that names no finding is not flagged: nothing is missing.
    if (item.finding.location === 'nearest_sentence') item.flags.push('finding_located_by_nearest_match');
    if (item.finding.absence === 'not_located') item.flags.push('finding_not_located');

    if (item.recommendation.conditional) {
      // Section 9 of SCHEMA.json: conditional recommendations are flagged rather than converted
      // into unconditional due dates. The condition has to be resolved by a person first.
      item.flags.push('conditional');
    }
    if (item.recommendation.already_scheduled) {
      // Prevents a duplicate obligation for work already booked.
      item.flags.push('already_scheduled');
    }

    // Every due date derives from document_date, so without one there is nothing to compute and
    // nothing to remind against. SCHEMA.json says this "forces the interface to ask the patient
    // for it". Blocked, not discarded.
    if (!documentDate) {
      out.blocked.push({ ...item, why: 'no date was found in the document, and every due date '
        + 'derives from it. The patient has to supply the date of the report.' });
      continue;
    }

    if (typeof rec.confidence !== 'number' || rec.confidence < threshold) {
      // C6. Not accepted, not dropped.
      out.review_queue.push({ ...item, why: `confidence ${rec.confidence} is below the threshold `
        + `${threshold}; this goes to review rather than being accepted or discarded` });
      continue;
    }

    out.proposals.push(item);
  }

  // Specification v0.5, section 3.2. Candidates an earlier stage doubted. They are kept, never an
  // obligation or an alert until a person confirms one, and where they go depends on who is present.
  // There is no default for `reviewer`, for the same reason there is none for `threshold`: the
  // choice decides whether a patient alone is shown something, and a guess would be inventing it.
  const secondTier = result.second_tier ?? [];
  if (secondTier.length) {
    if (!REVIEWERS.includes(reviewer)) {
      throw new Error(`reviewer is required when there are second-tier candidates: one of `
        + `${REVIEWERS.join(', ')}. It decides whether a doubted candidate goes to a professional's `
        + 'review queue or is listed quietly for a patient alone (specification v0.5, section 3.2).');
    }
    for (const [i, rec] of secondTier.entries()) {
      const item = buildItem(rec, firstTier.length + i);
      out.second_tier.push({
        ...item,
        flags: [
          'second_tier',
          ...(item.recommendation.conditional ? ['conditional'] : []),
          ...(item.recommendation.already_scheduled ? ['already_scheduled'] : []),
        ],
        // Doubted candidates are demoted before fields are filled, so finding, action and interval
        // here are placeholders and an empty finding means unread, not "the report names none".
        // acceptProposal refuses the item until a person has filled them and set this true.
        fields_filled: false,
        doubt_reason: rec.doubt_reason ?? 'verification',
        route: SECOND_TIER_ROUTES[reviewer],
        why: 'an extraction stage judged that this sentence asks for nothing. It is kept rather than '
          + 'deleted, and becomes an obligation only if a person confirms it.',
      });
    }
  }

  // The accounting invariant. If this ever fails, a recommendation went missing in the plumbing.
  const accounted = out.proposals.length + out.review_queue.length + out.blocked.length
    + out.not_indicated_evidence.length + out.second_tier.length;
  const total = firstTier.length + secondTier.length;
  if (accounted !== total) {
    throw new Error(`accounting error: ${total} recommendations in, ${accounted} accounted for. `
      + 'Every extracted recommendation must leave this module in exactly one bucket (C6).');
  }

  return out;
}

/**
 * Accept a proposal and create the obligation, with the patient's confirmation recorded.
 *
 * C3 is the reason this is a separate call taking an actor. An obligation that appeared without
 * anyone confirming it would be the system asserting a duty on a patient's behalf, which is
 * exactly what the verification screen exists to prevent.
 */
export function acceptProposal(proposal, {
  subject_ref, owner, actor, at, extraction, corrections = [],
}) {
  if (proposal.fields_filled === false) {
    throw new Error('this is a second-tier candidate whose fields have not been filled. Its finding, '
      + 'action and interval are placeholders, so accepting it would create an obligation asserting '
      + 'things nobody has read. A person fills the fields and sets fields_filled first '
      + '(specification v0.5, section 3.2).');
  }
  if (proposal.flags?.includes('conditional')) {
    throw new Error('a conditional recommendation cannot be accepted as-is. The condition has to be '
      + 'resolved by a person first, because converting it into an unconditional due date invents a '
      + 'duty the report made contingent.');
  }
  if (!proposal.source.document_date) {
    throw new Error('this proposal is blocked: it has no document date, and every due date derives '
      + 'from one');
  }

  const obligation = createObligation({
    id: proposal.id,
    subject_ref,
    finding: proposal.finding,
    recommendation: proposal.recommendation,
    source: proposal.source,
    owner,
    extraction: {
      confidence: proposal.confidence,
      language: proposal.language,
      language_validated: false,
      ...extraction,
    },
    actor,
    at,
  });

  // The confirmation itself, which is what moves created to acknowledged.
  return verify(obligation, { actor, at, corrections });
}
