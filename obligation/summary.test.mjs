// Sections 8 and 9: the prepared summary and the escalation ladder.
//
//   node --test obligation/summary.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createObligation, verify, transition } from './obligation.mjs';
import { preparedSummary, findForbiddenLanguage, daysBetween, EN } from './summary.mjs';
import {
  escalationLevel, shouldIssueSummary, deliveryRoute, DEFAULT_INTERVALS,
} from './escalation.mjs';

const PATIENT = { kind: 'patient', ref: 'local-1' };
const CLINICIAN = { kind: 'clinician', ref: 'dr-2' };

const make = (over = {}) => createObligation({
  id: 'ob-1',
  subject_ref: 'opaque-local-id',
  finding: {
    text_verbatim: '8 mm nodule in the right upper lobe',
    category: 'pulmonary_nodule',
    anatomy: 'lung.right.upper_lobe',
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
  at: '2026-03-20T10:00:00Z',
  ...over,
});

describe('9  the prepared summary carries all seven required contents', () => {
  const s = preparedSummary(make(), { now: '2026-09-20' });

  test('the finding and the recommendation are quoted verbatim', () => {
    const finding = s.parts.find((p) => p.id === 'finding');
    const rec = s.parts.find((p) => p.id === 'recommendation');
    assert.equal(finding.text, '8 mm nodule in the right upper lobe');
    assert.equal(rec.text, 'recommend CT follow-up in 6 months');
    assert.ok(finding.verbatim && rec.verbatim, 'both must be marked verbatim so they are never scanned or reworded');
  });

  test('the source gives document date and locator', () => {
    const src = s.parts.find((p) => p.id === 'source').text;
    assert.match(src, /2026-03-14/);
    assert.match(src, /page 2, impression/);
  });

  test('the due date says how many days overdue', () => {
    const due = s.parts.find((p) => p.id === 'due').text;
    assert.match(due, /2026-09-14/);
    assert.match(due, /6 days past that date/);
  });

  test('a summary produced before the due date states no overdue count', () => {
    const early = preparedSummary(make(), { now: '2026-08-01' });
    assert.equal(early.parts.find((p) => p.id === 'due').text, '2026-09-14');
  });

  test('the guideline is named when one applies, and says so plainly when none does', () => {
    assert.equal(s.parts.find((p) => p.id === 'guideline').text, EN.no_guideline);
    const withGuideline = preparedSummary(make({
      recommendation: {
        text_verbatim: 'recommend CT follow-up in 6 months',
        action: 'imaging',
        interval: { value: 6, unit: 'month' },
        guideline: { id: 'fleischner_2017', version: '2017.1', rule: 'solid_nodule_6to8mm_low_risk' },
      },
    }), { now: '2026-09-20' });
    assert.match(withGuideline.parts.find((p) => p.id === 'guideline').text, /fleischner_2017 2017\.1/);
  });

  test('the request is phrased as an ask, in the words the specification gives', () => {
    assert.equal(s.parts.find((p) => p.id === 'ask').text, 'I am asking whether this follow-up has been arranged.');
  });

  test('verification status shows both confirmation and language validation', () => {
    const v = s.parts.find((p) => p.id === 'verification').text;
    assert.match(v, /not yet checked/, 'an unverified extraction must say so');
    assert.match(v, /has not been checked for this language/, 'C3: unvalidated language changes the page');

    const verified = preparedSummary(verify(make(), { actor: PATIENT, at: '2026-03-21T10:00:00Z' }), { now: '2026-09-20' });
    assert.match(verified.parts.find((p) => p.id === 'verification').text, /I have checked these details/);
  });

  test('no interval means no due date, and the page says so rather than inventing one', () => {
    const noDate = preparedSummary(make({
      recommendation: { text_verbatim: 'follow-up as per Fleischner criteria', action: 'imaging' },
    }), { now: '2026-09-20' });
    const due = noDate.parts.find((p) => p.id === 'due').text;
    assert.match(due, /did not say when/);
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(due), 'no date may appear where the report gave none');
  });
});

describe('9  prohibited contents', () => {
  test('the lexicon catches interpretation, risk, urgency and reassurance', () => {
    assert.ok(findForbiddenLanguage('this finding is suspicious').length);
    assert.ok(findForbiddenLanguage('there is a high risk of this').length);
    assert.ok(findForbiddenLanguage('please attend urgently').length);
    assert.ok(findForbiddenLanguage('your results are reassuring').length);
    assert.equal(findForbiddenLanguage('I am asking whether this follow-up has been arranged.').length, 0);
  });

  test('the default English copy is clean', () => {
    for (const [key, value] of Object.entries(EN)) {
      if (typeof value !== 'string') continue;
      assert.equal(findForbiddenLanguage(value).length, 0, `EN.${key} uses prohibited language: "${value}"`);
    }
  });

  test('a locale pack that interprets is refused, not rendered with a warning', () => {
    const bad = { ...EN, ask: 'This finding is serious and you must attend urgently.' };
    assert.throws(() => preparedSummary(make(), { now: '2026-09-20', copy: bad }), /prohibits/);
    assert.throws(() => preparedSummary(make(), { now: '2026-09-20', copy: bad }), /safety defect/);
  });

  test('the report\'s own urgent wording survives, because it is the clinician speaking', () => {
    // This is the case a plain blocklist over the finished page would get wrong. Section 9 forbids
    // "urgency language not present in the source report". Here it is present in the source.
    const urgent = make({
      recommendation: {
        text_verbatim: 'urgent CT chest recommended within 48 hours',
        action: 'imaging',
        interval: { value: 2, unit: 'day' },
      },
    });
    const s = preparedSummary(urgent, { now: '2026-03-20' });
    assert.match(s.text, /urgent CT chest recommended within 48 hours/);
    assert.ok(s.parts.find((p) => p.id === 'recommendation').verbatim);
  });

  test('a finding quoting a diagnosis is reproduced, not suppressed', () => {
    const s = preparedSummary(make({
      finding: { text_verbatim: 'mass suspicious for malignancy', category: 'pulmonary_nodule' },
    }), { now: '2026-09-20' });
    assert.match(s.text, /mass suspicious for malignancy/);
  });
});

describe('8  the escalation ladder', () => {
  const o = make(); // due 2026-09-14

  test('the rungs fall where section 8 puts them', () => {
    assert.equal(escalationLevel(o, { now: '2026-06-01' }).level, 'L0');
    assert.equal(escalationLevel(o, { now: '2026-08-15' }).level, 'L1', '30 days before due');
    assert.equal(escalationLevel(o, { now: '2026-09-14' }).level, 'L2', 'due date reached');
    assert.equal(escalationLevel(o, { now: '2026-10-14' }).level, 'L3', 'due plus 30');
    assert.equal(escalationLevel(o, { now: '2026-12-13' }).level, 'L4', 'due plus 90');
  });

  test('each rung names its target', () => {
    assert.equal(escalationLevel(o, { now: '2026-06-01' }).target, 'patient');
    assert.equal(escalationLevel(o, { now: '2026-08-15' }).target, 'owner');
    assert.match(escalationLevel(o, { now: '2026-09-14' }).target, /clinician/);
    assert.equal(escalationLevel(o, { now: '2026-10-14' }).target, 'coordinator');
    assert.equal(escalationLevel(o, { now: '2026-12-13' }).target, 'service lead');
  });

  test('L4 reports exhaustion and never performs the transition itself', () => {
    const l4 = escalationLevel(o, { now: '2027-06-01' });
    assert.equal(l4.level, 'L4');
    assert.equal(l4.exhausted, true);
    assert.match(l4.action, /a named actor records lost_to_followup/);
    // The obligation is untouched. R1: a terminal state needs an actor, not a timer.
    assert.equal(o.state, 'created');
  });

  test('nothing in the ladder reads a clock', () => {
    const raw = readFileSync(new URL('./escalation.mjs', import.meta.url), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    assert.equal([...src.matchAll(/\bDate\s*\.\s*now\s*\(/g), ...src.matchAll(/new\s+Date\s*\(\s*\)/g)].length, 0);
  });

  test('intervals are configurable per locale, the structure is not', () => {
    const slower = { L1: -60, L2: 0, L3: 45, L4: 120 };
    assert.equal(escalationLevel(o, { now: '2026-08-01', intervals: slower }).level, 'L1');
    assert.equal(escalationLevel(o, { now: '2026-08-01' }).level, 'L0', 'default intervals put this earlier');
    assert.deepEqual(Object.keys(DEFAULT_INTERVALS), ['L1', 'L2', 'L3', 'L4']);
  });

  test('an obligation with no due date keeps reminding at L0 instead of being dropped', () => {
    const noDate = make({ recommendation: { text_verbatim: 'follow-up advised', action: 'imaging' } });
    const l = escalationLevel(noDate, { now: '2030-01-01' });
    assert.equal(l.level, 'L0');
    assert.equal(l.days_from_due, null);
    assert.match(l.reason, /needs a human to establish a date/);
  });

  test('the ladder does not apply to a terminal obligation', () => {
    const declined = transition(verify(make(), { actor: PATIENT, at: '2026-03-21T10:00:00Z' }), {
      to: 'declined', actor: PATIENT, at: '2026-03-22T10:00:00Z', reason: 'patient declined, documented',
    });
    assert.equal(escalationLevel(declined, { now: '2027-01-01' }).level, null);
  });

  test('the summary is issued at L0 and re-issued at L1 only', () => {
    assert.ok(shouldIssueSummary('L0'));
    assert.ok(shouldIssueSummary('L1'));
    for (const l of ['L2', 'L3', 'L4']) assert.ok(!shouldIssueSummary(l));
  });

  test('anti-fatigue: institutional escalation goes to a worklist, not broadcast alerts', () => {
    assert.equal(deliveryRoute('L3', { institutional: true }).mode, 'worklist');
    assert.equal(deliveryRoute('L4', { institutional: true }).mode, 'worklist');
    assert.equal(deliveryRoute('L1', { institutional: true }).mode, 'direct', 'patient-facing rungs stay direct');
  });
});

describe('date arithmetic', () => {
  test('days between dates, in both directions', () => {
    assert.equal(daysBetween('2026-09-14', '2026-09-20'), 6);
    assert.equal(daysBetween('2026-09-20', '2026-09-14'), -6);
    assert.equal(daysBetween('2026-09-14', '2026-09-14'), 0);
    assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1, 'non-leap year');
    assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2, 'leap year');
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1, 'across a year');
  });
});
