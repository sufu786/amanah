// The portable clinical obligation: the object, its state machine, and its history.
//
// This implements sections 2 to 6 of OBLIGATION_SPEC.md. It is the primitive the specification is
// actually about. Everything in extraction/ produces a *proposal* for one of these; nothing until
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

export const SCHEMA = 'cor.obligation/0.2';

// Section 3. The live path, and the terminal exits.
export const STATES = [
  'created', 'acknowledged', 'scheduled', 'completed', 'resolved',
  'declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased',
];

export const TERMINAL_STATES = [
  'resolved', 'declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased',
];

// Section 4.3. lost_to_followup terminates the escalation ladder; it does not discharge the
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

// Section 3, "permitted transitions only". Anything not listed is rejected. The terminal exits
// are reachable from any live state, which is what the left-hand bar in the diagram shows.
const LIVE_STATES = ['created', 'acknowledged', 'scheduled', 'completed'];
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
 * Both of those were ambiguous in specification v0.2 and are settled in v0.3, sections 12.1 A and
 * D. This implementation took the conservative reading first and the specification was corrected to
 * match, rather than the other way round.
 */
export function permittedTransitions(state) {
  if (TERMINAL_STATES.includes(state)) return [];
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
export function identityKey({ subject_ref, category, anatomy = null, laterality = null }) {
  if (!subject_ref) throw new Error('identityKey requires subject_ref');
  if (!category) throw new Error('identityKey requires a finding category');
  const normalisedAnatomy = anatomy ? String(anatomy).trim().toLowerCase() : '';
  const normalisedLaterality = laterality ? String(laterality).trim().toLowerCase() : '';
  return createHash('sha256')
    .update([subject_ref, category, normalisedAnatomy, normalisedLaterality].join('|'), 'utf8')
    .digest('hex');
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
  if (!isPlainObject(finding) || !finding.text_verbatim || !finding.category) {
    throw new Error('finding needs {text_verbatim, category}. R5: the verbatim source is retained, never paraphrased.');
  }
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
      ...finding,
      identity_key: identityKey({
        subject_ref,
        category: finding.category,
        anatomy: finding.anatomy ?? null,
        laterality: finding.laterality ?? null,
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
  if (TERMINAL_STATES.includes(from)) {
    throw new Error(`${from} is terminal; no transition out of it exists. Section 3 draws no reopen edge.`);
  }
  if (!permittedTransitions(from).includes(to)) {
    throw new Error(`transition ${from} -> ${to} is not permitted. Section 3: permitted transitions only. `
      + `From ${from} the legal moves are: ${permittedTransitions(from).join(', ')}.`);
  }
  if (!isPlainObject(detail)) throw new Error('detail must be an object, and must carry no free-text PHI (section 5)');

  let closure = obligation.closure;

  if (to === 'resolved') {
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
      // Section 4.3. This is the flag every metric must consult. lost_to_followup terminates the
      // escalation ladder without discharging the obligation, and must never be aggregated into
      // a closure rate.
      counts_as_closure: to !== NOT_A_CLOSURE,
    };
  }

  const event = TERMINAL_EXITS.includes(to) ? 'state_changed' : (PROGRESSION[from]?.[to] ?? 'state_changed');
  return append({ ...obligation, state: to, closure }, {
    at, actor, event, from_state: from, to_state: to, detail,
  });
}

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
  const counts = { open: 0, closed: 0, lost_to_followup: 0, by_state: {} };
  for (const o of obligations) {
    counts.by_state[o.state] = (counts.by_state[o.state] ?? 0) + 1;
    if (o.state === NOT_A_CLOSURE) counts.lost_to_followup++;
    else if (CLOSURE_STATES.includes(o.state)) counts.closed++;
    else counts.open++;
  }
  return counts;
}
