// Tests for validateRecommendation: how quotes are located, and what happens when one is not.
//
//   node --test extraction/extract.test.mjs
//
// The reports below are written for these tests. None is from MIMIC or any other real source,
// because report text from a credentialed dataset may not enter this repository.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateRecommendation, nearestSentence, NEAREST_SENTENCE_MIN_SCORE } from './extract.mjs';

const REPORT = [
  'INDICATION:  Cough. History of a right upper lobe nodule.',
  '',
  'FINDINGS:  There is an 8 mm solid nodule in the right upper lobe, unchanged in size.',
  'The heart is normal in size.  No pleural effusion.',
  '',
  'IMPRESSION:  8 mm solid nodule in the right upper lobe.',
  'Recommend CT chest in 6 months for further evaluation.',
].join('\n');

const rec = (over = {}) => ({
  recommendation_verbatim: 'Recommend CT chest in 6 months for further evaluation.',
  finding_verbatim: '8 mm solid nodule in the right upper lobe.',
  finding: 'pulmonary_nodule',
  anatomy: 'lung',
  laterality: 'right',
  action: 'imaging',
  modality: 'CT',
  interval_value: 6,
  interval_unit: 'month',
  interval_verbatim: 'in 6 months',
  confidence: 0.9,
  ...over,
});

describe('validateRecommendation, the finding', () => {
  test('a finding quoted exactly is kept as it is, located exactly', () => {
    const v = validateRecommendation(rec(), REPORT);
    assert.equal(v.ok, true);
    assert.equal(v.value.finding_location, 'exact');
    assert.equal(v.value.finding_absence, null);
    assert.equal(v.value.finding_match_score, null);
    assert.equal(REPORT.slice(...v.value.finding_span), v.value.finding_verbatim);
  });

  test('a near miss is replaced by the nearest source sentence, never kept in its own words', () => {
    const v = validateRecommendation(rec({ finding_verbatim: 'an 8 mm solid nodule of the right upper lobe which is unchanged' }), REPORT);
    assert.equal(v.ok, true, 'the recommendation survives a finding quote that misses');
    assert.equal(v.value.finding_location, 'nearest_sentence');
    assert.ok(v.value.finding_match_score >= NEAREST_SENTENCE_MIN_SCORE);
    assert.equal(REPORT.slice(...v.value.finding_span), v.value.finding_verbatim,
      'what is stored is source text, located by span');
    assert.notEqual(v.value.finding_verbatim, 'an 8 mm solid nodule of the right upper lobe which is unchanged',
      'the extractor wording is never retained (R5)');
    assert.match(v.value.finding_verbatim, /unchanged in size/, 'it chose the findings sentence that matches best');
  });

  test('the recommendation quoted back as its own finding is not a near miss', () => {
    const v = validateRecommendation(rec({ finding_verbatim: 'recommend a CT of the chest in 6 months for evaluation' }), REPORT);
    assert.equal(v.ok, true);
    assert.equal(v.value.finding_absence, 'not_located');
    assert.equal(v.value.finding_verbatim, null);
    assert.equal(v.value.finding_span, null);
  });

  test('a quote that matches nothing well enough is absent, and the recommendation is kept', () => {
    const v = validateRecommendation(rec({ finding_verbatim: 'large left pleural effusion with mediastinal shift' }), REPORT);
    assert.equal(v.ok, true);
    assert.equal(v.value.finding_absence, 'not_located');
    assert.equal(v.value.finding_location, null);
    assert.equal(v.value.recommendation_verbatim, 'Recommend CT chest in 6 months for further evaluation.');
  });

  test('the indication is never where a finding is located by nearest match (LABELLING.md 7.4)', () => {
    // "History of a right upper lobe nodule." shares six of these nine words, more than any other
    // sentence in the report, so this passes only because the indication is excluded.
    const near = nearestSentence(REPORT, 'history of the right upper lobe nodule with cough', null);
    assert.ok(!/History of/.test(REPORT.slice(...near.span)),
      'the history line matches these words best and is still not a candidate');
  });

  test('the last word of a sentence matches like any other', () => {
    const near = nearestSentence('FINDINGS:  The heart is normal in size.', 'heart normal size', null);
    assert.equal(near.score, 1);
  });

  test('measurements match as measurements', () => {
    const near = nearestSentence('FINDINGS:  A 4.9 cm mass in the liver.', '4.9 cm liver mass', null);
    assert.equal(near.score, 1);
  });

  test('a quote too short to match on is absent rather than guessed', () => {
    const v = validateRecommendation(rec({ finding_verbatim: 'the nodules' }), REPORT);
    assert.equal(v.value.finding_absence, 'not_located');
  });

  test('a report naming no finding gives absence not_stated', () => {
    const v = validateRecommendation(rec({ finding_verbatim: 'none', finding: 'other' }), REPORT);
    assert.equal(v.ok, true);
    assert.equal(v.value.finding_absence, 'not_stated');
    assert.equal(v.value.finding_verbatim, null);
  });
});

describe('validateRecommendation, what still rejects', () => {
  test('a recommendation quote that cannot be located is still fabrication', () => {
    const v = validateRecommendation(rec({ recommendation_verbatim: 'Recommend PET-CT in 3 months.' }), REPORT);
    assert.deepEqual(v, { ok: false, reason: 'fabricated_recommendation_quote' });
  });

  test('an interval the source does not state is still refused', () => {
    const v = validateRecommendation(rec({ interval_value: 3, interval_verbatim: 'in 3 months' }), REPORT);
    assert.deepEqual(v, { ok: false, reason: 'interval_not_supported_by_source' });
  });
});
