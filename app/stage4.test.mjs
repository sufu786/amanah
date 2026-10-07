// Tests for stage 4: a later report that may be the follow-up, and the patient saying it was done.
//
//   node --test app/
//
// Every report here is invented.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createObligation, verify } from '../obligation/obligation.mjs';
import { findForbiddenLanguage } from '../obligation/summary.mjs';
import { extractReport } from '../extraction/pipeline.mjs';
import {
  guessKind, studyRecord, pendingClosures, closeByReport, closeByWord, markBooked, closedHow, reopenByPatient,
} from './closing.mjs';
import { createApp } from './server.mjs';
import { REPORT, stages } from './fixtures.mjs';

const PATIENT = { kind: 'patient', ref: 'local' };
const AT = '2026-10-08T10:00:00Z';
const nodule = (id = 'ob-1') => verify(createObligation({
  id,
  subject_ref: 'local',
  finding: { text_verbatim: '8 mm nodule in the right upper lobe', category: 'pulmonary_nodule', anatomy: 'lung', laterality: 'right' },
  recommendation: { text_verbatim: 'Recommend CT chest in 6 months.', action: 'imaging', modality: 'CT', modality_code: 'ct', interval: { value: 6, unit: 'month' } },
  source: { kind: 'paste', document_date: '2026-03-14' },
  owner: PATIENT,
  extraction: { confidence: 0.9, language: 'en', language_validated: false },
  actor: PATIENT,
  at: '2026-03-20T10:00:00Z',
}), { actor: PATIENT, at: '2026-03-20T10:00:00Z' });

const store = (studies, extra = {}) => ({
  obligations: [nodule()],
  studies,
  origins: { 'ob-1': 'first' },
  rejections: {},
  ...extra,
});
const first = studyRecord({ id: 'first', date: '2026-03-14', modality_code: 'ct', region: 'chest' });

test('the kind of test is read from the opening words, and left blank when it cannot be', () => {
  assert.equal(guessKind('EXAM: CT CHEST WITH CONTRAST\nHISTORY: ...'), 'ct');
  assert.equal(guessKind('MRI BRAIN WITHOUT CONTRAST'), 'mr');
  assert.equal(guessKind('Clinic letter, no examination named.'), null);
});

test('a report is never asked about as the follow-up of the follow-ups it created', () => {
  assert.deepEqual(pendingClosures(store([first])), []);
});

test('a later report that matches every condition is still a question, never a closure', () => {
  const later = studyRecord({ id: 'later', date: '2026-09-01', modality_code: 'ct', region: 'chest' });
  const q = pendingClosures(store([first, later]));
  assert.equal(q.length, 1);
  assert.equal(q[0].every_condition_holds, true);
  assert.equal(q[0].candidates[0].study_id, 'later');
});

test('a later report of another kind of test asks nothing', () => {
  const mr = studyRecord({ id: 'mr', date: '2026-09-01', modality_code: 'mr', region: 'chest' });
  assert.deepEqual(pendingClosures(store([first, mr])), []);
});

test('several doubtful reports make one question, and one the patient rejected is not asked again', () => {
  const early1 = studyRecord({ id: 'e1', date: '2026-04-01', modality_code: 'ct', region: 'chest' });
  const unsure = studyRecord({ id: 'u1', date: '2026-09-01', modality_code: null, region: null });
  const q = pendingClosures(store([first, early1, unsure]));
  assert.equal(q.length, 1, 'one question per follow-up (section 4.5)');
  assert.deepEqual(q[0].candidates.map((c) => c.study_id), ['e1', 'u1']);
  assert.ok(q[0].candidates.every((c) => c.reasons.length > 0));
  assert.deepEqual(pendingClosures(store([first, early1, unsure], { rejections: { 'ob-1': ['e1', 'u1'] } })), []);
});

test('closing by a later report walks the permitted path and records objective evidence', () => {
  const later = studyRecord({ id: 'later', date: '2026-09-01', modality_code: 'ct', region: 'chest' });
  const ob = closeByReport(nodule(), later, { actor: PATIENT, at: AT });
  assert.equal(ob.state, 'resolved');
  assert.equal(ob.closure.evidence.type, 'matching_study');
  assert.equal(ob.closure.evidence.tier, 'objective');
  assert.equal(ob.closure.evidence.confirmed_by_patient, true);
  assert.deepEqual(ob.history.map((h) => h.to_state), ['created', 'acknowledged', 'scheduled', 'completed', 'resolved']);
  assert.ok(ob.history.filter((h) => h.detail?.recorded_together).length === 2, 'the steps not reported separately are marked');
  assert.match(closedHow(ob), /later report, dated 1 September 2026/);
});

test('the patient saying it was done is the lowest tier, and is called that', () => {
  const ob = closeByWord(nodule(), { actor: PATIENT, at: AT, date_done: '2026-09-05' });
  assert.equal(ob.closure.evidence.type, 'patient_attestation');
  assert.equal(ob.closure.evidence.tier, 'self_reported');
  assert.match(closedHow(ob), /your own word/);
  assert.throws(() => closeByWord(nodule(), { actor: PATIENT, at: AT, date_done: 'last week' }), /must be a date/);
});

test('booked first, then done, records each step once', () => {
  const booked = markBooked(nodule(), { actor: PATIENT, at: AT });
  assert.equal(booked.state, 'scheduled');
  const done = closeByWord(booked, { actor: PATIENT, at: AT });
  assert.deepEqual(done.history.map((h) => h.to_state), ['created', 'acknowledged', 'scheduled', 'completed', 'resolved']);
  assert.equal(done.history.filter((h) => h.detail?.recorded_together).length, 1);
});

test('a follow-up closed by mistake can be reopened, and the history keeps the closure', () => {
  const closed = closeByWord(nodule(), { actor: PATIENT, at: AT });
  const back = reopenByPatient(closed, { actor: PATIENT, at: '2026-10-09T10:00:00Z' });
  assert.equal(back.state, 'acknowledged');
  assert.equal(back.closure, null, 'cleared from the current view');
  assert.ok(back.history.some((h) => h.to_state === 'resolved'), 'but never erased (section 4.3)');
  assert.ok(back.history.some((h) => h.event === 'reopened'));
});

test('the closed lines pass the interpretive-language check', () => {
  for (const ob of [closeByReport(nodule(), studyRecord({ id: 's', date: '2026-09-01', modality_code: 'ct', region: 'chest' }), { actor: PATIENT, at: AT }),
    closeByWord(nodule(), { actor: PATIENT, at: AT })]) {
    assert.deepEqual(findForbiddenLanguage(closedHow(ob)), []);
  }
});

const servers = [];
after(() => { for (const s of servers) s.close(); });

test('end to end: save a report, save a later one, answer the question, and the follow-up closes', async () => {
  const storePath = join(mkdtempSync(join(tmpdir(), 'amanah-s4-')), 'obligations.json');
  const server = createServer(createApp({
    extract: (text, o) => extractReport(text, { ...o, stages }), storePath, now: () => new Date(2026, 9, 8, 12),
  }));
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (method, path, body) => new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json' } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.end(body ? JSON.stringify(body) : undefined);
  });
  const done = async (job) => { for (;;) { const r = await call('GET', `/api/job?id=${job}`); if (r.body.status !== 'reading') return; } };

  // The first report, with the CT follow-up.
  const one = await call('POST', '/api/start', { text: REPORT });
  await done(one.body.job);
  const check = await call('POST', '/api/check', { job: one.body.job, date: '2026-03-14' });
  const decisions = [...check.body.items, ...check.body.less_sure].map((i) => ({ id: i.id, answer: i.quote.startsWith('Recommend CT') ? 'yes' : 'no' }));
  await call('POST', '/api/save', { job: one.body.job, decisions, study: { modality_code: 'ct', region: 'chest' } });
  assert.equal((await call('GET', '/api/obligations')).body.questions.length, 0, 'its own report is not its follow-up');

  // A later report, marked by the patient, that asks for nothing itself.
  const two = await call('POST', '/api/start', { text: 'EXAM: CT CHEST. 2026-09-01. Stable appearance.', manual: true });
  assert.equal(two.body.kind_guess, 'ct');
  await call('POST', '/api/check', { job: two.body.job, date: '2026-09-01' });
  const saved = await call('POST', '/api/save', { job: two.body.job, decisions: [], study: { modality_code: 'ct', region: 'chest' } });
  assert.equal(saved.body.questions, 1);

  const list = await call('GET', '/api/obligations');
  const q = list.body.questions[0];
  assert.equal(q.every_condition_holds, true);
  assert.equal(list.body.obligations[0].state, 'acknowledged', 'nothing closed on its own');

  await call('POST', '/api/close', { id: q.obligation_id, study_id: q.candidates[0].study_id });
  const after = await call('GET', '/api/obligations');
  assert.equal(after.body.obligations[0].state, 'resolved');
  assert.match(after.body.obligations[0].headline, /^Closed: you confirmed a later report/);
  assert.equal(after.body.questions.length, 0);
});
