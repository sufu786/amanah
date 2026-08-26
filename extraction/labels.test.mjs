// Tests for the loading and matching machinery in labels.mjs.
//
//   node --test extraction/labels.test.mjs
//
// This is the code that turns labels into numbers, and until section 7.6 forced a change to it, it
// had no tests at all. The matching rule in particular decides what counts as a hit, so a defect
// here does not produce an error. It produces a plausible metric that is wrong.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadLabelSet, matchBySpan, findRepeats, normaliseQuote, sha256 } from './labels.mjs';

// A report where the same sentence appears twice, in the findings and again in the impression.
// This is the shape section 7.6 is about, and the shape the pilot's report 19303239-RR-45 has.
const TEXT = 'FINDINGS:  Patchy left base opacity.  Recommend followup to resolution.\n\n'
  + 'IMPRESSION:  Patchy left base opacity.  Recommend\nfollowup to resolution.';

const at = (needle, from = 0) => {
  const s = TEXT.indexOf(needle, from);
  if (s === -1) throw new Error(`fixture error: ${needle} not present`);
  return [s, s + needle.length];
};

const IMPRESSION = at('Recommend\nfollowup to resolution');
const FINDINGS = at('Recommend followup to resolution');

const corpusData = {
  corpus: 'test',
  reports: new Map([['r1', {
    id: 'r1', language: 'en', text: TEXT, sha256: sha256(TEXT), modality: null,
  }]]),
};

const rec = (over = {}) => ({
  recommendation_verbatim: TEXT.slice(...IMPRESSION),
  recommendation_span: IMPRESSION,
  finding_verbatim: null,
  finding_span: null,
  anatomy: null,
  modality: null,
  interval: null,
  interval_verbatim: null,
  finding: 'other',
  action: 'imaging',
  conditional: false,
  negated: false,
  already_scheduled: false,
  ...over,
});

const writeSet = (recommendations) => {
  const dir = mkdtempSync(join(tmpdir(), 'amanah-labels-'));
  const path = join(dir, 'labels.json');
  writeFileSync(path, JSON.stringify({
    corpus: 'test',
    labeller: 'A',
    protocol_version: '0.1',
    labels: [{ report_id: 'r1', text_sha256: sha256(TEXT), recommendations }],
  }), 'utf8');
  return path;
};

describe('finding the same sentence written twice', () => {
  test('a repeat elsewhere in the report is found across a line break', () => {
    // The impression copy wraps mid-sentence and the findings copy does not. Line wrapping in
    // clinical reports is arbitrary, so the search has to ignore it.
    assert.deepEqual(findRepeats(TEXT, IMPRESSION), [FINDINGS]);
  });

  test('the span it was given is not returned as a repeat of itself', () => {
    assert.ok(!findRepeats(TEXT, IMPRESSION).some((s) => s[0] === IMPRESSION[0]));
  });

  test('a sentence appearing once has no repeats', () => {
    assert.deepEqual(findRepeats(TEXT, at('IMPRESSION:')), []);
  });

  test('normalising collapses the wrap, so both copies read the same', () => {
    assert.equal(
      normaliseQuote(TEXT.slice(...IMPRESSION)),
      normaliseQuote(TEXT.slice(...FINDINGS)),
    );
  });
});

describe('matching an extractor that quoted the other copy', () => {
  test('without equivalent spans the same duty scores as a miss and a false positive', () => {
    // The behaviour this change exists to fix, kept as a test so the regression is visible.
    const m = matchBySpan([rec()], [rec({ recommendation_span: FINDINGS })]);
    assert.equal(m.pairs.length, 0);
    assert.deepEqual(m.unmatchedA, [0]);
    assert.deepEqual(m.unmatchedB, [0]);
  });

  test('with an equivalent span recorded, the same duty matches', () => {
    const gold = rec({ equivalent_spans: [FINDINGS] });
    const pred = rec({ recommendation_span: FINDINGS });
    const m = matchBySpan([gold], [pred]);
    assert.equal(m.pairs.length, 1);
    assert.equal(m.unmatchedA.length, 0);
    assert.equal(m.unmatchedB.length, 0);
  });

  test('an unrelated span still does not match', () => {
    const gold = rec({ equivalent_spans: [FINDINGS] });
    const pred = rec({ recommendation_span: at('FINDINGS:') });
    assert.equal(matchBySpan([gold], [pred]).pairs.length, 0);
  });

  test('matching stays one-to-one when both copies are predicted', () => {
    // An extractor returning both copies has found one duty and reported it twice. Exactly one
    // prediction may match, so the second is still counted against precision.
    const gold = rec({ equivalent_spans: [FINDINGS] });
    const m = matchBySpan([gold], [rec(), rec({ recommendation_span: FINDINGS })]);
    assert.equal(m.pairs.length, 1);
    assert.equal(m.unmatchedB.length, 1);
  });
});

describe('what the loader refuses', () => {
  test('an equivalent span quoting different words', () => {
    // Without this check, equivalent_spans would be a licence to make gold match anything.
    const path = writeSet([rec({ equivalent_spans: [at('FINDINGS:')] })]);
    assert.throws(() => loadLabelSet(path, corpusData), /quotes different words/);
  });

  test('an equivalent span overlapping the canonical one', () => {
    const wider = [IMPRESSION[0] - 2, IMPRESSION[1]];
    const path = writeSet([rec({ equivalent_spans: [wider] })]);
    assert.throws(() => loadLabelSet(path, corpusData), /overlaps the canonical span/);
  });

  test('an equivalent span out of range', () => {
    const path = writeSet([rec({ equivalent_spans: [[0, TEXT.length + 50]] })]);
    assert.throws(() => loadLabelSet(path, corpusData), /out of range/);
  });

  test('two instances claiming the same words', () => {
    // Two findings, two follow-up sentences worded identically. The occurrence belongs to whichever
    // instance quoted it, and neither may claim the other's.
    const path = writeSet([
      rec({ equivalent_spans: [FINDINGS] }),
      rec({ recommendation_span: FINDINGS }),
    ]);
    assert.throws(() => loadLabelSet(path, corpusData), /cannot claim the same words/);
  });
});

describe('what the loader accepts', () => {
  test('a well-formed equivalent span survives loading', () => {
    const path = writeSet([rec({ equivalent_spans: [FINDINGS] })]);
    const set = loadLabelSet(path, corpusData);
    assert.deepEqual(set.labels.get('r1').recommendations[0].equivalent_spans, [FINDINGS]);
  });

  test('an instance with no equivalent spans is unaffected', () => {
    const path = writeSet([rec()]);
    const set = loadLabelSet(path, corpusData);
    assert.equal(set.labels.get('r1').recommendations[0].equivalent_spans, undefined);
  });
});
