// Tests for stage 3: where each follow-up stands, the printed summary, and the calendar file.
//
//   node --test app/
//
// Obligations are made with the obligation layer directly. Every report sentence is invented.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createObligation, verify, transition } from '../obligation/obligation.mjs';
import { findForbiddenLanguage } from '../obligation/summary.mjs';
import { patientStatus, STATUS_COPY } from './status.mjs';
import { calendarFor } from './ics.mjs';
import { summaryPage, PAGE_COPY } from './summary-page.mjs';
import { saveStore, FORMAT } from './store.mjs';
import { createApp } from './server.mjs';

const PATIENT = { kind: 'patient', ref: 'local' };
const make = ({ id = 'ob-1', interval = { value: 6, unit: 'month' }, quote = 'Recommend CT chest in 6 months.' } = {}) => verify(createObligation({
  id,
  subject_ref: 'local',
  finding: { text_verbatim: '8 mm nodule in the right upper lobe', category: 'pulmonary_nodule', anatomy: 'lung', laterality: 'right' },
  recommendation: { text_verbatim: quote, action: 'imaging', modality: 'CT', modality_code: 'ct', interval },
  source: { kind: 'paste', document_date: '2026-03-14' },
  owner: PATIENT,
  extraction: { confidence: 0.9, language: 'en', language_validated: false },
  actor: PATIENT,
  at: '2026-03-20T10:00:00Z',
}), { actor: PATIENT, at: '2026-03-20T10:00:00Z' });

test('each rung of the ladder becomes something the patient can do', () => {
  const ob = make(); // due 2026-09-14
  const at = (now) => patientStatus(ob, now);
  assert.equal(at('2026-07-01').headline, 'Due in 75 days.');
  assert.equal(at('2026-07-01').tone, 'quiet');
  assert.match(at('2026-08-20').headline, /^Due in 25 days\. Check that it has been arranged/);
  assert.equal(at('2026-08-20').ladder.level, 'L1', 'the rung is the ladder\'s own, not recomputed');
  assert.match(at('2026-09-14').headline, /^Due today/);
  assert.match(at('2026-09-20').headline, /^6 days past the date it was due\. Ask the clinic/);
  assert.match(at('2026-11-01').headline, /^48 days past the date it was due\. Please contact/);
  assert.equal(at('2026-11-01').tone, 'act');
});

test('with no due date, the app says the report gave none, then asks the patient to find out', () => {
  const ob = make({ interval: null, quote: 'Recommend follow-up imaging.' });
  assert.equal(patientStatus(ob, '2026-03-20').headline, STATUS_COPY.undated);
  assert.equal(patientStatus(ob, '2026-05-01').headline, STATUS_COPY.undated_ask, 'section 8: the undated ladder asks for a date');
});

test('a closed follow-up says so and nothing else', () => {
  const ob = transition(make(), { to: 'declined', actor: PATIENT, at: '2026-04-01T10:00:00Z', reason: 'patient declined' });
  assert.equal(patientStatus(ob, '2026-11-01').headline, STATUS_COPY.closed);
});

test('every status line and every line of the printed page passes the interpretive-language check', () => {
  const lines = [
    ...Object.values(STATUS_COPY).map((v) => (typeof v === 'function' ? v(48) : v)),
    ...Object.values(PAGE_COPY),
  ];
  for (const line of lines) assert.deepEqual(findForbiddenLanguage(line), [], line);
});

test('the calendar file is a valid all-day event with a reminder at the first rung', () => {
  const ics = calendarFor([make({ quote: 'Recommend CT chest, with contrast; in 6 months.' })], { stamp: '2026-03-20T10:00:00.000Z' });
  assert.ok(ics.split('\r\n').length > 10, 'CRLF line endings');
  assert.ok(!/[^\r]\n/.test(ics), 'no bare LF anywhere');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `folded: ${line}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /DTSTART;VALUE=DATE:20260914/);
  assert.match(unfolded, /DTEND;VALUE=DATE:20260915/);
  assert.match(unfolded, /TRIGGER:-P30D/);
  assert.match(unfolded, /Recommend CT chest\\, with contrast\\; in 6 months\./, 'commas and semicolons escaped');
  assert.match(unfolded, /UID:ob-1@amanah\.local/);
});

test('a follow-up with no due date gets no calendar event, and no invented date', () => {
  assert.equal(calendarFor([make({ interval: null })], { stamp: '2026-03-20T10:00:00Z' }), null);
});

test('the printed page carries the prepared summary, marks the report\'s words, and escapes them', () => {
  const html = summaryPage([make({ quote: 'Recommend <b>CT</b> in 6 months.' })], {
    now: '2026-09-20',
    notes: [{ quote: 'If symptoms persist, repeat radiograph.', document_date: '2026-03-14' }],
  });
  assert.match(html, /I am asking whether this follow-up has been arranged\./, 'section 9 item 6, the ask');
  assert.match(html, /copied from my report/);
  assert.match(html, /6 days past that date/);
  assert.ok(html.includes('&lt;b&gt;CT&lt;/b&gt;') && !html.includes('<b>CT</b>'), 'report text cannot inject markup');
  assert.match(html, /Questions for my clinician/);
  assert.ok(!/(src|href)\s*=\s*["']https?:/i.test(html), 'nothing loaded from outside');
});

const servers = [];
after(() => { for (const s of servers) s.close(); });

test('the list, the printed summary and the calendar are served from the store', async () => {
  const storePath = join(mkdtempSync(join(tmpdir(), 'amanah-s3-')), 'obligations.json');
  saveStore({ format: FORMAT, obligations: [make(), make({ id: 'ob-2', interval: null, quote: 'Recommend follow-up imaging.' })], notes: [], log: [] }, storePath);
  const server = createServer(createApp({ storePath, now: () => new Date(2026, 8, 20, 12) }));
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const get = (path) => new Promise((resolve) => {
    request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: raw }));
    }).end();
  });

  const list = JSON.parse((await get('/api/obligations')).body);
  assert.equal(list.today, '2026-09-20');
  assert.match(list.obligations[0].headline, /^6 days past/);
  assert.equal(list.obligations[1].headline, STATUS_COPY.undated_ask);

  const page = await get('/summary?id=all');
  assert.equal(page.status, 200);
  assert.equal((page.body.match(/<article>/g) ?? []).length, 2);

  const cal = await get('/calendar.ics?id=all');
  assert.match(cal.type, /text\/calendar/);
  assert.equal((cal.body.match(/BEGIN:VEVENT/g) ?? []).length, 1, 'only the dated one');
  assert.equal((await get('/calendar.ics?id=ob-2')).status, 400);
  assert.equal((await get('/summary?id=nope')).status, 400);
});
