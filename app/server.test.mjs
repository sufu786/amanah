// Tests for server.mjs. Phase 2, stage 2.
//
//   node --test app/
//
// The real server, over real HTTP, with the model stubbed and a temporary store.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './server.mjs';
import { extractReport, ModelUnavailableError } from '../extraction/pipeline.mjs';
import { findForbiddenLanguage } from '../obligation/summary.mjs';
import { MAY_HAVE_MISSED, NOT_READ_NOTICE, INCOMPLETE_NOTICE } from './checking.mjs';
import { REPORT, stages } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const servers = [];
after(() => { for (const s of servers) s.close(); });

async function boot(extract = (text, o) => extractReport(text, { ...o, stages })) {
  const storePath = join(mkdtempSync(join(tmpdir(), 'amanah-app-')), 'obligations.json');
  const server = createServer(createApp({ extract, storePath, now: () => new Date('2026-03-20T10:00:00Z') }));
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port, method, path,
      headers: { host: `127.0.0.1:${port}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw.startsWith('{') ? JSON.parse(raw) : raw }));
    });
    req.on('error', reject);
    if (body) req.end(typeof body === 'string' ? body : JSON.stringify(body)); else req.end();
  });
  return { call, storePath };
}

async function waitDone(call, job) {
  for (let i = 0; i < 50; i++) {
    const r = await call('GET', `/api/job?id=${job}`);
    if (r.body.status !== 'reading') return r.body;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('job never finished');
}

test('paste, read, choose the date, check, save: the report text is gone and the obligation stays', async () => {
  const { call, storePath } = await boot();
  const started = await call('POST', '/api/start', { text: REPORT });
  assert.equal(started.status, 200);
  assert.deepEqual(started.body.dates.map((d) => d.date), ['2026-03-14']);
  assert.match(started.body.dates[0].context, /EXAM DATE/);
  assert.equal((await waitDone(call, started.body.job)).status, 'done');

  const check = await call('POST', '/api/check', { job: started.body.job, date: '2026-03-14' });
  assert.equal(check.status, 200);
  assert.ok(check.body.notices.includes(MAY_HAVE_MISSED));
  assert.equal(check.body.proposals, undefined, 'internal objects stay on the server');
  const all = [...check.body.items, ...check.body.less_sure];
  const decisions = all.map((i) => ({ id: i.id, answer: i.quote.startsWith('Recommend CT') ? 'yes' : 'no' }));

  const saved = await call('POST', '/api/save', { job: started.body.job, decisions });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.saved, [{ quote: 'Recommend CT chest in 6 months.', due_date: '2026-09-14' }]);

  const stored = readFileSync(storePath, 'utf8');
  assert.ok(stored.includes('Recommend CT chest in 6 months.'), 'the obligation quotes its sentence');
  assert.ok(!stored.includes('EXAM DATE'), 'the rest of the report is not kept (C5)');
  assert.equal((await call('GET', `/api/job?id=${started.body.job}`)).status, 400, 'the job, and the report text with it, is gone');

  const list = await call('GET', '/api/obligations');
  assert.equal(list.body.obligations.length, 1);
  assert.equal(list.body.obligations[0].state, 'acknowledged');
});

test('a model that cannot be reached offers the patient the way to mark it themselves', async () => {
  const { call } = await boot(async () => { throw new ModelUnavailableError(new Error('refused')); });
  const started = await call('POST', '/api/start', { text: REPORT });
  const job = await waitDone(call, started.body.job);
  assert.equal(job.status, 'model_unavailable');
  assert.match(job.error, /not read/);

  const manual = await call('POST', '/api/start', { text: REPORT, manual: true });
  const check = await call('POST', '/api/check', { job: manual.body.job, date: '2026-03-14' });
  assert.deepEqual(check.body.notices, [NOT_READ_NOTICE]);
  assert.equal(check.body.items.length, 0);
});

test('nothing is saved without a date, and nothing is checked before the reading ends', async () => {
  let release;
  const { call } = await boot(() => new Promise((r) => { release = r; }));
  const started = await call('POST', '/api/start', { text: REPORT });
  const early = await call('POST', '/api/check', { job: started.body.job, date: '2026-03-14' });
  assert.equal(early.status, 400);
  release(await extractReport(REPORT, { stages }));
  await waitDone(call, started.body.job);
  const noDate = await call('POST', '/api/check', { job: started.body.job, date: '' });
  assert.equal(noDate.status, 400);
  assert.match(noDate.body.error, /report date is needed/);
});

test('requests not addressed to this computer are refused', async () => {
  const { call } = await boot();
  const r = await call('GET', '/api/obligations', undefined, { host: 'evil.example' });
  assert.equal(r.status, 403);
});

test('a change must be sent as JSON, which a form on another site cannot do', async () => {
  const { call } = await boot();
  const r = await call('POST', '/api/start', `text=${encodeURIComponent(REPORT)}`, { 'content-type': 'text/plain' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /application\/json/);
});

test('the page loads nothing from outside this computer', () => {
  const html = readFileSync(join(here, 'index.html'), 'utf8');
  assert.ok(!/(src|href)\s*=\s*["']https?:/i.test(html), 'no external scripts, styles, fonts or images');
  assert.ok(!/fetch\(\s*["'`]https?:/i.test(html), 'no request leaves the machine');
});

test('every sentence the patient reads passes the interpretive-language check (C1, C2)', () => {
  const html = readFileSync(join(here, 'index.html'), 'utf8')
    .replace(/<style[\s\S]*?<\/style>/, '')
    .replace(/<[^>]+>/g, ' ');
  for (const text of [html, MAY_HAVE_MISSED, NOT_READ_NOTICE, INCOMPLETE_NOTICE]) {
    assert.deepEqual(findForbiddenLanguage(text), [], text.slice(0, 80));
  }
});

test('the store is created only when something is saved', async () => {
  const { call, storePath } = await boot();
  await call('GET', '/api/obligations');
  assert.equal(existsSync(storePath), false);
});
