// Tests for stage 5: text from a PDF report, and a scanned one refused by name.
//
//   node --test app/
//
// The PDFs are built in code from invented text. No real PDF is ever committed.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pdfText, PdfError, PDF_COPY } from './pdf.mjs';
import { findDates } from '../extraction/dates.mjs';
import { findForbiddenLanguage } from '../obligation/summary.mjs';
import { createApp } from './server.mjs';
import { makePdf } from './fixtures.mjs';

const REPORT_LINES = [
  'EXAM DATE: 2026-03-14',
  'FINDINGS: 8 mm nodule in the right upper lobe.',
  'IMPRESSION: Recommend CT chest in 6 months.',
];

test('the text of a PDF report is read out, line by line, in order', async () => {
  const { text, pages } = await pdfText(makePdf([REPORT_LINES]));
  assert.equal(pages, 1);
  assert.equal(text, REPORT_LINES.join('\n'));
  assert.deepEqual(findDates(text).map((d) => d.date), ['2026-03-14'], 'what comes out is ready for the next step');
});

test('pages are kept apart, so a sentence never runs from one page into the next', async () => {
  const { text, pages } = await pdfText(makePdf([REPORT_LINES, ['ADDENDUM: Discussed with the referring team on 2026-03-15.']]));
  assert.equal(pages, 2);
  assert.match(text, /6 months\.\n\nADDENDUM/);
});

test('a PDF with no text in it is called a scan, never read as a report with nothing in it', async () => {
  await assert.rejects(pdfText(makePdf([[]])), (e) => e instanceof PdfError && e.kind === 'no_text');
  await assert.rejects(pdfText(makePdf([['Page 1 of 1']])), (e) => e.kind === 'no_text', 'a page number alone is not a report');
});

test('a file that is not a PDF, or a broken one, is refused with a plain reason', async () => {
  await assert.rejects(pdfText(Buffer.from('EXAM DATE: 2026-03-14')), (e) => e.kind === 'not_pdf');
  await assert.rejects(pdfText(Buffer.from('%PDF-1.4\nthis is not really a pdf')), (e) => ['unreadable', 'no_text'].includes(e.kind));
});

test('every message about a PDF passes the interpretive-language check', () => {
  for (const line of Object.values(PDF_COPY)) assert.deepEqual(findForbiddenLanguage(line), [], line);
});

const servers = [];
after(() => { for (const s of servers) s.close(); });

test('the server reads a PDF sent as JSON and keeps nothing of it', async () => {
  const storePath = join(mkdtempSync(join(tmpdir(), 'amanah-s5-')), 'obligations.json');
  const server = createServer(createApp({ storePath }));
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const post = (body) => new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/pdf', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json' } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.end(JSON.stringify(body));
  });
  const ok = await post({ data: makePdf([REPORT_LINES]).toString('base64') });
  assert.equal(ok.status, 200);
  assert.match(ok.body.text, /Recommend CT chest in 6 months\./);
  const scan = await post({ data: makePdf([[]]).toString('base64') });
  assert.equal(scan.status, 400);
  assert.equal(scan.body.kind, 'no_text');
  assert.equal(scan.body.error, PDF_COPY.no_text);
});
