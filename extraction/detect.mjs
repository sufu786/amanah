// Per-sentence detection. Stage one of the two-stage extractor.
//
//   node detect.mjs --corpus reports.json --out predictions.json [--model M] [--no-filter]
//
// Asks one question about one sentence at a time: does this leave something still to be done? The
// model cannot fail by not scanning, because there is nothing to scan.
//
// Why this exists: prompt v0.2 recalled 3 of 11 labelled instances while containing, verbatim among
// its own examples, a sentence it failed to find in a report. Asking about that sentence alone
// returns it correctly. RESULTS.md records the measurement; the short version is that the failure
// was search rather than judgement, and this file removes the search.
//
// WHAT THIS IS NOT. It detects sentences and fills no fields, so its output carries finding "other"
// and action "unclear" throughout. Those two columns of any score run against it are meaningless by
// construction. Stage two, which fills the fields, is not built.
//
// It also does not pass its own acceptance rule. On the pilot it puts an obligation into one clean
// report in forty, against a rule of zero fixed before the run. It is committed because the
// measurement is worth keeping and reproducing, not because it is ready to use.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { splitSentences, sectionCannotRecommend } from './sentences.mjs';

export const DETECT_VERSION = '0.1';

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:7b-instruct-q4_K_M';

export const DETECT_PROMPT = `You are shown ONE sentence from a clinical report, and the section heading it appears under.

Answer one question: does this sentence leave something still to be done after this report?
Something to be done means another test, a procedure, a referral, a treatment, or a review.

The question is not whether the sentence contains any particular word. Reports ask for things in
many ways, and all of these are YES:
  - "Recommend CT follow-up in 6 months."
  - "Additional imaging is needed."
  - "Dedicated radiographs can be obtained."
  - "This could be further evaluated with MRI lumbar spine."
  - "Continue follow-up."
  - "Tissue diagnosis is recommended."
  - "The patient was given information to schedule an appointment."
  - "No further imaging is required."      (this is a YES: it settles the question explicitly)

Answer NO for:
  - A finding described with nothing asked for. Most sentences in a report are this.
  - The indication or clinical history, including "rule out fracture" or "evaluate for bleeding".
    That is why the study was done, not what to do next. Sentences under an INDICATION, HISTORY,
    REASON FOR EXAM or CLINICAL INFORMATION heading are almost always NO.
  - How the study was performed, what contrast was given, what images were reconstructed.
  - Comparison with prior studies.
  - Hedges about what a finding is: "cannot exclude", "may represent", "is likely",
    "suggestive of". Uncertainty about a finding asks for nothing.
  - What this study could not show, for example "CT is not able to provide intrathecal detail
    comparable to MRI". A limitation is not a request, even when it names another test.
  - Notification or communication blocks describing how this report was delivered, even when they
    contain the word "recommendation".
  - Pointers to another document, for example "please refer to the CT abdomen report".
  - Generic "clinical correlation advised" with no specific test named.

Answer with JSON only: {"leaves_something_to_do": true or false}`;

const FORMAT = {
  type: 'object',
  properties: { leaves_something_to_do: { type: 'boolean' } },
  required: ['leaves_something_to_do'],
};

/** Ask the model about one sentence. Returns a boolean, or throws if the model is unreachable. */
export async function detectInSentence(sentence, section, { model = DEFAULT_MODEL } = {}) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: FORMAT,
      options: { temperature: 0, num_ctx: 2048 },
      messages: [
        { role: 'system', content: DETECT_PROMPT },
        { role: 'user', content: `Section heading: ${section ?? '(none)'}\n\nSentence: ${sentence}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama returned ${res.status}`);
  return Boolean(JSON.parse((await res.json()).message.content).leaves_something_to_do);
}

/** Trim a segment span to its non-whitespace content, so the quote round-trips exactly. */
function tightSpan(text, span) {
  const raw = text.slice(span[0], span[1]);
  const lead = raw.length - raw.trimStart().length;
  const start = span[0] + lead;
  return [start, start + raw.trim().length];
}

/**
 * Detect in one report. `sectionFilter` applies LABELLING.md 7.4 and 7.8 as a rule; passing false
 * disables it, which is how the two rows of the RESULTS.md table were produced.
 */
export async function detectInReport(text, { model = DEFAULT_MODEL, sectionFilter = true } = {}) {
  const hits = [];
  let asked = 0;
  for (const seg of splitSentences(text)) {
    const sentence = seg.text.trim();
    if (sentence.length <= 2) continue;
    if (sectionFilter && sectionCannotRecommend(seg.section)) continue;
    asked++;
    if (!await detectInSentence(sentence, seg.section, { model })) continue;
    const span = tightSpan(text, seg.span);
    hits.push({
      recommendation_verbatim: text.slice(...span),
      recommendation_span: span,
      section: seg.section,
      // Stage one detects. It does not fill fields, and these placeholders say so rather than
      // implying a judgement nothing made.
      finding: 'other',
      action: 'unclear',
      finding_verbatim: null,
      finding_span: null,
      anatomy: null,
      modality: null,
      interval: null,
      interval_verbatim: null,
      conditional: false,
      negated: false,
      already_scheduled: false,
    });
  }
  return { hits, asked };
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (f, d = null) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };
  const corpusPath = get('--corpus');
  const outPath = get('--out');
  const model = get('--model', DEFAULT_MODEL);
  const sectionFilter = !args.includes('--no-filter');

  if (!corpusPath || !outPath) {
    console.error('usage: node detect.mjs --corpus <reports.json> --out <predictions.json> '
      + '[--model M] [--no-filter]');
    process.exit(2);
  }

  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
  const reports = corpus.reports ?? corpus;
  const predictions = [];
  let calls = 0;
  const started = Date.now();

  for (const [i, r] of reports.entries()) {
    let hits = [];
    let asked = 0;
    try {
      ({ hits, asked } = await detectInReport(r.text, { model, sectionFilter }));
    } catch (err) {
      console.error(`  ${r.id}: ${err.message}`);
    }
    calls += asked;
    predictions.push({
      report_id: r.id,
      output: {
        document: { date_found: null, language: 'en' },
        recommendations: hits.map(({ section, ...rec }) => rec),
        extraction: {
          model,
          prompt_version: DETECT_VERSION + (sectionFilter ? '+sectionfilter' : ''),
          language_validated: false,
          no_recommendation_found: hits.length === 0,
          unparseable: false,
        },
        rejected: [],
      },
    });
    console.log(`[${String(i + 1).padStart(3)}/${reports.length}] ${r.id.padEnd(18)} `
      + `${asked} asked -> ${hits.length} yes`);
  }

  writeFileSync(outPath, JSON.stringify({
    corpus: corpus.corpus ?? corpusPath,
    model,
    prompt_version: DETECT_VERSION + (sectionFilter ? '+sectionfilter' : ''),
    predictions,
  }, null, 2) + '\n', 'utf8');

  console.log(`\n${calls} sentence calls, ${((Date.now() - started) / 1000).toFixed(0)}s, `
    + `wrote ${outPath}`);
  console.log('Stage one only: finding and action are placeholders, so those two metrics mean '
    + 'nothing when this file is scored.');
}
