// Stage two of detection: verify a candidate sentence against the whole report.
//
//   node verify.mjs --corpus reports.json --predictions detected.json --out verified.json
//
// detect.mjs asks about one sentence at a time, which is what takes recall from 27% to 91%. The
// cost is that a single sentence carries no tense. "CT-GUIDED BIOPSY OF THE RIGHT TIBIA" names a
// procedure, and only the surrounding report says the procedure already happened. Every surviving
// false positive in RESULTS.md has that shape: a real sentence, read without the context that
// settles it.
//
// So this pass restores exactly what the split threw away. One call per candidate, whole report in
// view, asking whether the duty is real and still outstanding.
//
// A verification pass can only remove. That is the point and it is also the risk: if it removes
// true positives, recall falls and the gain from detecting per sentence goes with it. Both numbers
// are reported together for that reason, and RESULTS.md records the failure condition set before
// this was run.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { splitSentences } from './sentences.mjs';
import { dedupeRepeats } from './detect.mjs';

export const VERIFY_VERSION = '0.1';

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:7b-instruct-q4_K_M';

export const VERIFY_PROMPT = `You are shown a complete clinical report, and one sentence taken from it.

The sentence has been flagged as possibly asking for something to be done after this report. Check
that, with the whole report in front of you.

Answer YES if the sentence asks for something further, and the report does not say that the thing
asked for has already been carried out.

Answer NO when:
  - The sentence is the name or title of this examination. A procedure report is named after the
    procedure it carried out, and that procedure has happened.
  - The sentence says why this study was requested. That request was answered by this report.
  - The sentence describes a finding, or hedges about what a finding might be, without asking for
    anything. "Could be due to infection" asks for nothing.
  - The sentence describes how this report was communicated or delivered.
  - The sentence asks only for "clinical correlation" and names no test.
  - The report states elsewhere that the requested test or procedure has already been carried out.

Four things that are still YES. Each looks like a NO and is not.

  1. A request that depends on a condition. "If concern persists, dedicated radiographs can be
     obtained" asks for something. Whether the condition holds is for a clinician to judge later.
     It is not your job to decide the condition has not been met.

  2. A patient told to arrange something, or handed information to book it. Being told to arrange a
     thing is not the same as the thing being done, and this is the case most easily lost.

  3. A statement that no follow-up is needed. It settles the question explicitly, which is a real
     answer rather than an absence.

  4. A request whose wording is damaged or incomplete. If something is clearly being asked for but
     the words naming it did not survive dictation, it is still a request.

The question is whether the ACTION ASKED FOR has been carried out. It is not whether the sentence
is written in the past tense.

Answer with JSON only: {"real_and_outstanding": true or false}`;

const FORMAT = {
  type: 'object',
  properties: { real_and_outstanding: { type: 'boolean' } },
  required: ['real_and_outstanding'],
};

/** Verify one candidate against its report. Returns a boolean. */
export async function verifyCandidate(reportText, sentence, { model = DEFAULT_MODEL } = {}) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: FORMAT,
      options: { temperature: 0, num_ctx: 8192 },
      messages: [
        { role: 'system', content: VERIFY_PROMPT },
        {
          role: 'user',
          content: `FULL REPORT:\n${reportText}\n\n---\n\nSENTENCE TO CHECK:\n${sentence}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama returned ${res.status}`);
  return Boolean(JSON.parse((await res.json()).message.content).real_and_outstanding);
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (f, d = null) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
  const corpusPath = get('--corpus');
  const predPath = get('--predictions');
  const outPath = get('--out');
  const model = get('--model', DEFAULT_MODEL);

  if (!corpusPath || !predPath || !outPath) {
    console.error('usage: node verify.mjs --corpus <reports.json> --predictions <detected.json> '
      + '--out <verified.json> [--model M]');
    process.exit(2);
  }

  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
  const reports = new Map((corpus.reports ?? corpus).map((r) => [r.id, r.text]));
  const pred = JSON.parse(readFileSync(predPath, 'utf8'));

  let checked = 0;
  let removed = 0;
  const started = Date.now();

  let deduped = 0;
  for (const p of pred.predictions) {
    const text = reports.get(p.report_id);

    // Section 7.6 first, because it is deterministic and costs no inference: a sentence quoted
    // twice is one duty. Sections are re-derived from the report rather than carried in the
    // predictions file, so this works on any detection output.
    const candidates = p.output.recommendations ?? [];
    const segs = splitSentences(text);
    const withSection = candidates.map((rec) => ({
      ...rec,
      section: segs.find((s) => s.span[0] <= rec.recommendation_span[0]
        && s.span[1] >= rec.recommendation_span[1])?.section ?? null,
    }));
    const unique = dedupeRepeats(withSection);
    deduped += candidates.length - unique.length;

    const kept = [];
    for (const { section, ...rec } of unique) {
      checked++;
      let keep = true;
      try {
        keep = await verifyCandidate(text, rec.recommendation_verbatim, { model });
      } catch (err) {
        // A verifier that cannot be reached must not silently delete candidates. Failing open
        // keeps the detection result, which is the conservative direction for a system whose worse
        // error is a duty nobody sees.
        console.error(`  ${p.report_id}: ${err.message} (keeping candidate)`);
      }
      if (keep) kept.push(rec);
      else {
        removed++;
        console.log(`  removed  ${p.report_id}: `
          + JSON.stringify(rec.recommendation_verbatim.replace(/\s+/g, ' ').slice(0, 80)));
      }
    }
    p.output.recommendations = kept;
    p.output.extraction.no_recommendation_found = kept.length === 0;
    p.output.extraction.prompt_version = `${p.output.extraction.prompt_version}+verify${VERIFY_VERSION}`;
  }

  pred.prompt_version = `${pred.prompt_version}+verify${VERIFY_VERSION}`;
  writeFileSync(outPath, JSON.stringify(pred, null, 2) + '\n', 'utf8');

  console.log(`\n${deduped} collapsed as repeats (7.6), ${checked} verified, ${removed} removed, `
    + `${checked - removed} kept, ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log('A verification pass can only remove. Read recall and precision together.');
}
