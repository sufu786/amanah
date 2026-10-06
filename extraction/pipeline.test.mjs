// Tests for pipeline.mjs. Phase 2, stage 1.
//
//   node --test extraction/pipeline.test.mjs
//
// The model is replaced by stubs, so these test the plumbing and the failure handling, not reading.
// Reading was measured in RESULTS.md. The stubbed answers still go through the real quote check, and
// the result goes through the real obligation layer, so the path from report to obligation is tested
// end to end. The report is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractReport, ModelUnavailableError } from './pipeline.mjs';
import { validateRecommendation } from './extract.mjs';
import { proposalsFromExtraction, acceptProposal } from '../obligation/from-extraction.mjs';

const REPORT = 'EXAM DATE: 2026-03-14\n\nFINDINGS: 8 mm nodule in the right upper lobe. '
  + 'Small hiatal hernia.\n\nIMPRESSION: Recommend CT chest in 6 months. '
  + 'Correlate clinically. If symptoms persist, repeat radiograph.';

const NODULE = 'Recommend CT chest in 6 months.';
const CLINICAL = 'Correlate clinically.';
const PERSIST = 'If symptoms persist, repeat radiograph.';

const hit = (sentence) => {
  const s = REPORT.indexOf(sentence);
  return {
    recommendation_verbatim: sentence, recommendation_span: [s, s + sentence.length],
    finding: 'other', action: 'unclear', finding_verbatim: null, finding_span: null, anatomy: null,
    modality: null, interval: null, interval_verbatim: null, conditional: false, negated: false,
    already_scheduled: false,
  };
};

const ANSWERS = {
  [NODULE]: {
    finding_verbatim: '8 mm nodule in the right upper lobe', finding: 'pulmonary_nodule',
    anatomy: 'lung', laterality: 'right', action: 'imaging', modality: 'CT',
    interval_value: 6, interval_unit: 'month', interval_verbatim: 'in 6 months', confidence: 0.9,
    conditional: false, negated: false, already_scheduled: false,
  },
  [CLINICAL]: {
    finding_verbatim: null, finding: 'other', anatomy: null, laterality: null, action: 'unclear',
    modality: null, interval_value: null, interval_unit: null, interval_verbatim: null,
    confidence: 0.3, conditional: false, negated: false, already_scheduled: false,
  },
  [PERSIST]: {
    finding_verbatim: null, finding: 'other', anatomy: null, laterality: null, action: 'imaging',
    modality: 'radiograph', interval_value: null, interval_unit: null, interval_verbatim: null,
    confidence: 0.7, conditional: true, condition_verbatim: 'If symptoms persist', negated: false,
    already_scheduled: false,
  },
};

// Stubs. Detection finds three sentences; verification doubts "Correlate clinically"; field filling
// answers through the real validateRecommendation, exactly as fields.mjs does.
const stages = (over = {}) => ({
  detect: async () => ({ hits: [hit(NODULE), hit(CLINICAL), hit(PERSIST)], asked: 6 }),
  verify: async (_text, sentence) => sentence !== CLINICAL,
  fill: async (text, sentence) => validateRecommendation({ ...ANSWERS[sentence], recommendation_verbatim: sentence }, text),
  ...over,
});

test('one report becomes first-tier items, a second tier, and candidate dates', async () => {
  const { result, run } = await extractReport(REPORT, { stages: stages() });
  assert.deepEqual(result.recommendations.map((r) => r.recommendation_verbatim), [NODULE, PERSIST]);
  assert.deepEqual(result.second_tier.map((r) => [r.recommendation_verbatim, r.doubt_reason]), [[CLINICAL, 'verification']]);
  assert.equal(result.extraction.no_recommendation_found, false);
  assert.deepEqual(run.date_candidates.map((d) => d.date), ['2026-03-14']);
  assert.equal(run.incomplete, false);
  assert.equal(run.candidates, 3);
  assert.equal(result.document.date_found, null, 'the report date is the patient\'s to confirm, never set here');
});

test('the result goes through the obligation layer as a patient alone would see it', async () => {
  const { result, run } = await extractReport(REPORT, { stages: stages() });
  // The patient confirms the report date offered to them.
  result.document.date_found = run.date_candidates[0].date;
  const out = proposalsFromExtraction(result, {
    subject_ref: 'local-1', threshold: 0.5, makeId: (i) => `ob-${i}`, reviewer: 'patient_only',
  });
  assert.equal(out.proposals.length, 2);
  assert.equal(out.second_tier[0].route, 'listed_quietly', 'a doubted item is never pushed at a patient alone');
  const persist = out.proposals.find((p) => p.recommendation.text_verbatim === PERSIST);
  assert.ok(persist.flags.includes('conditional'), 'a condition is never turned into a due date');

  const nodule = out.proposals.find((p) => p.recommendation.text_verbatim === NODULE);
  const ob = acceptProposal(nodule, {
    subject_ref: 'local-1', owner: { kind: 'patient', ref: 'local-1' },
    actor: { kind: 'patient', ref: 'local-1' }, at: '2026-03-20T10:00:00Z', extraction: {},
  });
  assert.equal(ob.due_date, '2026-09-14');
  assert.equal(ob.recommendation.modality_code, 'ct');
  assert.equal(ob.state, 'acknowledged');
});

test('detection failing is an error, never an empty result that reads as nothing found', async () => {
  const failing = stages({ detect: async () => { throw new Error('connection refused'); } });
  await assert.rejects(extractReport(REPORT, { stages: failing }), ModelUnavailableError);
});

test('verification failing keeps the candidate visible and says it was not verified', async () => {
  const failing = stages({ verify: async () => { throw new Error('connection reset'); } });
  const { result, run } = await extractReport(REPORT, { stages: failing });
  assert.equal(result.recommendations.length, 3, 'all three kept and filled: failing open, nothing is hidden');
  assert.equal(result.second_tier.length, 0);
  assert.equal(run.unverified.length, 3, 'and the screen can say which ones were not verified');
  assert.equal(run.incomplete, true);
});

test('field filling failing moves the candidate to the second tier, marked unread', async () => {
  const failing = stages({ fill: async () => { throw new Error('model stopped'); } });
  const { result, run } = await extractReport(REPORT, { stages: failing });
  assert.equal(result.recommendations.length, 0);
  assert.deepEqual(result.second_tier.map((r) => r.doubt_reason).sort(), ['fields_unavailable', 'fields_unavailable', 'verification']);
  assert.equal(run.unfilled.length, 2);
  assert.equal(run.incomplete, true);
  const out = proposalsFromExtraction({ ...result, document: { ...result.document, date_found: '2026-03-14' } }, {
    subject_ref: 'local-1', threshold: 0.5, makeId: (i) => `ob-${i}`, reviewer: 'patient_only',
  });
  assert.ok(out.second_tier.every((s) => s.fields_filled === false), 'nothing unread can become an obligation as it is');
});

test('an empty report is a failure to read, and asks no model anything', async () => {
  let called = false;
  const watch = stages({ detect: async () => { called = true; return { hits: [], asked: 0 }; } });
  const { result } = await extractReport('   ', { stages: watch });
  assert.equal(result.extraction.unparseable, true);
  assert.equal(called, false);
});

test('a report with nothing detected says so, and the obligation layer adds the C2 notice', async () => {
  const none = stages({ detect: async () => ({ hits: [], asked: 6 }) });
  const { result } = await extractReport(REPORT, { stages: none });
  assert.equal(result.extraction.no_recommendation_found, true);
  const out = proposalsFromExtraction({ ...result, document: { ...result.document, date_found: '2026-03-14' } }, {
    subject_ref: 'local-1', threshold: 0.5, makeId: (i) => `ob-${i}`,
  });
  assert.match(out.notice, /does not mean there is not one/);
});
