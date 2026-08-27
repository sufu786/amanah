// Tests for the pure parts of per-sentence detection.
//
//   node --test extraction/detect.test.mjs
//
// The model calls are not tested here; they need Ollama and they are measured in RESULTS.md instead.
// What is tested is everything that decides WHICH text reaches the model and which candidates
// survive, because both defects found in this pipeline so far lived there rather than in the model.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { tightSpan, dedupeRepeats } from './detect.mjs';

describe('the candidate span is the sentence, not the label above it', () => {
  // The defect this covers deleted the most serious obligation in the pilot corpus. A heading and
  // its first sentence share a line, the heading travelled into the model as part of the sentence,
  // and the verifier flipped from keep to remove. Reproducible, and invisible in the metrics.
  const at = (text, needle) => {
    const s = text.indexOf(needle);
    return [s, s + needle.length];
  };

  test('a heading sharing the line is stripped', () => {
    const text = 'RECOMMENDATION(S):  Tissue diagnosis is recommended.\n\n';
    assert.equal(text.slice(...tightSpan(text, [0, text.length])), 'Tissue diagnosis is recommended.');
  });

  test('a sentence with no heading is untouched', () => {
    const text = 'Recommend followup to resolution.  ';
    assert.equal(text.slice(...tightSpan(text, [0, text.length])), 'Recommend followup to resolution.');
  });

  test('trailing whitespace and newlines are trimmed', () => {
    const text = 'IMPRESSION:  No acute fracture.\n\n\n';
    const span = tightSpan(text, [0, text.length]);
    assert.equal(text.slice(...span), 'No acute fracture.');
    assert.equal(text[span[1] - 1], '.', 'the span must end on the sentence, not on whitespace');
  });

  test('a heading with nothing after it is left alone rather than emptied', () => {
    const text = 'FINDINGS:\n';
    const span = tightSpan(text, [0, text.length]);
    assert.ok(text.slice(...span).trim().length > 0, 'stripping must not produce an empty span');
  });

  test('the span still round-trips to the stored quote', () => {
    const text = 'BI-RADS:  0 Incomplete - Need Additional Imaging Evaluation.\n';
    const span = tightSpan(text, at(text, 'BI-RADS:  0 Incomplete - Need Additional Imaging Evaluation.'));
    assert.equal(text.slice(...span), '0 Incomplete - Need Additional Imaging Evaluation.');
  });
});

describe('a sentence quoted twice is one duty', () => {
  // LABELLING.md 7.6. Reporting both copies would create two obligations for one duty, each closing
  // on separate evidence.
  const candidate = (verbatim, start, section) => ({
    recommendation_verbatim: verbatim,
    recommendation_span: [start, start + verbatim.length],
    section,
  });

  test('an identical repeat collapses to one', () => {
    const out = dedupeRepeats([
      candidate('Recommend followup to resolution.', 100, 'FINDINGS'),
      candidate('Recommend followup to resolution.', 500, 'IMPRESSION'),
    ]);
    assert.equal(out.length, 1);
  });

  test('the impression copy is the one kept, as 7.6 requires', () => {
    const out = dedupeRepeats([
      candidate('Recommend followup to resolution.', 100, 'FINDINGS'),
      candidate('Recommend followup to resolution.', 500, 'IMPRESSION'),
    ]);
    assert.equal(out[0].recommendation_span[0], 500);
  });

  test('a recommendation heading counts as preferred too', () => {
    const out = dedupeRepeats([
      candidate('Tissue diagnosis is recommended.', 900, 'RECOMMENDATION(S)'),
      candidate('Tissue diagnosis is recommended.', 200, 'FINDINGS'),
    ]);
    assert.equal(out[0].recommendation_span[0], 900);
  });

  test('with no preferred section, the later copy wins', () => {
    const out = dedupeRepeats([
      candidate('Continue follow-up.', 100, 'FINDINGS'),
      candidate('Continue follow-up.', 400, 'FINDINGS'),
    ]);
    assert.equal(out[0].recommendation_span[0], 400);
  });

  test('whitespace and case differences are still the same sentence', () => {
    const out = dedupeRepeats([
      candidate('Recommend\nfollowup to resolution.', 100, 'FINDINGS'),
      candidate('Recommend followup to resolution.', 500, 'IMPRESSION'),
    ]);
    assert.equal(out.length, 1);
  });

  test('differently worded sentences are left alone, because they may be two duties', () => {
    const out = dedupeRepeats([
      candidate('Additional imaging is needed.', 100, 'RECOMMENDATION'),
      candidate('0 Incomplete - Need Additional Imaging Evaluation.', 400, 'BI-RADS'),
    ]);
    assert.equal(out.length, 2, 'collapsing these would be a judgement, not a string comparison');
  });

  test('two genuinely different recommendations both survive', () => {
    const out = dedupeRepeats([
      candidate('Recommend followup to resolution.', 100, 'IMPRESSION'),
      candidate('Continue follow-up.', 400, 'IMPRESSION'),
    ]);
    assert.equal(out.length, 2);
  });

  test('report order is preserved', () => {
    const out = dedupeRepeats([
      candidate('Recommend followup to resolution.', 100, 'IMPRESSION'),
      candidate('Continue follow-up.', 400, 'IMPRESSION'),
    ]);
    assert.ok(out[0].recommendation_span[0] < out[1].recommendation_span[0]);
  });

  test('an empty list is not a special case', () => {
    assert.deepEqual(dedupeRepeats([]), []);
  });
});
