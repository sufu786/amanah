// Tests for checking.mjs. Phase 2, stage 2.
//
//   node --test app/
//
// The reading is built by pipeline.mjs with the model stubbed, so these run anywhere. The report is
// invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractReport } from '../extraction/pipeline.mjs';
import { prepareCheck, applyDecisions, MAY_HAVE_MISSED, NOT_READ_NOTICE } from './checking.mjs';
import { REPORT, NODULE, PERSIST, CLINICAL, stages } from './fixtures.mjs';
import { validateRecommendation } from '../extraction/extract.mjs';

// Answers for every item: `yes` lists the quotes answered yes, with optional details.
const answer = (c, yes = {}) => [...c.items, ...c.less_sure].map((i) => (i.quote in yes
  ? { id: i.id, answer: 'yes', ...(yes[i.quote] ? { details: yes[i.quote] } : {}) }
  : { id: i.id, answer: 'no' }));

let n = 0;
const makeId = () => `item-${++n}`;
const AT = '2026-03-20T10:00:00Z';

async function checked() {
  const reading = await extractReport(REPORT, { stages });
  return prepareCheck(reading, { date: '2026-03-14', makeId });
}

test('the patient is shown every item, the less sure ones in full, and the may-have-missed notice', async () => {
  const c = await checked();
  assert.deepEqual(c.items.map((i) => i.quote), [NODULE, PERSIST]);
  assert.deepEqual(c.less_sure.map((i) => i.quote), [CLINICAL], 'the doubted item is shown, not hidden');
  assert.ok(c.notices.includes(MAY_HAVE_MISSED), 'found something is not the same as found everything');
  assert.equal(c.items[0].score, 0.9);
  assert.equal(c.less_sure[0].score, null, 'no score is shown for an item the model never scored');
});

test('a report date is required before anything is shown', async () => {
  const reading = await extractReport(REPORT, { stages });
  assert.throws(() => prepareCheck(reading, { date: '' }), /report date is needed/);
});

test('only a yes makes an obligation, and a condition is kept as a question, never a due date', async () => {
  const c = await checked();
  const [nodule, persist] = c.items;
  const out = applyDecisions(c, {
    text: REPORT, at: AT,
    decisions: [{ id: nodule.id, answer: 'yes' }, { id: persist.id, answer: 'yes' }, { id: c.less_sure[0].id, answer: 'no' }],
  });
  assert.equal(out.obligations.length, 1);
  assert.equal(out.obligations[0].due_date, '2026-09-14');
  assert.equal(out.obligations[0].state, 'acknowledged', 'the patient confirmed it');
  // The pipeline flags the condition but does not return its wording separately (validateRecommendation
  // sets condition_verbatim to null), so the note keeps the whole sentence, which contains it.
  assert.deepEqual(out.notes.map((x) => [x.kind, x.quote]), [['conditional', PERSIST]]);
  assert.deepEqual(out.log.map((l) => l.event), ['confirmed', 'confirmed', 'rejected']);
});

test('a no makes nothing', async () => {
  const c = await checked();
  const out = applyDecisions(c, { text: REPORT, at: AT, decisions: answer(c) });
  assert.equal(out.obligations.length, 0);
  assert.equal(out.notes.length, 0);
});

test('a less-sure item needs its details from the patient before it can be saved', async () => {
  const c = await checked();
  const id = c.less_sure[0].id;
  assert.throws(() => applyDecisions(c, { text: REPORT, at: AT, decisions: [{ id, answer: 'yes' }] }), /details are needed/);
  const out = applyDecisions(c, {
    text: REPORT, at: AT,
    decisions: answer(c, { [CLINICAL]: { action: 'laboratory', modality: 'blood test', interval: null } }),
  });
  const ob = out.obligations[0];
  assert.equal(ob.recommendation.action, 'laboratory');
  assert.equal(ob.finding.absence, 'not_located', 'its finding was never read, which is not the same as not stated');
  assert.equal(ob.extraction.method, 'patient_completed');
});

test('a correction is applied and recorded, and the modality code follows the corrected words', async () => {
  const c = await checked();
  const out = applyDecisions(c, {
    text: REPORT, at: AT,
    decisions: answer(c, { [NODULE]: { action: 'imaging', modality: 'MRI', interval: { value: 3, unit: 'month' } } }),
  });
  const ob = out.obligations[0];
  assert.equal(ob.recommendation.modality_code, 'mr');
  assert.equal(ob.due_date, '2026-06-14');
  const fields = ob.extraction.patient_corrections.map((x) => x.field);
  assert.deepEqual(fields.sort(), ['recommendation.interval', 'recommendation.modality'],
    'each field the patient changed is recorded, the training signal section 2 keeps');
});

test('the patient can add a recommendation the app missed, quoted from the report itself', async () => {
  const c = await checked();
  const missed = 'Annual screening mammography is advised.';
  const s = REPORT.indexOf(missed);
  const out = applyDecisions(c, {
    text: REPORT, at: AT, decisions: answer(c),
    added: [{ span: [s, s + missed.length], details: { action: 'imaging', modality: 'mammography', interval: { value: 1, unit: 'year' } } }],
  });
  const ob = out.obligations[0];
  assert.equal(ob.recommendation.text_verbatim, missed);
  assert.equal(ob.recommendation.modality_code, 'mammography');
  assert.equal(ob.extraction.method, 'patient_selected');
  assert.equal(ob.due_date, '2027-03-14');
  assert.throws(() => applyDecisions(c, { text: REPORT, at: AT, added: [{ span: [0, 99999], details: { action: 'imaging' } }] }), /select the sentence/);
  assert.throws(() => applyDecisions(c, { text: REPORT, at: AT, added: [{ span: [s, s + 10], details: {} }] }), /choose what the report asks for/);
});

test('the server refuses to save until every item, less-sure ones included, has an answer', async () => {
  const c = await checked();
  const firstOnly = c.items.map((i) => ({ id: i.id, answer: 'no' }));
  assert.throws(() => applyDecisions(c, { text: REPORT, at: AT, decisions: firstOnly }), /every item needs a yes or a no/);
  assert.doesNotThrow(() => applyDecisions(c, { text: REPORT, at: AT, decisions: answer(c) }));
});

test('an item read as not needed is still asked, and a yes makes it a follow-up', async () => {
  const NEG = 'No further imaging of the hernia is required.';
  const text = `${REPORT}\n${NEG}`;
  const s = text.indexOf(NEG);
  const negatedStages = {
    ...stages,
    detect: async (...a) => {
      const base = await stages.detect(...a);
      return { ...base, hits: [...base.hits, { ...base.hits[0], recommendation_verbatim: NEG, recommendation_span: [s, s + NEG.length] }] };
    },
    fill: async (t, sentence) => (sentence === NEG
      ? validateRecommendation({ finding_verbatim: null, finding: 'other', action: 'imaging', modality: null, interval_value: null,
        interval_unit: null, interval_verbatim: null, confidence: 0.6, conditional: false, negated: true, already_scheduled: false,
        recommendation_verbatim: NEG }, t)
      : stages.fill(t, sentence)),
  };
  const c = prepareCheck(await extractReport(text, { stages: negatedStages }), { date: '2026-03-14', makeId });
  assert.deepEqual(c.not_needed.map((i) => i.quote), [NEG], 'shown with its own question, not only listed');
  const others = [...c.items, ...c.less_sure].map((i) => ({ id: i.id, answer: 'no' }));
  assert.throws(() => applyDecisions(c, { text, at: AT, decisions: others }), /every item needs a yes or a no/,
    'it counts toward the every-item rule');
  const out = applyDecisions(c, { text, at: AT, decisions: [...others, { id: c.not_needed[0].id, answer: 'yes' }] });
  assert.deepEqual(out.obligations.map((o) => o.recommendation.text_verbatim), [NEG]);
  assert.equal(out.log.find((l) => l.quote === NEG).tier, 'negated');
});

test('a report the app did not read says so, and never that nothing was found', async () => {
  const reading = { result: { document: {}, recommendations: [], second_tier: [], rejected: [], extraction: { no_recommendation_found: false, unparseable: false } }, run: {} };
  const c = prepareCheck(reading, { date: '2026-03-14', manual: true });
  assert.deepEqual(c.notices, [NOT_READ_NOTICE]);
});
