// Where each follow-up stands, in words for the patient. Phase 2, stage 3.
//
// escalation.mjs says which rung of the section 8 ladder an obligation is on, and names who acts at
// each rung: an owner, a registered clinician, a coordinator, a service lead. A patient using this
// app alone has none of those people in it. So the rung is kept exactly as the ladder computes it,
// and only the words change: each rung becomes something the patient can do themselves.
//
// The words are system text, so the test runs them through the same check as the prepared summary.
// Being past a due date is stated as a count of days and a question to ask. It is never called
// urgent, and the app never says what a delay might mean.

import { escalationLevel } from '../obligation/escalation.mjs';
import { daysBetween } from '../obligation/summary.mjs';

export const STATUS_COPY = {
  closed: 'Closed.',
  dated_ahead: (days) => `Due in ${days} day${days === 1 ? '' : 's'}.`,
  dated_soon: (days) => `Due in ${days} day${days === 1 ? '' : 's'}. Check that it has been arranged.`,
  dated_today: 'Due today. Check that it has been arranged.',
  dated_past: (days) => `${days} day${days === 1 ? '' : 's'} past the date it was due. Ask the clinic that wrote your report whether it has been arranged.`,
  dated_long_past: (days) => `${days} days past the date it was due. Please contact the clinic that wrote your report, or your own doctor, and take the printed summary with you.`,
  undated: 'Your report did not say when this should happen.',
  undated_ask: 'Your report did not say when this should happen. Ask your doctor when it is due.',
};

/**
 * The patient's view of one obligation as of `now` (YYYY-MM-DD). Returns the ladder's own result
 * beside a headline, so nothing the ladder decided is hidden behind the wording.
 */
export function patientStatus(obligation, now) {
  const ladder = escalationLevel(obligation, { now });
  if (ladder.level === null) return { ladder, tone: 'closed', headline: STATUS_COPY.closed };

  if (ladder.no_due_date) {
    return { ladder, tone: ladder.level === 'L0' ? 'quiet' : 'ask', headline: ladder.level === 'L0' ? STATUS_COPY.undated : STATUS_COPY.undated_ask };
  }

  const toGo = daysBetween(now, obligation.due_date);
  let headline;
  let tone;
  if (ladder.level === 'L0') { headline = STATUS_COPY.dated_ahead(toGo); tone = 'quiet'; }
  else if (ladder.level === 'L1') { headline = STATUS_COPY.dated_soon(toGo); tone = 'ask'; }
  else if (toGo === 0) { headline = STATUS_COPY.dated_today; tone = 'ask'; }
  else if (ladder.level === 'L2') { headline = STATUS_COPY.dated_past(-toGo); tone = 'ask'; }
  else { headline = STATUS_COPY.dated_long_past(-toGo); tone = 'act'; }
  return { ladder, tone, headline };
}
