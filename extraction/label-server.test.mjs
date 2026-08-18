// Tests for the labelling tool's server side.
//
//   node --test extraction/label-server.test.mjs
//
// The browser collects a selection and some dropdown values and is trusted with none of it. Every
// check runs here, so this is where they are tested. The span round-trip is the one that matters:
// a span off by two characters still loads, still looks well-formed, and points at the wrong
// sentence, which is the error the whole verification screen exists to prevent downstream.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildEntry } from './label-server.mjs';
import { sha256 } from './labels.mjs';

const report = {
  id: 'r1',
  text: 'CT CHEST\n\nFINDINGS: 8 mm nodule in the right upper lobe.\n\n'
    + 'IMPRESSION: Recommend CT follow-up in 6 months.',
};

const at = (needle) => {
  const s = report.text.indexOf(needle);
  if (s === -1) throw new Error(`fixture error: ${needle} not present`);
  return [s, s + needle.length];
};

const rec = (over = {}) => ({
  recommendation_span: at('Recommend CT follow-up in 6 months.'),
  finding: 'pulmonary_nodule',
  action: 'imaging',
  ...over,
});

describe('the span is authoritative and the quote is derived from it', () => {
  test('the stored quote comes from the report, not from the browser', () => {
    const e = buildEntry(report, { recommendations: [rec()] });
    const r = e.recommendations[0];
    assert.equal(r.recommendation_verbatim, 'Recommend CT follow-up in 6 months.');
    assert.equal(report.text.slice(...r.recommendation_span), r.recommendation_verbatim);
  });

  test('a quote sent by the browser cannot override the offsets', () => {
    // If a widget ever disagreed with its own selection, the offsets win, so the stored label
    // matches the report rather than matching what the page believed.
    const e = buildEntry(report, {
      recommendations: [rec({ recommendation_verbatim: 'something else entirely' })],
    });
    assert.equal(e.recommendations[0].recommendation_verbatim, 'Recommend CT follow-up in 6 months.');
  });

  test('the finding span round-trips too', () => {
    const e = buildEntry(report, {
      recommendations: [rec({ finding_span: at('8 mm nodule in the right upper lobe') })],
    });
    const r = e.recommendations[0];
    assert.equal(r.finding_verbatim, '8 mm nodule in the right upper lobe');
    assert.equal(report.text.slice(...r.finding_span), r.finding_verbatim);
  });

  test('the text hash is recorded, so later corpus drift is detectable', () => {
    const e = buildEntry(report, { recommendations: [] });
    assert.equal(e.text_sha256, sha256(report.text));
  });
});

describe('what it refuses', () => {
  test('no selection', () => {
    assert.throws(() => buildEntry(report, { recommendations: [{ ...rec(), recommendation_span: null }] }),
      /no text selected/);
  });

  test('a whitespace-only selection', () => {
    const nl = report.text.indexOf('\n');
    assert.throws(() => buildEntry(report, {
      recommendations: [rec({ recommendation_span: [nl, nl + 2] })],
    }), /span is empty/);
  });

  test('a finding category outside the controlled vocabulary', () => {
    assert.throws(() => buildEntry(report, { recommendations: [rec({ finding: 'made_up' })] }),
      /pick a finding category/);
  });

  test('an action outside the controlled vocabulary', () => {
    assert.throws(() => buildEntry(report, { recommendations: [rec({ action: 'have_a_think' })] }),
      /pick an action/);
  });

  test('an interval value with nothing quoted to support it', () => {
    // Section 4: a value has to be readable in the report. Without the words it came from there is
    // no way to tell a reading from a guess.
    assert.throws(() => buildEntry(report, {
      recommendations: [rec({ interval_value: '6', interval_unit: 'month' })],
    }), /interval_verbatim/);
  });

  test('a negative or zero interval', () => {
    for (const v of ['-3', '0']) {
      assert.throws(() => buildEntry(report, {
        recommendations: [rec({ interval_value: v, interval_unit: 'month', interval_verbatim: 'in 6 months' })],
      }), /positive number/);
    }
  });

  test('a value read from a de-identified placeholder', () => {
    // Section 7.1. There is no number in "in ___ months", so a value here is a guess.
    assert.throws(() => buildEntry(report, {
      recommendations: [rec({
        interval_value: '6', interval_unit: 'month', interval_verbatim: 'in ___ months',
      })],
    }), /de-identified placeholder/);
  });
});

describe('what it accepts', () => {
  test('an interval with its words quoted', () => {
    const e = buildEntry(report, {
      recommendations: [rec({ interval_value: '6', interval_unit: 'month', interval_verbatim: 'in 6 months' })],
    });
    assert.deepEqual(e.recommendations[0].interval, { value: 6, unit: 'month' });
    assert.equal(e.recommendations[0].interval_verbatim, 'in 6 months');
  });

  test('a de-identified placeholder with no value, which is the section 7.1 label', () => {
    const e = buildEntry(report, {
      recommendations: [rec({ interval_verbatim: 'in ___ months' })],
    });
    assert.equal(e.recommendations[0].interval, null);
    assert.equal(e.recommendations[0].interval_verbatim, 'in ___ months');
  });

  test('a report with no recommendation, which is the common case', () => {
    const e = buildEntry(report, { recommendations: [] });
    assert.deepEqual(e.recommendations, []);
    assert.equal(e.report_id, 'r1');
  });

  test('empty optional fields become null rather than empty strings', () => {
    const e = buildEntry(report, { recommendations: [rec({ anatomy: '  ', modality: '' })] });
    assert.equal(e.recommendations[0].anatomy, null);
    assert.equal(e.recommendations[0].modality, null);
    assert.equal(e.date_found, null);
  });

  test('flags carry through', () => {
    const e = buildEntry(report, {
      recommendations: [rec({ conditional: true, negated: true, already_scheduled: true })],
    });
    const r = e.recommendations[0];
    assert.equal(r.conditional, true);
    assert.equal(r.negated, true);
    assert.equal(r.already_scheduled, true);
  });
});
