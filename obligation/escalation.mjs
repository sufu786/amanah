// The escalation ladder. Section 8 of OBLIGATION_SPEC.md.
//
// This works out which rung an obligation is on. It does not act, and it does not change state.
//
// Exhausting the ladder at L4 reports exhaustion and names who should act. Somebody records the
// transition with their name against it, so that an obligation ending as lost_to_followup carries
// a record of which person accepted that outcome.
//
// Specification v0.2 said of L4 "on exhaustion, becomes lost_to_followup", which read as a state
// change caused by elapsed time and contradicted R1. This module refused to implement it that way,
// and v0.3 corrects the wording to say a named actor records it. See section 12.1 C.
//
// Intervals are configurable per locale pack. The ladder structure is not (section 8).

import { daysBetween } from './summary.mjs';

export const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'];

/** Days relative to due_date. Negative is before. Section 8, overridable per locale. */
export const DEFAULT_INTERVALS = { L1: -30, L2: 0, L3: 30, L4: 90 };

/**
 * Days after document_date at which an obligation with NO due date reaches the rungs that ask for
 * one. Section 8, v0.5, overridable per locale. These defaults are choices, not measurements: what
 * was measured is that without them 63 of 72 open obligations in the MIMIC run never left L0.
 */
export const DEFAULT_UNDATED_INTERVALS = { L2: 30, L3: 90 };

const UNDATED = {
  L2: {
    action: 'A due date is requested: the report stated none, and someone has to say when this is due',
    target: 'owner and registered clinician',
  },
  L3: {
    action: 'Appears on the coordinator worklist as having no due date established',
    target: 'coordinator',
  },
};

const LADDER = {
  L0: {
    action: 'Confirmation and prepared summary issued',
    target: 'patient',
  },
  L1: {
    action: 'Reminder, prepared summary re-issued',
    target: 'owner',
  },
  L2: {
    action: 'Reminder, ownership confirmation requested',
    target: 'owner and registered clinician',
  },
  L3: {
    action: 'Escalation, appears on coordinator worklist',
    target: 'coordinator',
  },
  L4: {
    action: 'Final escalation. On exhaustion a named actor records lost_to_followup',
    target: 'service lead',
  },
};

const TERMINAL = ['resolved', 'declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased'];
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Which rung an obligation is on, as of `now`.
 *
 * `now` is injected. Nothing here reads a clock, for the same reason nothing in obligation.mjs
 * does: a module that cannot see the time cannot let time move anything on its own.
 */
export function escalationLevel(obligation, {
  now, intervals = DEFAULT_INTERVALS, undatedIntervals = DEFAULT_UNDATED_INTERVALS,
} = {}) {
  if (!isIsoDate(now)) throw new Error('now must be a YYYY-MM-DD date, injected by the caller');

  if (TERMINAL.includes(obligation.state)) {
    return {
      level: null,
      action: 'none',
      target: null,
      exhausted: false,
      reason: `obligation is ${obligation.state}; the ladder does not apply to a terminal obligation`,
    };
  }

  // Section 8, v0.5. An obligation with no stated interval has no due date (R6), so the ordinary
  // rungs cannot be computed. Until v0.5 it stayed at L0 indefinitely, and in the MIMIC run that was
  // almost every real obligation. Its rungs are now measured from document_date and ask for the
  // missing date. It never reaches L4: lost_to_followup presupposes a due date that was missed.
  if (!obligation.due_date) {
    const since = daysBetween(obligation.source.document_date, now);
    const level = since >= undatedIntervals.L3 ? 'L3' : since >= undatedIntervals.L2 ? 'L2' : 'L0';
    return {
      level,
      ...(level === 'L0' ? LADDER.L0 : UNDATED[level]),
      exhausted: false,
      days_from_due: null,
      days_since_report: since,
      no_due_date: true,
      reason: level === 'L0'
        ? `no due date: the report stated no interval. A date will be requested ${undatedIntervals.L2} days after the report.`
        : `no due date ${since} days after the report: a person has to establish one`,
    };
  }

  const offset = daysBetween(obligation.due_date, now);
  let level = 'L0';
  for (const candidate of ['L1', 'L2', 'L3', 'L4']) {
    if (offset >= intervals[candidate]) level = candidate;
  }

  return {
    level,
    ...LADDER[level],
    // L4 exhausted is a recommendation to a named actor, never an automatic transition. See the
    // note at the top of this file.
    exhausted: level === 'L4',
    days_from_due: offset,
    reason: offset > 0
      ? `${offset} days past the due date`
      : `${Math.abs(offset)} days before the due date`,
  };
}

/**
 * Whether the prepared summary should be issued or re-issued at this rung.
 * Section 8: L0 issues it, L1 re-issues it. The later rungs are worklist and escalation actions.
 */
export function shouldIssueSummary(level) {
  return level === 'L0' || level === 'L1';
}

/**
 * The anti-fatigue rule, section 8.
 *
 * In institutional deployments the primary output is a worklist owned by a named coordinator, not
 * broadcast alerts to clinicians. Systems that invert this are ignored within weeks, and the
 * specification calls it the most consistently reported cause of failure in deployed tracking
 * programmes. So the routing is stated here in code rather than left to whoever writes the
 * notification layer.
 */
export function deliveryRoute(level, { institutional = false } = {}) {
  if (!institutional) return { mode: 'direct', to: LADDER[level]?.target ?? null };
  if (level === 'L3' || level === 'L4') return { mode: 'worklist', to: LADDER[level].target };
  return { mode: 'direct', to: LADDER[level]?.target ?? null };
}
