// One report, start to finish: detect, verify, fill. Phase 2, stage 1.
//
// The three stages were built and measured over a corpus, one file per stage, and the corpus tools
// refuse to write anything when the model fails, because a half-run would score as a result. A
// patient checking one report needs the opposite trade. They are about to read every item anyway
// (constraint C3), so a stage that fails partway should leave the item visible and say what was not
// done, rather than drop it or stop. Three cases, each handled in the direction that keeps a real
// duty in front of the patient:
//
//   detection fails       Nothing was read. ModelUnavailableError, so the app can offer the mode in
//                         which the patient selects sentences themselves. An empty result here would
//                         read as "no recommendation found", which is the false all-clear C2 forbids.
//   verification fails    The candidate stays in the first tier, unverified, and is counted.
//   field filling fails   The candidate goes to the second tier marked fields_unavailable, with
//                         placeholder fields, which acceptProposal refuses until a person fills them.
//
// Returns {result, run}. `result` is what obligation/from-extraction.mjs accepts. `run` is what the
// screen needs to say about how the reading went: candidate report dates, and anything that failed.

import { detectInReport, DETECT_VERSION } from './detect.mjs';
import { verifyCandidate, VERIFY_VERSION } from './verify.mjs';
import { fillFields, FIELDS_VERSION } from './fields.mjs';
import { SECTION_FILTER_VERSION } from './sentences.mjs';
import { findDates } from './dates.mjs';

export const DEFAULT_MODEL = 'qwen2.5:7b-instruct-q4_K_M';
export const PIPELINE_VERSION = `detect${DETECT_VERSION}+sectionfilter${SECTION_FILTER_VERSION}`
  + `+verify${VERIFY_VERSION}+fields${FIELDS_VERSION}`;

export class ModelUnavailableError extends Error {
  constructor(cause) {
    super('The local model could not be reached, so the report was not read. Nothing has been '
      + 'found or missed: the report has not been looked at yet.');
    this.name = 'ModelUnavailableError';
    this.cause = cause;
  }
}

/**
 * Read one report. `stages` replaces any of detect, verify and fill, which is how the tests run
 * without a model; in use it is left out. `onProgress` is called as each candidate is handled, so a
 * screen can say how far a several-minute read has got.
 */
export async function extractReport(text, { model = DEFAULT_MODEL, stages = {}, onProgress = () => {} } = {}) {
  const detect = stages.detect ?? detectInReport;
  const verify = stages.verify ?? verifyCandidate;
  const fill = stages.fill ?? fillFields;
  const started = Date.now();
  const source = String(text ?? '');

  const document = { date_found: null, date_span: null, language: 'en', modality_of_document: null };
  const run = {
    pipeline: PIPELINE_VERSION,
    model,
    date_candidates: findDates(source),
    sentences_asked: 0,
    candidates: 0,
    unverified: [],
    unfilled: [],
    incomplete: false,
    seconds: 0,
  };

  // Nothing to read is a failure to read, never a clean result (SCHEMA.json, unparseable).
  if (!source.trim()) {
    return {
      result: {
        document,
        recommendations: [],
        second_tier: [],
        rejected: [],
        extraction: { model, language_validated: false, no_recommendation_found: false, unparseable: true },
      },
      run,
    };
  }

  let detected;
  try {
    detected = await detect(source, { model, onSentence: (p) => onProgress({ stage: 'reading', ...p }) });
  } catch (err) {
    throw new ModelUnavailableError(err);
  }
  run.sentences_asked = detected.asked;
  run.candidates = detected.hits.length;

  const recommendations = [];
  const secondTier = [];
  const rejected = [];
  for (const [i, hit] of detected.hits.entries()) {
    onProgress({ stage: 'checking', done: i, of: detected.hits.length });
    let keep = true;
    try {
      keep = await verify(source, hit.recommendation_verbatim, { model });
    } catch {
      run.unverified.push(hit.recommendation_span);
    }
    if (!keep) {
      secondTier.push({ ...hit, doubt_reason: 'verification' });
      continue;
    }
    let filled;
    try {
      filled = await fill(source, hit.recommendation_verbatim, { model });
    } catch {
      run.unfilled.push(hit.recommendation_span);
      secondTier.push({ ...hit, doubt_reason: 'fields_unavailable' });
      continue;
    }
    if (filled.ok) {
      // The span from detection is kept: locateSpan finds the first occurrence, and a sentence the
      // report states twice would otherwise move to the other copy.
      recommendations.push({ ...filled.value, recommendation_span: hit.recommendation_span });
    } else {
      rejected.push({ reason: filled.reason, quote: hit.recommendation_verbatim });
    }
  }
  onProgress({ stage: 'checking', done: detected.hits.length, of: detected.hits.length });

  run.incomplete = run.unverified.length > 0 || run.unfilled.length > 0;
  run.seconds = Math.round((Date.now() - started) / 1000);
  return {
    result: {
      document,
      recommendations,
      second_tier: secondTier,
      rejected,
      extraction: {
        model,
        language_validated: false,
        no_recommendation_found: recommendations.length === 0,
        unparseable: false,
      },
    },
    run,
  };
}
