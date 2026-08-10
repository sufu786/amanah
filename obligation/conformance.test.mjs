// Section 11 of OBLIGATION_SPEC.md, as executable tests.
//
// The specification states seven conditions an implementation must satisfy to conform. They are
// written as testable statements, so they are tested rather than asserted. Each test below names
// the requirement it covers.
//
//   node --test obligation/
//
// A note on what these are not. Passing does not mean the system is safe. It means this module
// does not violate the seven conditions the specification was able to state mechanically. The
// interesting failures in a follow-up registry are social and operational, and no test suite
// reaches them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createObligation, transition, verify, transferOwner, record, reconstruct, tally,
  supersede, supersessionDecision, identityKey, computeDueDate, reopen, wasReopened,
  permittedTransitions, STATES, TERMINAL_STATES, CLOSURE_STATES, NOT_A_CLOSURE, EVIDENCE_TYPES,
} from './obligation.mjs';

const PATIENT = { kind: 'patient', ref: 'local-1' };
const CLINICIAN = { kind: 'clinician', ref: 'dr-2' };
const COORDINATOR = { kind: 'coordinator', ref: 'coord-3' };

const T = (n) => `2026-03-${String(20 + n).padStart(2, '0')}T10:00:00Z`;

const base = (over = {}) => ({
  id: 'ob-1',
  subject_ref: 'opaque-local-id',
  finding: {
    text_verbatim: '8 mm nodule in the right upper lobe',
    category: 'pulmonary_nodule',
    anatomy: 'lung.right.upper_lobe',
    measurement: { value: 8, unit: 'mm' },
  },
  recommendation: {
    text_verbatim: 'recommend CT follow-up in 6 months',
    action: 'imaging',
    modality: 'CT',
    interval: { value: 6, unit: 'month' },
  },
  source: { kind: 'photo', document_date: '2026-03-14', locator: 'page 2, impression' },
  owner: { kind: 'patient', ref: 'local-1' },
  extraction: { confidence: 0.91, model: 'qwen2.5:7b', language: 'en', language_validated: false },
  actor: PATIENT,
  at: T(0),
  ...over,
});

const make = (over) => createObligation(base(over));

/** Walk an obligation to `completed`, the only state from which `resolved` is reachable. */
const toCompleted = () => {
  let o = make();
  o = verify(o, { actor: PATIENT, at: T(1) });
  o = transition(o, { to: 'scheduled', actor: PATIENT, at: T(2) });
  return transition(o, { to: 'completed', actor: CLINICIAN, at: T(3) });
};

describe('11.1  no terminal state without closure evidence or a documented reason', () => {
  test('resolved requires evidence of a declared type', () => {
    const o = toCompleted();
    assert.throws(() => transition(o, { to: 'resolved', actor: CLINICIAN, at: T(4) }), /closure evidence/);
    assert.throws(
      () => transition(o, { to: 'resolved', actor: CLINICIAN, at: T(4), evidence: { type: 'a_reminder_was_read' } }),
      /declared type/,
    );
  });

  test('every declared evidence type is accepted and carries its tier', () => {
    for (const [type, { tier }] of Object.entries(EVIDENCE_TYPES)) {
      const resolved = transition(toCompleted(), {
        to: 'resolved', actor: CLINICIAN, at: T(4), evidence: { type, ref: 'study-9' },
      });
      assert.equal(resolved.state, 'resolved');
      assert.equal(resolved.closure.evidence.type, type);
      assert.equal(resolved.closure.evidence.tier, tier, `${type} must be recorded at its own tier`);
    }
  });

  test('patient_attestation is accepted but distinguishable from objective evidence', () => {
    const o = transition(toCompleted(), {
      to: 'resolved', actor: PATIENT, at: T(4), evidence: { type: 'patient_attestation' },
    });
    assert.equal(o.closure.evidence.tier, 'self_reported');
    assert.notEqual(o.closure.evidence.tier, EVIDENCE_TYPES.matching_study.tier);
  });

  test('each terminal exit requires a documented reason', () => {
    for (const to of ['declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased']) {
      const o = verify(make(), { actor: PATIENT, at: T(1) });
      assert.throws(() => transition(o, { to, actor: CLINICIAN, at: T(2) }), /documented reason/, `${to} without a reason`);
      const done = transition(o, { to, actor: CLINICIAN, at: T(2), reason: 'documented' });
      assert.equal(done.state, to);
      assert.equal(done.closure.reason, 'documented');
    }
  });

  test('4.2  elapsed time closes nothing, enforced by the module never reading a clock', () => {
    // R2 is the requirement most easily broken by a well-meaning later change: one call to
    // Date.now() in an auto-close helper and silent expiry is back, which is the exact failure
    // this project exists to fix. Asserting it structurally is the only way to keep it true,
    // because no runtime test can wait six months to prove a due date did nothing.
    //
    // new Date(y, m, d) with explicit arguments is fine and is used for due-date arithmetic.
    // What is forbidden is reading the current time.
    const raw = readFileSync(new URL('./obligation.mjs', import.meta.url), 'utf8');
    // Comments are stripped first. The module's own header explains that it never calls the
    // clock, and a check that cannot tell prose from code would fail on that sentence.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const clockReads = [
      ...src.matchAll(/\bDate\s*\.\s*now\s*\(/g),
      ...src.matchAll(/new\s+Date\s*\(\s*\)/g),
      ...src.matchAll(/\bperformance\s*\.\s*now\s*\(/g),
    ];
    assert.equal(clockReads.length, 0,
      'obligation.mjs reads the current time. R2: elapsed time must never move an obligation.');
  });
});

describe('11.2  no transition without a history entry bearing an actor and a timestamp', () => {
  test('every history entry has both', () => {
    let o = toCompleted();
    o = transition(o, { to: 'resolved', actor: CLINICIAN, at: T(4), evidence: { type: 'matching_study' } });
    assert.ok(o.history.length >= 5);
    for (const h of o.history) {
      assert.ok(h.at, 'entry without a timestamp');
      assert.ok(h.actor?.kind && h.actor?.ref, 'entry without an actor');
      assert.ok(h.event, 'entry without an event');
    }
  });

  test('a transition without an actor is refused', () => {
    const o = make();
    assert.throws(() => transition(o, { to: 'acknowledged', at: T(1) }), /actor/);
    assert.throws(() => transition(o, { to: 'acknowledged', actor: { kind: 'wizard', ref: 'x' }, at: T(1) }), /actor/);
  });

  test('a transition without a timestamp is refused', () => {
    const o = make();
    assert.throws(() => transition(o, { to: 'acknowledged', actor: PATIENT }), /ISO 8601/);
    assert.throws(() => transition(o, { to: 'acknowledged', actor: PATIENT, at: '2026-03-20' }), /ISO 8601/);
  });

  test('history is append-only and earlier values stay true', () => {
    const before = make();
    const after = verify(before, { actor: PATIENT, at: T(1) });
    assert.equal(before.state, 'created', 'the earlier value must not be mutated');
    assert.equal(before.history.length, 1);
    assert.equal(after.history.length, 2);
    assert.throws(() => { after.history.push({}); }, TypeError);
  });

  test('non-transition events are logged too, without changing state', () => {
    const o = record(verify(make(), { actor: PATIENT, at: T(1) }), {
      event: 'reminded', actor: { kind: 'system', ref: 'scheduler' }, at: T(2), detail: { channel: 'sms', level: 'L1' },
    });
    assert.equal(o.state, 'acknowledged');
    assert.equal(o.history.at(-1).event, 'reminded');
    assert.equal(o.history.at(-1).detail.channel, 'sms');
  });
});

describe('11.3  lost_to_followup is reported separately from closures', () => {
  test('it is not in the closure set', () => {
    assert.ok(!CLOSURE_STATES.includes(NOT_A_CLOSURE));
    assert.ok(TERMINAL_STATES.includes(NOT_A_CLOSURE), 'it is still terminal');
  });

  test('its closure record is explicitly flagged as not a closure', () => {
    const o = transition(verify(make(), { actor: PATIENT, at: T(1) }), {
      to: NOT_A_CLOSURE, actor: COORDINATOR, at: T(2), reason: 'escalation ladder exhausted at L4',
    });
    assert.equal(o.closure.counts_as_closure, false);
  });

  test('tally never folds it into closed', () => {
    const lost = transition(verify(make(), { actor: PATIENT, at: T(1) }), {
      to: NOT_A_CLOSURE, actor: COORDINATOR, at: T(2), reason: 'ladder exhausted',
    });
    const resolved = transition(toCompleted(), {
      to: 'resolved', actor: CLINICIAN, at: T(4), evidence: { type: 'matching_study' },
    });
    const open = make();

    const t = tally([lost, resolved, open]);
    assert.equal(t.closed, 1, 'only the resolved one is closed');
    assert.equal(t.lost_to_followup, 1);
    assert.equal(t.open, 1);
    assert.ok(!Object.keys(t).includes('closure_rate'), 'no aggregate that could hide the distinction');
  });
});

describe('11.5  confidence and language validation are surfaced, not hidden', () => {
  test('creation without a confidence value is refused', () => {
    assert.throws(() => make({ extraction: { model: 'x', language: 'en' } }), /confidence/);
  });

  test('confidence and language_validated survive on the object', () => {
    const o = make();
    assert.equal(o.extraction.confidence, 0.91);
    assert.equal(o.extraction.language_validated, false);
  });

  test('verification records corrections rather than discarding them', () => {
    const o = verify(make(), {
      actor: PATIENT, at: T(1), corrections: [{ field: 'interval', from: null, to: '6 month' }],
    });
    assert.equal(o.extraction.patient_verified, true);
    assert.equal(o.extraction.patient_corrections.length, 1);
  });
});

describe('11.6  a full trajectory is reconstructable from history alone', () => {
  test('the path, actors and owners come back out', () => {
    let o = make();
    o = verify(o, { actor: PATIENT, at: T(1) });
    o = transferOwner(o, { to: COORDINATOR, actor: CLINICIAN, at: T(2) });
    o = record(o, { event: 'reminded', actor: { kind: 'system', ref: 'sched' }, at: T(3), detail: { level: 'L2' } });
    o = transition(o, { to: 'scheduled', actor: COORDINATOR, at: T(4) });
    o = transition(o, { to: 'completed', actor: CLINICIAN, at: T(5) });
    o = transition(o, {
      to: 'resolved', actor: CLINICIAN, at: T(6), evidence: { type: 'matching_study', ref: 'study-77' },
    });

    const r = reconstruct(o);
    assert.deepEqual(r.state_path, ['created', 'acknowledged', 'scheduled', 'completed', 'resolved']);
    assert.equal(r.final_state, 'resolved');
    assert.equal(r.final_state, o.state, 'reconstruction must agree with the object');
    assert.ok(r.complete);
    assert.ok(r.steps.some((s) => s.event === 'reminded'), 'a reminder must be reconstructable');
    assert.ok(r.steps.some((s) => s.event === 'owner_transferred'), 'an ownership change must be reconstructable');
    assert.ok(r.steps.every((s) => s.actor.includes(':')), 'every step names its actor');
  });
});

describe('11.7  the object is complete without the source document', () => {
  test('nothing requires the document to be retained', () => {
    const o = make({ source: { kind: 'photo', document_date: '2026-03-14', locator: 'page 2' } });
    assert.equal(o.source.retained, false);
    assert.ok(o.finding.text_verbatim, 'the verbatim finding travels with the object (R5, R8)');
    assert.ok(o.recommendation.text_verbatim);
    assert.ok(o.due_date, 'the due date is derived at creation, not recomputed from the document later');
  });
});

describe('section 3  permitted transitions only', () => {
  test('the illegal ones are refused', () => {
    const created = make();
    assert.throws(() => transition(created, { to: 'completed', actor: CLINICIAN, at: T(1) }), /not permitted/);
    assert.throws(() => transition(created, { to: 'scheduled', actor: CLINICIAN, at: T(1) }), /not permitted/);
    assert.throws(
      () => transition(created, { to: 'resolved', actor: CLINICIAN, at: T(1), evidence: { type: 'matching_study' } }),
      /not permitted/,
      'resolved must not be reachable from created even with evidence in hand',
    );
  });

  test('resolved is reachable only from completed', () => {
    for (const state of STATES) {
      const legal = permittedTransitions(state);
      if (state === 'completed') assert.ok(legal.includes('resolved'));
      else assert.ok(!legal.includes('resolved'), `${state} must not reach resolved directly`);
    }
  });

  test('a terminal state has exactly one way out, and it is reopen', () => {
    for (const s of TERMINAL_STATES) assert.deepEqual(permittedTransitions(s), ['acknowledged']);
    const resolved = transition(toCompleted(), {
      to: 'resolved', actor: CLINICIAN, at: T(4), evidence: { type: 'matching_result' },
    });
    // Without a reason it is refused, like every other terminal decision.
    assert.throws(() => transition(resolved, { to: 'acknowledged', actor: PATIENT, at: T(5) }),
      /documented reason/);
    // And it cannot skip back to a later state in the live path.
    for (const to of ['scheduled', 'completed', 'resolved']) {
      assert.throws(() => transition(resolved, { to, actor: PATIENT, at: T(5), reason: 'x' }),
        /not permitted/, `reopen must not jump straight to ${to}`);
    }
  });

  test('every live state can reach every terminal exit', () => {
    for (const from of ['created', 'acknowledged', 'scheduled', 'completed']) {
      const legal = permittedTransitions(from);
      for (const exit of ['declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased']) {
        assert.ok(legal.includes(exit), `${from} must be able to exit to ${exit}`);
      }
    }
  });
});

describe('section 6  finding identity across studies', () => {
  test('the key ignores measurement, because the finding changes size', () => {
    const a = identityKey({ subject_ref: 's', category: 'pulmonary_nodule', anatomy: 'lung.right.upper_lobe' });
    const b = identityKey({ subject_ref: 's', category: 'pulmonary_nodule', anatomy: 'lung.right.upper_lobe' });
    assert.equal(a, b);
    const other = identityKey({ subject_ref: 's', category: 'pulmonary_nodule', anatomy: 'lung.left.lower_lobe' });
    assert.notEqual(a, other);
    const otherSubject = identityKey({ subject_ref: 't', category: 'pulmonary_nodule', anatomy: 'lung.right.upper_lobe' });
    assert.notEqual(a, otherSubject, 'the key is per subject');
  });

  test('a later study supersedes an open obligation on the same finding', () => {
    const older = make();
    const newer = make({ id: 'ob-2', source: { kind: 'fhir', document_date: '2026-09-14' } });
    assert.equal(supersessionDecision(older, newer).decision, 'supersede');

    const done = supersede(older, newer, { actor: CLINICIAN, at: T(5) });
    assert.equal(done.state, 'superseded');
    assert.equal(done.history.at(-1).detail.superseded_by, 'ob-2');
  });

  test('an older document may not displace a newer one', () => {
    const existing = make({ source: { kind: 'fhir', document_date: '2026-09-14' } });
    const stale = make({ id: 'ob-2', source: { kind: 'photo', document_date: '2026-03-14' } });
    assert.equal(supersessionDecision(existing, stale).decision, 'reject');
    assert.throws(() => supersede(existing, stale, { actor: CLINICIAN, at: T(5) }), /refusing to supersede/);
  });

  test('weak anatomy goes to a human instead of being merged', () => {
    const vague = make({ finding: { text_verbatim: 'nodule in the lung', category: 'pulmonary_nodule' } });
    const later = make({
      id: 'ob-2',
      finding: { text_verbatim: 'nodule in the lung', category: 'pulmonary_nodule' },
      source: { kind: 'photo', document_date: '2026-09-14' },
    });
    const d = supersessionDecision(vague, later);
    assert.equal(d.decision, 'flag_for_human');
    assert.match(d.reason, /silently discharge/);
    assert.throws(() => supersede(vague, later, { actor: CLINICIAN, at: T(5) }), /flag_for_human/);
  });
});

describe('due dates', () => {
  test('document_date plus the stated interval, not the ingestion date', () => {
    assert.equal(computeDueDate('2026-03-14', { value: 6, unit: 'month' }), '2026-09-14');
    assert.equal(computeDueDate('2026-03-14', { value: 1, unit: 'year' }), '2027-03-14');
    assert.equal(computeDueDate('2026-03-14', { value: 2, unit: 'week' }), '2026-03-28');
    assert.equal(computeDueDate('2026-03-14', { value: 10, unit: 'day' }), '2026-03-24');
  });

  test('month arithmetic clamps instead of rolling over', () => {
    assert.equal(computeDueDate('2026-01-31', { value: 1, unit: 'month' }), '2026-02-28');
    assert.equal(computeDueDate('2028-01-31', { value: 1, unit: 'month' }), '2028-02-29', 'leap year');
    assert.equal(computeDueDate('2026-12-31', { value: 2, unit: 'month' }), '2027-02-28', 'crossing a year');
  });

  test('no stated interval means no due date, never an invented one', () => {
    assert.equal(computeDueDate('2026-03-14', null), null);
    const o = make({
      recommendation: { text_verbatim: 'follow-up as per Fleischner criteria', action: 'imaging' },
    });
    assert.equal(o.due_date, null);
    assert.equal(o.due_date_basis, 'no_interval_stated');
  });

  test('an old report produces an obligation that is already overdue', () => {
    const o = make({ source: { kind: 'photo', document_date: '2024-01-10' } });
    assert.equal(o.due_date, '2024-07-10');
    assert.ok(o.due_date < '2026-03-20', 'the due date is in the past, as it must be');
  });
});

describe('R3  exactly one owner at all times', () => {
  test('creation requires an owner and transfer is logged', () => {
    assert.throws(() => make({ owner: undefined }), /owner/);
    const o = transferOwner(make(), { to: COORDINATOR, actor: CLINICIAN, at: T(1) });
    assert.equal(o.owner.kind, 'coordinator');
    assert.equal(o.owner.since, T(1));
    assert.equal(o.history.at(-1).event, 'owner_transferred');
    assert.equal(o.history.at(-1).detail.from.ref, 'local-1');
  });
});

describe('reopen  when a terminal decision was wrong (section 12.1 B, resolved in v0.4)', () => {
  const terminal = (to, reason) => transition(verify(make(), { actor: PATIENT, at: T(1) }), {
    to, actor: CLINICIAN, at: T(2), reason,
  });

  test('every terminal state can be reopened, because any of them can be recorded in error', () => {
    for (const state of ['declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased']) {
      const o = reopen(terminal(state, 'recorded'), {
        actor: COORDINATOR, at: T(3), reason: 'recorded against the wrong obligation',
      });
      assert.equal(o.state, 'acknowledged', `${state} must be reopenable`);
    }
    const resolved = transition(toCompleted(), {
      to: 'resolved', actor: CLINICIAN, at: T(4), evidence: { type: 'matching_study' },
    });
    assert.equal(reopen(resolved, { actor: CLINICIAN, at: T(5), reason: 'the study was a different patient' }).state,
      'acknowledged');
  });

  test('a reason and an actor are required; evidence is not', () => {
    const declined = terminal('declined', 'patient declined');
    assert.throws(() => reopen(declined, { actor: CLINICIAN, at: T(3) }), /documented reason/);
    assert.throws(() => reopen(declined, { at: T(3), reason: 'x' }), /actor/);
    // No evidence argument anywhere, deliberately. Closing needs evidence; reopening needs a name.
    assert.equal(reopen(declined, { actor: CLINICIAN, at: T(3), reason: 'recorded in error' }).state,
      'acknowledged');
  });

  test('the closure is cleared from the view but survives in history, with its original actor', () => {
    const declined = terminal('declined', 'patient declined, documented');
    assert.equal(declined.closure.reason, 'patient declined, documented');
    assert.equal(declined.closure.recorded_by.ref, CLINICIAN.ref);

    const reopened = reopen(declined, { actor: COORDINATOR, at: T(3), reason: 'wrong obligation' });
    assert.equal(reopened.closure, null, 'the current view no longer claims a closure');

    const closing = reopened.history.find((h) => h.to_state === 'declined');
    assert.ok(closing, 'the closing transition is still in history');
    assert.equal(closing.actor.ref, CLINICIAN.ref, 'with the name of whoever recorded it');
    assert.equal(reopened.history.at(-1).event, 'reopened');
    assert.equal(reopened.history.at(-1).detail.reason, 'wrong obligation');
  });

  test('11.6 still holds: the mistake and its correction are both in one object', () => {
    const r = reconstruct(reopen(terminal('not_indicated', 'clinician said unnecessary'), {
      actor: COORDINATOR, at: T(3), reason: 'the clinician was looking at a different finding',
    }));
    assert.deepEqual(r.state_path, ['created', 'acknowledged', 'not_indicated', 'acknowledged']);
    assert.equal(r.final_state, 'acknowledged');
    assert.ok(r.steps.some((s) => s.event === 'reopened'));
    assert.ok(r.complete);
  });

  test('resolved after a reopen still requires fresh evidence', () => {
    let o = reopen(terminal('declined', 'declined'), { actor: PATIENT, at: T(3), reason: 'changed mind' });
    o = transition(o, { to: 'scheduled', actor: PATIENT, at: T(4) });
    o = transition(o, { to: 'completed', actor: CLINICIAN, at: T(5) });
    assert.throws(() => transition(o, { to: 'resolved', actor: CLINICIAN, at: T(6) }), /closure evidence/);
    const done = transition(o, {
      to: 'resolved', actor: CLINICIAN, at: T(6), evidence: { type: 'matching_study' },
    });
    assert.equal(done.state, 'resolved');
  });

  test('a live obligation cannot be reopened', () => {
    assert.throws(() => reopen(make(), { actor: PATIENT, at: T(1), reason: 'x' }), /only a terminal/);
  });

  test('tally counts a reopened obligation as open, and reports the reopen separately', () => {
    const reopened = reopen(terminal('lost_to_followup', 'ladder exhausted'), {
      actor: COORDINATOR, at: T(3), reason: 'the patient came back',
    });
    const stillLost = terminal('lost_to_followup', 'ladder exhausted');

    const t = tally([reopened, stillLost]);
    assert.equal(t.open, 1, 'a reopened obligation is open again');
    assert.equal(t.lost_to_followup, 1, 'and no longer counted as lost');
    assert.equal(t.closed, 0);
    assert.equal(t.ever_reopened, 1, 'the reopen is visible as a data-quality signal');
    assert.ok(wasReopened(reopened));
    assert.ok(!wasReopened(stillLost));
  });

  test('an obligation reopened and properly closed still shows it was reopened', () => {
    let o = reopen(terminal('declined', 'declined'), { actor: PATIENT, at: T(3), reason: 'error' });
    o = transition(o, { to: 'scheduled', actor: PATIENT, at: T(4) });
    o = transition(o, { to: 'completed', actor: CLINICIAN, at: T(5) });
    o = transition(o, { to: 'resolved', actor: CLINICIAN, at: T(6), evidence: { type: 'matching_study' } });
    assert.equal(tally([o]).closed, 1);
    assert.equal(tally([o]).ever_reopened, 1, 'the first closure was still wrong, and that stays visible');
  });
});
