// Tests for dates.mjs.
//
//   node --test extraction/dates.test.mjs
//
// Every report here is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findDates } from './dates.mjs';

const dates = (t) => findDates(t).map((d) => d.date);

test('the common written forms are read', () => {
  assert.deepEqual(dates('EXAM DATE: 2026-03-14'), ['2026-03-14']);
  assert.deepEqual(dates('Dictated 14 March 2026.'), ['2026-03-14']);
  assert.deepEqual(dates('Dictated March 14, 2026.'), ['2026-03-14']);
  assert.deepEqual(dates('Dictated 14th Mar. 2026'), ['2026-03-14']);
  assert.deepEqual(dates('Seen 14-Mar-2026'), ['2026-03-14']);
});

test('a day above 12 settles the order; otherwise both readings are offered', () => {
  assert.deepEqual(dates('Date 14/03/2026'), ['2026-03-14'], 'only one reading is a real date');
  assert.deepEqual(dates('Date 03/14/2026'), ['2026-03-14']);
  const both = findDates('Date 03/04/2026');
  assert.deepEqual(both.map((d) => d.date), ['2026-03-04', '2026-04-03']);
  assert.ok(both.every((d) => d.ambiguous));
  assert.deepEqual(dates('Date 05/05/2026'), ['2026-05-05'], 'the same either way is one date');
});

test('nothing is guessed: two-digit years and impossible dates are not read', () => {
  assert.deepEqual(dates('Seen 1/2/24'), []);
  assert.deepEqual(dates('Seen 31/02/2026'), []);
  assert.deepEqual(dates('Seen 2026-13-01'), []);
  assert.deepEqual(dates('No date here at all.'), []);
  assert.deepEqual(dates(''), []);
  assert.deepEqual(dates(null), []);
});

test('every date is listed with where it is, in order, for the patient to choose', () => {
  const text = 'DOB: 02/15/1960. Exam 2026-03-14. Follow up in 6 months.';
  const found = findDates(text);
  assert.deepEqual(found.map((d) => d.date), ['1960-02-15', '2026-03-14'],
    'a date of birth is listed too; the patient chooses, the app does not');
  for (const d of found) assert.equal(text.slice(...d.span), d.text);
});
