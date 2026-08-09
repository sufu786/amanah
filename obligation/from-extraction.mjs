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

// C2, in the concept note's own words. Where extraction finds nothing, this is what must be said.
// It is not a formatting preference: a missed extraction producing false reassurance is described
// in the concept note as the single failure mode by which this system could kill someone.
export const NOTHING_FOUND_NOTICE =
  'No follow-up recommendation was found in this document. This does not mean there is not one.';

const nn = (v) => (v === null || v === undefined || v === '' ? null : v);

/**
 * Turn one extraction result into proposals, review items and blocked items.
 *
 * `threshold` is required. There is no sensible default: the right value depends on measured
 * performance for the model and language in use, and this repository has not measured recall for
 * any language yet. Supplying a number here would be inventing evidence.
 */
export function proposalsFromExtraction(result, {
  subject_ref, threshold, makeId, source_kind = 'photo', locator = null,
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

  for (const [index, rec] of (result.recommendations ?? []).entries()) {
    const item = {
      id: makeId(index),
      index,
      confidence: rec.confidence,
      language,
      // C3: the verification screen highlights the source sentence, so the span travels with the
      // proposal. Without it there is nothing to highlight and the patient cannot validate.
      source_span: rec.recommendation_span ?? null,
      finding: {
        text_verbatim: nn(rec.finding_verbatim),
        category: rec.finding,
        anatomy: nn(rec.anatomy),
        laterality: nn(rec.laterality),
        measurement: rec.measurement ?? null,
      },
      recommendation: {
        text_verbatim: rec.recommendation_verbatim,
        action: rec.action,
        modality: nn(rec.modality),
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
    };

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

  // The accounting invariant. If this ever fails, a recommendation went missing in the plumbing.
  const accounted = out.proposals.length + out.review_queue.length + out.blocked.length
    + out.not_indicated_evidence.length;
  const total = (result.recommendations ?? []).length;
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
