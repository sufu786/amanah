// The portable clinical obligation: the object, its state machine, and its history.
//
// This implements sections 2 to 6 of OBLIGATION_SPEC.md, including the reopen edge in 3.1. It is
// the primitive the specification is actually about. Everything in extraction/ produces a *proposal* for one of these; nothing until
// now could hold one.
//
// Three properties are deliberate and constrain everything below.
//
//   Pure and transport-agnostic. No storage, no network, no framework. The specification says the
//   object can travel as JSON, as a FHIR Task, or printed on paper, so this layer commits to none
//   of them. Every function takes an obligation and returns a new one.
//
//   Time is injected, never read. Nothing here calls Date.now(). Every mutating function takes an
//   explicit `at`. This is not a testing convenience: R2 says elapsed time never closes an
//   obligation, and a module that cannot see the clock cannot accidentally use it. It also makes
//   every trajectory reproducible, which section 11.6 requires.
//
//   Nothing mutates. History is append-only (section 5), so returning a new object with a longer
//   history is the honest representation. A caller holding the previous value still holds a true
//   record of what the obligation was.

import { createHash } from 'node:crypto';

// 0.3 is additive over 0.2: every valid 0.2 object is a valid 0.3 object with finding.location read
// as `exact`. Specification v0.5, header.
export const SCHEMA = 'cor.obligation/0.3';

// Section 2 field notes, v0.5. How a finding's quote was found, and why there may be none.
export const FINDING_LOCATIONS = ['exact', 'nearest_sentence'];
export const FINDING_ABSENCE = ['not_stated', 'not_located'];
export const LATERALITY = ['left', 'right', 'bilateral', 'midline'];

// Section 7. Reserved for obligations with no finding, and distinct from `other`, which says a
// finding exists and falls outside the list.
export const NO_FINDING = 'none';

// Section 3. The live path, and the terminal exits.
export const STATES = [
  'created', 'acknowledged', 'scheduled', 'completed', 'resolved',
  'declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased',
];

export const TERMINAL_STATES = [
  'resolved', 'declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased',
];

// Section 4.4. lost_to_followup terminates the escalation ladder; it does not discharge the
// obligation. Kept as a named export because every metric has to be able to ask this question,
// and a system that folds it into "closed" has recreated the problem it was built to solve.
export const CLOSURE_STATES = ['resolved', 'declined', 'not_indicated', 'superseded', 'deceased'];
export const NOT_A_CLOSURE = 'lost_to_followup';

// Section 4.1. patient_attestation is accepted because in most of the world it is the only
// obtainable evidence, and is recorded at a distinct tier so an audit view can distinguish it.
export const EVIDENCE_TYPES = {
  matching_study: { tier: 'objective' },
  matching_result: { tier: 'objective' },
  treatment_started: { tier: 'documented' },
  clinician_attestation: { tier: 'documented' },
  patient_attestation: { tier: 'self_reported' },
};

export const ACTOR_KINDS = ['patient', 'clinician', 'coordinator', 'system'];
export const OWNER_KINDS = ['patient', 'clinician', 'coordinator', 'service'];

// Section 3, "permitted transitions only". Anything not listed is rejected.
const TERMINAL_EXITS = ['declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased'];

const PROGRESSION = {
  created: { acknowledged: 'verified' },
  acknowledged: { scheduled: 'scheduled' },
  scheduled: { completed: 'evidence_added' },
  completed: { resolved: 'state_changed' },
};

/**
 * Which transitions are legal from a given state.
 *
 * `resolved` is reachable only from `completed`, and not_indicated is its own terminal state
 * requiring a documented reason and an actor. Terminal exits are available from every non-terminal
 * state, because restricting them would strand obligations: a patient may decline before verifying,
 * and a patient may die at any point.
 *
 * Both of those were ambiguous in v0.2 and are settled in v0.3, sections 12.1 A and D. A terminal
 * state has one way out, added in v0.4, section 3.1. In each case this implementation took the
 * conservative reading first and the specification was corrected to match, not the other way round.
 */
export function permittedTransitions(state) {
  // A terminal state has exactly one way out: back to `acknowledged`, by reopening. That is a
  // correction rather than progress, and it is the only transition in this machine that is not
  // gated on evidence. See reopen() for why.
  if (TERMINAL_STATES.includes(state)) return ['acknowledged'];
  return [...Object.keys(PROGRESSION[state] ?? {}), ...TERMINAL_EXITS];
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIsoInstant = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v);
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function requireActor(actor) {
  if (!isPlainObject(actor) || !ACTOR_KINDS.includes(actor.kind) || !actor.ref) {
    throw new Error(`actor must be {kind: ${ACTOR_KINDS.join('|')}, ref}. R1: every transition has an actor.`);
  }
}

function requireAt(at) {
  if (!isIsoInstant(at)) {
    throw new Error(`at must be an ISO 8601 instant such as 2026-03-20T10:04:00Z, got ${JSON.stringify(at)}. `
      + 'Time is injected rather than read, so a trajectory can be reconstructed exactly (section 11.6).');
  }
}

/**
 * Section 6. Identity of a finding across serial studies.
 *
 * Measurement is deliberately excluded from the key: the whole point is that a nodule changes
 * size between studies, and keying on size would make every follow-up a different finding.
 */
export function identityKey({
  subject_ref, category, anatomy = null, laterality = null, action = null, modality = null,
}) {
  if (!subject_ref) throw new Error('identityKey requires subject_ref');
  if (!category) throw new Error('identityKey requires a finding category');
  const norm = (v) => (v ? String(v).trim().toLowerCase() : '');

  // Rule 5, v0.5. With no finding there is no category to key on, and keying every findingless
  // obligation on "none" alone would let the first be superseded by the next whatever each asked
  // for. The recommendation stands in for the finding. Every other category keeps the v0.2 tuple
  // exactly, so no stored identity_key changes.
  if (category === NO_FINDING) {
    if (!action) throw new Error('identityKey for an obligation with no finding requires the recommendation action');
    return createHash('sha256')
      .update([subject_ref, NO_FINDING, norm(action), norm(modality), norm(anatomy), norm(laterality)].join('|'), 'utf8')
      .digest('hex');
  }

  return createHash('sha256')
    .update([subject_ref, category, norm(anatomy), norm(laterality)].join('|'), 'utf8')
    .digest('hex');
}

/**
 * Section 2 field notes, v0.5. A finding either quotes the source, located exactly or by nearest
 * match, or says why it does not. Returns the finding with its provenance fields filled in, or
 * throws naming the rule broken.
 */
function validateFinding(finding) {
  if (!isPlainObject(finding) || !finding.category) {
    throw new Error('finding needs a category. R5: the verbatim source is retained, never paraphrased.');
  }
  if (finding.laterality != null && !LATERALITY.includes(finding.laterality)) {
    throw new Error(`finding.laterality must be one of ${LATERALITY.join(', ')}, or null`);
  }

  const absence = finding.absence ?? null;
  if (absence !== null) {
    if (!FINDING_ABSENCE.includes(absence)) {
      throw new Error(`finding.absence must be one of ${FINDING_ABSENCE.join(', ')}, or null`);
    }
    if (finding.text_verbatim) {
      throw new Error('a finding with an absence reason carries no text. R5: absent, never invented.');
    }
    if (finding.category !== NO_FINDING) {
      throw new Error(`a finding with an absence reason has category "${NO_FINDING}" (section 7)`);
    }
    // Location and score describe a quote, and there is none.
    return { ...finding, text_verbatim: null, location: null, match_score: null, absence };
  }

  if (!finding.text_verbatim) {
    throw new Error('finding needs text_verbatim, or an absence reason saying why there is none. '
      + 'R5: the verbatim source is retained, never paraphrased.');
  }
  if (finding.category === NO_FINDING) {
    throw new Error(`category "${NO_FINDING}" is valid only with an absence reason (section 7)`);
  }

  const location = finding.location ?? 'exact';
  if (!FINDING_LOCATIONS.includes(location)) {
    throw new Error(`finding.location must be one of ${FINDING_LOCATIONS.join(', ')}`);
  }
  const score = finding.match_score ?? null;
  if (location === 'nearest_sentence' && !(typeof score === 'number' && score >= 0 && score <= 1)) {
    throw new Error('a finding located by nearest match needs match_score between 0 and 1, so the '
      + 'person verifying it can see how close the match was (conformance 8)');
  }
  if (location === 'exact' && score !== null) {
    throw new Error('match_score is present only when location is nearest_sentence');
  }
  return { ...finding, location, match_score: score, absence: null };
}

/**
 * document_date plus the stated interval.
 *
 * Computed in UTC and clamped to the end of the month, so 31 January plus one month is 28 or 29
 * February rather than rolling into March. A due date that silently jumps a month is a due date
 * that produces a wrong reminder.
 *
 * Returns null when no interval was stated. That is a legitimate and common answer: the extractor
 * is forbidden from inventing one (R6), so the registry must be able to hold an obligation that
 * has no due date rather than manufacture one.
 */
export function computeDueDate(documentDate, interval) {
  if (!isIsoDate(documentDate)) throw new Error(`document_date must be YYYY-MM-DD, got ${JSON.stringify(documentDate)}`);
  if (interval == null) return null;
  const { value, unit } = interval;
  if (!Number.isFinite(value) || value <= 0) throw new Error('interval.value must be a positive number');

  const [y, m, d] = documentDate.split('-').map(Number);
  let year = y;
  let month = m;
  let day = d;

  if (unit === 'day' || unit === 'week') {
    const ms = Date.UTC(y, m - 1, d) + value * (unit === 'week' ? 7 : 1) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (unit === 'month') month += value;
  else if (unit === 'year') year += value;
  else throw new Error(`interval.unit must be day, week, month or year, got ${JSON.stringify(unit)}`);

  year += Math.floor((month - 1) / 12);
  month = ((month - 1) % 12 + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  day = Math.min(day, lastDay);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Create an obligation from a verified extraction.
 *
 * Starts in `created`, never in `acknowledged`: section 3 requires verification of the extracted
 * fields before an obligation is treated as confirmed, and confidence has to be visible for that
 * to mean anything (R7).
 */
export function createObligation({
  id, subject_ref, finding, recommendation, source, owner, extraction, actor, at,
}) {
  requireActor(actor);
  requireAt(at);
  if (!id) throw new Error('id is required and is client-generated, so an obligation can be created offline');
  if (!subject_ref) throw new Error('subject_ref is required');
  const checkedFinding = validateFinding(finding);
  if (!isPlainObject(recommendation) || !recommendation.text_verbatim || !recommendation.action) {
    throw new Error('recommendation needs {text_verbatim, action}');
  }
  if (!isPlainObject(source) || !isIsoDate(source.document_date)) {
    throw new Error('source needs a document_date in YYYY-MM-DD. It is the date of the REPORT, never of ingestion: '
      + 'a photograph of a two-year-old report must produce an obligation that is already overdue.');
  }
  if (!isPlainObject(owner) || !OWNER_KINDS.includes(owner.kind) || !owner.ref) {
    throw new Error(`owner must be {kind: ${OWNER_KINDS.join('|')}, ref}. R3: exactly one owner at all times.`);
  }
  if (!isPlainObject(extraction) || typeof extraction.confidence !== 'number') {
    throw new Error('extraction.confidence is required. R7: confidence is first-class and never hidden.');
  }

  const dueDate = computeDueDate(source.document_date, recommendation.interval ?? null);

  return Object.freeze({
    schema: SCHEMA,
    id,
    subject_ref,
    finding: {
      ...checkedFinding,
      identity_key: identityKey({
        subject_ref,
        category: checkedFinding.category,
        anatomy: checkedFinding.anatomy ?? null,
        laterality: checkedFinding.laterality ?? null,
        action: recommendation.action,
        modality: recommendation.modality ?? null,
      }),
    },
    recommendation,
    source: { retained: false, ...source },
    due_date: dueDate,
    due_date_basis: dueDate ? 'document_date+interval' : 'no_interval_stated',
    owner: { ...owner, since: at },
    state: 'created',
    extraction: { patient_verified: false, patient_corrections: [], ...extraction },
    closure: null,
    history: Object.freeze([Object.freeze({
      at, actor, event: 'created', from_state: null, to_state: 'created', detail: {},
    })]),
  });
}

function append(obligation, entry) {
  return Object.freeze({
    ...obligation,
    history: Object.freeze([...obligation.history, Object.freeze(entry)]),
  });
}

/**
 * Move an obligation to a new state.
 *
 * Rejects any transition not drawn in section 3, refuses `resolved` without closure evidence of a
 * declared type, and refuses a terminal exit without a documented reason. Those two refusals are
 * conformance requirements 1 and 2, enforced here rather than left to callers.
 */
export function transition(obligation, { to, actor, at, evidence = null, reason = null, detail = {} }) {
  requireActor(actor);
  requireAt(at);
  if (!STATES.includes(to)) throw new Error(`unknown state ${JSON.stringify(to)}`);

  const from = obligation.state;
  if (!permittedTransitions(from).includes(to)) {
    throw new Error(`transition ${from} -> ${to} is not permitted. Section 3: permitted transitions only. `
      + `From ${from} the legal moves are: ${permittedTransitions(from).join(', ')}.`);
  }
  if (!isPlainObject(detail)) throw new Error('detail must be an object, and must carry no free-text PHI (section 5)');

  const isReopen = TERMINAL_STATES.includes(from);
  let closure = obligation.closure;

  if (isReopen) {
    if (!reason || typeof reason !== 'string') {
      throw new Error(`reopening a ${from} obligation requires a documented reason and an actor. `
        + 'It does not require evidence: closing needs evidence, reopening needs only a name, '
        + 'because the dangerous direction is discharge.');
    }
    // The closure that was recorded stays in `history`, with the name of whoever recorded it still
    // against it. Only the current view is cleared. Nothing is rewritten, so section 11.6 holds:
    // the whole story, including the mistake and its correction, is in one object.
    closure = null;
  } else if (to === 'resolved') {
    if (!isPlainObject(evidence) || !EVIDENCE_TYPES[evidence.type]) {
      throw new Error('resolved requires closure evidence of a declared type: '
        + `${Object.keys(EVIDENCE_TYPES).join(', ')}. Section 4.2 prohibits closure by elapsed time, `
        + 'by a reminder being delivered or read, or by absence of contradicting information.');
    }
    closure = {
      evidence: { ...evidence, tier: EVIDENCE_TYPES[evidence.type].tier },
      at,
      recorded_by: actor,
      counts_as_closure: true,
    };
  } else if (TERMINAL_EXITS.includes(to)) {
    if (!reason || typeof reason !== 'string') {
      throw new Error(`${to} is terminal and requires an explicit documented reason and an actor (section 3, 11.1)`);
    }
    closure = {
      evidence: null,
      reason,
      at,
      recorded_by: actor,
      // Section 4.4. This is the flag every metric must consult. lost_to_followup terminates the
      // escalation ladder without discharging the obligation, and must never be aggregated into
      // a closure rate.
      counts_as_closure: to !== NOT_A_CLOSURE,
    };
  }

  let event;
  if (isReopen) event = 'reopened';
  else if (TERMINAL_EXITS.includes(to)) event = 'state_changed';
  else event = PROGRESSION[from]?.[to] ?? 'state_changed';

  return append({ ...obligation, state: to, closure }, {
    at, actor, event, from_state: from, to_state: to, detail: isReopen ? { ...detail, reason } : detail,
  });
}

/**
 * Reopen a terminal obligation, because the terminal decision was wrong.
 *
 * Returns to `acknowledged`, never to `completed` or `resolved`. If an obligation was resolved on
 * evidence that turned out to be wrong, the completion is in doubt too, so the way back runs
 * through scheduling and fresh evidence like any other.
 *
 * WHY THIS IS NOT GATED ON EVIDENCE, AND NOT RESTRICTED TO THE ORIGINAL ACTOR
 *
 * Closing requires evidence of a declared type. Reopening requires only a documented reason and an
 * actor. The asymmetry is deliberate: the dangerous direction is discharge, so making the
 * conservative operation the hard one would mean mistaken closures persist, which is the harm
 * being prevented. Nor is it restricted to whoever recorded the closure. They may have left, and
 * if they made the mistake they are the least likely to notice it.
 *
 * The usual worry about an undo path does not apply here. Reopening moves an obligation out of the
 * closed column and back into the open one, so it makes the closure rate worse. Nobody games a
 * metric in the direction that makes them look worse.
 *
 * NOTE ON REOPENING A SUPERSEDED OBLIGATION
 *
 * Permitted, because supersession can be recorded in error like anything else. But if the
 * obligation that superseded it is still open, the result is two open obligations sharing an
 * identity_key. Section 6 rule 3 already covers what to do: flag for human disambiguation, never
 * merge automatically. This function cannot see the other obligation, so it cannot check, and the
 * caller has to.
 */
export function reopen(obligation, { actor, at, reason, detail = {} }) {
  if (!TERMINAL_STATES.includes(obligation.state)) {
    throw new Error(`only a terminal obligation can be reopened; this one is ${obligation.state}`);
  }
  return transition(obligation, { to: 'acknowledged', actor, at, reason, detail });
}

/** Whether an obligation has ever been reopened, which is a data-quality signal worth surfacing. */
export const wasReopened = (obligation) => obligation.history.some((h) => h.event === 'reopened');

/** R7 and section 3: verification of the extracted fields is what `created` -> `acknowledged` means. */
export function verify(obligation, { actor, at, corrections = [] }) {
  const next = transition(obligation, { to: 'acknowledged', actor, at, detail: { corrections: corrections.length } });
  return Object.freeze({
    ...next,
    extraction: {
      ...next.extraction,
      patient_verified: actor.kind === 'patient' ? true : next.extraction.patient_verified,
      // Section 2: field-level corrections are the highest-value training signal the system
      // generates, and are retained even under zero retention of source documents.
      patient_corrections: [...next.extraction.patient_corrections, ...corrections],
    },
  });
}

/** R3. Ownership transfer is an explicit, logged event, never an implicit reassignment. */
export function transferOwner(obligation, { to, actor, at }) {
  requireActor(actor);
  requireAt(at);
  if (!isPlainObject(to) || !OWNER_KINDS.includes(to.kind) || !to.ref) {
    throw new Error(`new owner must be {kind: ${OWNER_KINDS.join('|')}, ref}`);
  }
  return append({ ...obligation, owner: { ...to, since: at } }, {
    at,
    actor,
    event: 'owner_transferred',
    from_state: obligation.state,
    to_state: obligation.state,
    detail: { from: { kind: obligation.owner.kind, ref: obligation.owner.ref }, to: { kind: to.kind, ref: to.ref } },
  });
}

/** Reminders and escalations are logged but change no state. Section 8, and R1. */
export function record(obligation, { event, actor, at, detail = {} }) {
  requireActor(actor);
  requireAt(at);
  if (!['reminded', 'escalated', 'evidence_added', 'corrected'].includes(event)) {
    throw new Error(`record() is for non-transition events, got ${JSON.stringify(event)}`);
  }
  return append(obligation, {
    at, actor, event, from_state: obligation.state, to_state: obligation.state, detail,
  });
}

/**
 * Section 6. Whether a newer obligation supersedes an older one.
 *
 * Returns a decision rather than performing the change, because rule 3 requires that weakly
 * identified findings go to a human instead of being merged. Merging on weak evidence is more
 * dangerous than a duplicate: a duplicate is visible, whereas a wrong merge silently discharges a
 * real obligation.
 */
export function supersessionDecision(existing, incoming) {
  if (existing.finding.identity_key !== incoming.finding.identity_key) {
    return { decision: 'distinct', reason: 'identity keys differ' };
  }
  if (TERMINAL_STATES.includes(existing.state)) {
    return { decision: 'distinct', reason: `existing obligation is already ${existing.state}` };
  }
  // Rule 4, v0.5. A finding located by nearest match was chosen by a machine and may be the wrong
  // sentence, and a wrong finding produces a wrong identity key. Until a person has confirmed it,
  // which is what leaving `created` means, it neither supersedes nor is superseded.
  const unconfirmedNearest = (o) => o.finding.location === 'nearest_sentence' && o.state === 'created';
  if (unconfirmedNearest(existing) || unconfirmedNearest(incoming)) {
    return {
      decision: 'flag_for_human',
      reason: 'a finding located by nearest match has not been confirmed by a person (section 6, '
        + 'rule 4). Not merged automatically: the match may be the wrong sentence.',
    };
  }
  if (!(incoming.source.document_date > existing.source.document_date)) {
    return {
      decision: 'reject',
      reason: 'supersession requires a later document_date (section 6, rule 2). An older report '
        + 'must not displace a newer one.',
    };
  }
  if (!existing.finding.anatomy || !incoming.finding.anatomy) {
    return {
      decision: 'flag_for_human',
      reason: 'anatomy is absent or too coarse to distinguish these findings (section 6, rule 3). '
        + 'Not merged automatically: a wrong merge can silently discharge a real obligation.',
    };
  }
  return { decision: 'supersede', reason: 'same finding, later document' };
}

/**
 * Section 4.5, v0.5. What a study found automatically means for an obligation.
 *
 * `study` is {date: 'YYYY-MM-DD', modality, anatomy_covered: [anatomy...] | null}. Returns
 * {decision, reasons}, where decision is
 *
 *   not_evidence  a different modality, a known different region, or dated before the report
 *   close         every condition holds and could be checked
 *   propose       anything else: it may be the follow-up, and only a person can tell
 *
 * Returns a decision rather than closing, like supersessionDecision, because the dangerous outcome is
 * a closure nobody chose. Measured on MIMIC, most automatic matches were unrelated inpatient scans:
 * section 12.1 G.
 */
export function matchingStudyDecision(obligation, study) {
  if (!isPlainObject(study) || !isIsoDate(study.date)) {
    throw new Error('study needs a date in YYYY-MM-DD');
  }
  const docDate = obligation.source.document_date;
  const words = (v) => new Set(String(v ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

  // Not evidence at all.
  if (study.date < docDate) {
    return { decision: 'not_evidence', reasons: ['the study is dated before the report'] };
  }
  const wanted = words(obligation.recommendation.modality);
  const got = words(study.modality);
  const modalityKnown = wanted.size > 0 && got.size > 0;
  // A study matches when every word of the shorter name appears in the longer, so "CT" matches a
  // recommended "multi phasic CT" and "CTA" does not match "CT". A near miss is not evidence: the
  // obligation stays open, which is the safe direction.
  const sameModality = modalityKnown
    && ([...got].every((w) => wanted.has(w)) || [...wanted].every((w) => got.has(w)));
  if (modalityKnown && !sameModality) {
    return { decision: 'not_evidence', reasons: ['the study is not of the recommended modality'] };
  }
  const anatomy = obligation.finding.anatomy ?? null;
  const covered = Array.isArray(study.anatomy_covered) ? study.anatomy_covered : null;
  if (anatomy && covered && !covered.includes(anatomy)) {
    return { decision: 'not_evidence', reasons: [`the study does not cover ${anatomy}`] };
  }

  // Possibly evidence. Close only if nothing is in doubt.
  const reasons = [];
  if (!modalityKnown) reasons.push('the modality could not be compared');
  if (!anatomy) reasons.push('the finding has no recorded anatomy, so coverage cannot be checked');
  else if (!covered) reasons.push('the region the study covers is not known');
  if (study.date === docDate) reasons.push('the study is from the same day as the report');
  if (!obligation.due_date) {
    reasons.push('no interval was stated, so there is no due date to judge timing against');
  } else {
    const DAY = 86400000;
    const doc = Date.parse(`${docDate}T00:00:00Z`);
    const half = (Date.parse(`${obligation.due_date}T00:00:00Z`) - doc) / 2;
    const floor = new Date(doc + Math.floor(half / DAY) * DAY).toISOString().slice(0, 10);
    if (study.date < floor) reasons.push(`the study is earlier than half the stated interval (${floor})`);
  }
  return reasons.length
    ? { decision: 'propose', reasons }
    : { decision: 'close', reasons: ['modality, region and timing all match'] };
}

/**
 * Section 4.5, one proposal at a time. Every later study for an obligation, judged together.
 *
 * `studies` are as for matchingStudyDecision, each with an `id`. `rejected` lists study ids a person
 * has already rejected for this obligation; they are never offered again. Returns one of
 *
 *   {decision: 'close', study, reasons}     a study that closes it on its own
 *   {decision: 'propose', studies: [...]}   ONE proposal listing every doubtful candidate, each with
 *                                           its reasons, for a person to look at together
 *   {decision: 'none'}                      nothing bears on this obligation
 *
 * One proposal rather than one per study, because in the MIMIC run a single obligation would
 * otherwise have raised 51 prompts, and a prompt repeated fifty times stops being read.
 */
export function closureProposal(obligation, studies, { rejected = [] } = {}) {
  const skip = new Set(rejected);
  const pending = [];
  const ordered = [...studies].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const study of ordered) {
    if (!study.id) throw new Error('each study needs an id, so a rejection can be remembered');
    if (skip.has(study.id)) continue;
    const d = matchingStudyDecision(obligation, study);
    if (d.decision === 'close') return { decision: 'close', study, reasons: d.reasons };
    if (d.decision === 'propose') pending.push({ study, reasons: d.reasons });
  }
  return pending.length ? { decision: 'propose', studies: pending } : { decision: 'none' };
}

/** Apply a `supersede` decision, moving the older obligation to its terminal state. */
export function supersede(existing, incoming, { actor, at }) {
  const { decision, reason } = supersessionDecision(existing, incoming);
  if (decision !== 'supersede') {
    throw new Error(`refusing to supersede: ${decision}. ${reason}`);
  }
  return transition(existing, {
    to: 'superseded',
    actor,
    at,
    reason: `replaced by ${incoming.id}`,
    detail: { superseded_by: incoming.id },
  });
}

/**
 * Section 11.6. The full trajectory, reconstructed from history alone.
 *
 * If this cannot be produced, the deployment is non-compliant, so it is a function rather than a
 * documentation promise. It reads only `history`, never the obligation's current fields, which is
 * the whole point: it proves the record is sufficient on its own.
 */
export function reconstruct(obligation) {
  const steps = obligation.history.map((h) => ({
    at: h.at,
    actor: `${h.actor.kind}:${h.actor.ref}`,
    event: h.event,
    state: h.to_state,
    detail: h.detail,
  }));
  const states = obligation.history
    .filter((h) => h.to_state !== h.from_state)
    .map((h) => h.to_state);
  return {
    steps,
    state_path: states,
    final_state: states[states.length - 1] ?? null,
    owners: obligation.history
      .filter((h) => h.event === 'owner_transferred' || h.event === 'created')
      .map((h) => ({ at: h.at, to: h.detail.to ?? null })),
    complete: obligation.history.every((h) => h.at && h.actor?.kind && h.actor?.ref && h.event),
  };
}

/**
 * Section 4.3 and 11.3. Counts for reporting.
 *
 * lost_to_followup is returned as its own field and is never added into `closed`. Any caller that
 * wants a single headline number has to decide to add them together itself, in the open, which is
 * the point.
 */
export function tally(obligations) {
  const counts = { open: 0, closed: 0, lost_to_followup: 0, ever_reopened: 0, by_state: {} };
  for (const o of obligations) {
    counts.by_state[o.state] = (counts.by_state[o.state] ?? 0) + 1;
    if (o.state === NOT_A_CLOSURE) counts.lost_to_followup++;
    else if (CLOSURE_STATES.includes(o.state)) counts.closed++;
    else counts.open++;
    // Reported because a rising reopen rate means closures are being recorded carelessly, and
    // that is worth seeing early. Counted over all obligations regardless of current state: an
    // obligation reopened and then properly closed still says something about the first closure.
    if (wasReopened(o)) counts.ever_reopened++;
  }
  return counts;
}
