// The local app a patient opens in their browser. Phase 2, stage 2.
//
//   node app/server.mjs [--port 4747] [--data <file>] [--model <name>]
//
// NOTHING LEAVES THE MACHINE. The server binds to 127.0.0.1 only. Its one outbound connection is to
// the model server on the same machine, through extraction/pipeline.mjs. The page loads nothing from
// anywhere else. This is the labelling tool's rule, carried over, because a patient's own report is
// at least as private as the corpus was.
//
// Two protections the labelling tool did not need, because this runs on a patient's everyday
// computer, where they also browse the web:
//
//   Host check.  A request must name 127.0.0.1 or localhost. A web page that points a domain of its
//                own at 127.0.0.1 would otherwise reach this server, which is the DNS rebinding
//                attack, and the Host header is what gives it away.
//   JSON only.   A request that changes anything must be application/json. A form on another site
//                can post text to 127.0.0.1, but cannot send JSON without the browser first asking
//                this server for permission, which it never grants.
//
// The report text is held in memory while it is read and checked, and dropped once the patient
// saves (constraint C5). Only the obligations, which quote the report's sentences, are written.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

import { extractReport, ModelUnavailableError, DEFAULT_MODEL } from '../extraction/pipeline.mjs';
import { findDates } from '../extraction/dates.mjs';
import { prepareCheck, applyDecisions, ACTIONS, UNITS } from './checking.mjs';
import { loadStore, addToStore, updateStore, DEFAULT_PATH } from './store.mjs';
import {
  guessKind, studyRecord, pendingClosures, closeByReport, closeByWord, markBooked, closedHow, REGIONS,
} from './closing.mjs';
import { MODALITIES } from '../obligation/modality.mjs';
import { pdfText, PdfError } from './pdf.mjs';
import { patientStatus } from './status.mjs';
import { summaryPage } from './summary-page.mjs';
import { calendarFor } from './ics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 1_000_000;
// A PDF arrives base64-encoded inside JSON, about a third larger than the file.
const MAX_PDF_BODY = 30_000_000;

const empty = () => ({
  document: { date_found: null, date_span: null, language: 'en', modality_of_document: null },
  recommendations: [],
  second_tier: [],
  rejected: [],
  extraction: { model: null, language_validated: false, no_recommendation_found: false, unparseable: false },
});

/** The request handler. `extract` is replaced in tests so they run without a model. */
export function createApp({ extract = extractReport, storePath = DEFAULT_PATH, model = DEFAULT_MODEL, now = () => new Date() } = {}) {
  const jobs = new Map();

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const readJson = (req, limit = MAX_BODY) => new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      reject(new Error('requests that change anything must be application/json'));
      return;
    }
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > limit) { reject(new Error('this file is too large to read here')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('not JSON')); } });
  });

  // The patient's own calendar date, not UTC: "due today" should mean today where they are.
  const today = () => {
    const d = now();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const stamp = () => now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const TERMINAL = ['resolved', 'declined', 'not_indicated', 'superseded', 'lost_to_followup', 'deceased'];
  const pick = (store, id) => {
    if (id === 'all') return store.obligations.filter((o) => !TERMINAL.includes(o.state));
    const o = store.obligations.find((x) => x.id === id);
    if (!o) throw new Error('no such follow-up');
    return [o];
  };

  const jobFor = (id) => {
    const job = jobs.get(id);
    if (!job) throw new Error('this report is no longer open; paste it again');
    return job;
  };

  async function route(req, res, url) {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, readFileSync(join(here, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/api/options') {
      return send(res, 200, { actions: ACTIONS, units: UNITS, kinds: MODALITIES, regions: Object.keys(REGIONS) });
    }

    if (req.method === 'POST' && url.pathname === '/api/pdf') {
      // The text goes back to the page for the patient to see before anything reads it. Nothing
      // is kept: the PDF exists only for the length of this request.
      const { data } = await readJson(req, MAX_PDF_BODY);
      if (typeof data !== 'string' || !data) throw new Error('choose a PDF first');
      try {
        return send(res, 200, await pdfText(Buffer.from(data, 'base64')));
      } catch (e) {
        if (e instanceof PdfError) return send(res, 400, { error: e.message, kind: e.kind });
        throw e;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
      const { text, manual = false } = await readJson(req);
      if (typeof text !== 'string' || !text.trim()) throw new Error('paste the text of a report first');
      const id = randomUUID();
      const job = { text, manual: Boolean(manual), status: manual ? 'done' : 'reading', done: 0, of: null };
      jobs.set(id, job);
      if (manual) {
        job.reading = { result: empty(), run: { unverified: [], incomplete: false } };
      } else {
        extract(text, { model, onProgress: (p) => { job.done = p.done; job.of = p.of; } })
          .then((reading) => { job.reading = reading; job.status = 'done'; })
          .catch((e) => {
            job.status = e instanceof ModelUnavailableError ? 'model_unavailable' : 'error';
            job.error = e.message;
          });
      }
      // Each date with the words around it, so the patient can tell a date of birth from the date of
      // the report. The app does not choose between them.
      const dates = findDates(text).map((d) => ({
        ...d,
        context: text.slice(Math.max(0, d.span[0] - 40), Math.min(text.length, d.span[1] + 40)).replace(/\s+/g, ' '),
      }));
      return send(res, 200, { job: id, dates, kind_guess: guessKind(text) });
    }

    if (req.method === 'GET' && url.pathname === '/api/job') {
      const job = jobFor(url.searchParams.get('id'));
      return send(res, 200, { status: job.status, done: job.done, of: job.of, error: job.error ?? null });
    }

    if (req.method === 'POST' && url.pathname === '/api/check') {
      const { job: id, date } = await readJson(req);
      const job = jobFor(id);
      if (job.status !== 'done') throw new Error('the report has not finished being read');
      job.check = prepareCheck(job.reading, { date, manual: job.manual });
      const { proposals, ...shown } = job.check;
      return send(res, 200, shown);
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      const { job: id, decisions, added, study = {} } = await readJson(req);
      const job = jobFor(id);
      if (!job.check) throw new Error('check the items before saving');
      const at = stamp();
      const made = applyDecisions(job.check, { text: job.text, decisions, added, at });
      // Every report is kept as a study, whether or not it asked for anything: a report with no
      // recommendation in it may be the follow-up an earlier one was waiting for (stage 4).
      const record = studyRecord({ id: randomUUID(), date: job.check.date, modality_code: study.modality_code ?? null, region: study.region ?? null });
      const store = addToStore({ ...made, study: record }, storePath);
      jobs.delete(id); // C5: the report text goes with the job.
      return send(res, 200, {
        saved: made.obligations.map((o) => ({ quote: o.recommendation.text_verbatim, due_date: o.due_date })),
        notes: made.notes.map((n) => ({ quote: n.quote, condition: n.condition })),
        questions: pendingClosures(store).length,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/obligations') {
      const store = loadStore(storePath);
      const date = today();
      return send(res, 200, {
        today: date,
        obligations: store.obligations.map((o) => {
          const s = patientStatus(o, date);
          return {
            id: o.id, quote: o.recommendation.text_verbatim, document_date: o.source.document_date,
            due_date: o.due_date, state: o.state, level: s.ladder.level, tone: s.tone,
            headline: closedHow(o) ?? s.headline,
          };
        }),
        notes: store.notes,
        questions: pendingClosures(store),
      });
    }

    if (req.method === 'POST' && ['/api/close', '/api/booked', '/api/not-it'].includes(url.pathname)) {
      const body = await readJson(req);
      const actor = { kind: 'patient', ref: 'local' };
      const at = stamp();
      updateStore((store) => {
        const i = store.obligations.findIndex((o) => o.id === body.id);
        if (i === -1) throw new Error('no such follow-up');
        const ob = store.obligations[i];
        const next = { ...store, obligations: [...store.obligations], log: [...store.log] };
        if (url.pathname === '/api/not-it') {
          const ids = Array.isArray(body.study_ids) ? body.study_ids : [];
          next.rejections = { ...store.rejections, [ob.id]: [...(store.rejections[ob.id] ?? []), ...ids] };
          next.log.push({ at, event: 'not_the_follow_up', quote: ob.recommendation.text_verbatim, studies: ids.length });
          return next;
        }
        if (url.pathname === '/api/booked') {
          next.obligations[i] = markBooked(ob, { actor, at });
          next.log.push({ at, event: 'booked', quote: ob.recommendation.text_verbatim });
          return next;
        }
        if (body.study_id) {
          const study = store.studies.find((x) => x.id === body.study_id);
          if (!study) throw new Error('no such report');
          next.obligations[i] = closeByReport(ob, study, { actor, at });
          next.log.push({ at, event: 'closed_by_report', quote: ob.recommendation.text_verbatim });
        } else {
          next.obligations[i] = closeByWord(ob, { actor, at, date_done: body.date_done || null });
          next.log.push({ at, event: 'closed_by_word', quote: ob.recommendation.text_verbatim });
        }
        return next;
      }, storePath);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/summary') {
      const store = loadStore(storePath);
      const id = url.searchParams.get('id');
      const html = summaryPage(pick(store, id), { now: today(), notes: id === 'all' ? store.notes : [] });
      return send(res, 200, html, 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/calendar.ics') {
      const store = loadStore(storePath);
      const ics = calendarFor(pick(store, url.searchParams.get('id')), { stamp: now().toISOString() });
      if (!ics) throw new Error('the report did not give a due date, so there is nothing to put in a calendar');
      res.writeHead(200, {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="follow-up.ics"',
        'cache-control': 'no-store',
      });
      return res.end(ics);
    }

    return send(res, 404, { error: 'not found' });
  }

  return (req, res) => {
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
    if (host !== '127.0.0.1' && host !== 'localhost') {
      return send(res, 403, { error: 'this app only answers requests addressed to this computer' });
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    return route(req, res, url).catch((e) => send(res, 400, { error: e.message }));
  };
}

function main() {
  const args = process.argv.slice(2);
  const get = (f, d) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
  const port = Number(get('--port', 4747));
  const storePath = get('--data', DEFAULT_PATH);
  const model = get('--model', DEFAULT_MODEL);
  createServer(createApp({ storePath, model })).listen(port, '127.0.0.1', () => {
    console.log(`\n  Amanah is running. Open http://127.0.0.1:${port} in your browser.`);
    console.log(`  Your follow-ups are kept in ${storePath}`);
    console.log('  This computer only. Nothing is sent anywhere else.\n');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
