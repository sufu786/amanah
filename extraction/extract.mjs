// Amanah extraction runner.
//
// Runs the versioned prompt in extraction/PROMPT.md against a clinical report and returns
// output conforming to extraction/SCHEMA.json.
//
// Two things this file guarantees, which the model cannot be trusted to guarantee itself:
//
//   1. Every "_verbatim" string is located in the source text and its span computed here.
//      A quote that cannot be found character-for-character is treated as FABRICATED and the
//      recommendation is rejected. This enforces R5 mechanically rather than by instruction.
//
//   2. No interval is ever invented. If the model returns an interval the source does not
//      support, that is caught by the verbatim check on interval_verbatim, not by trusting
//      the model's rule-following.
//
// Usage:
//   node extract.mjs --file report.txt [--model qwen2.5:7b-instruct-q4_K_M] [--lang en]
//   node extract.mjs --text "..." --json

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROMPT_VERSION = '0.1';

// The 7B is the model selected in extraction/RESULTS.md: zero false positives and zero
// fabrications on 50 real reports, against 2 false positives and 6 fabrication rejections for
// the 3B. The 3B remains the iteration model (pass --model), but it must not be the default a
// user gets by running this file, because the way it is worse is the way that matters: it
// invents obligations that were never recommended.
const DEFAULT_MODEL = 'qwen2.5:7b-instruct-q4_K_M';
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// Exported so the labelling harness validates against these lists rather than keeping its own
// copy. Three copies of a controlled vocabulary is how the PROMPT.md drift happened.
export const FINDING_CATEGORIES = [
  'pulmonary_nodule', 'hepatic_lesion', 'renal_mass', 'adrenal_nodule', 'thyroid_nodule',
  'pancreatic_cyst', 'adnexal_mass', 'aortic_aneurysm', 'vertebral_fracture', 'coronary_calcium',
  'iron_deficiency_anaemia', 'haematuria_microscopic', 'psa_elevated', 'thrombocytosis',
  'hypercalcaemia', 'lft_abnormal_persistent',
  'fit_positive', 'mammography_recall', 'cervical_screen_abnormal', 'aaa_screen_positive',
  'tb_confirmed', 'tb_presumptive', 'hbv_chronic', 'hcv_positive', 'hiv_positive',
  'syphilis_positive',
  'hcc_surveillance', 'lynch_surveillance', 'barretts_surveillance', 'post_treatment_surveillance',
  'other',
];

export const ACTIONS = [
  'imaging', 'laboratory', 'referral', 'treatment_initiation',
  'procedure', 'specialist_review', 'unclear',
];

// This is the prompt of record. extraction/PROMPT.md must transcribe it character-for-character,
// and smoke.mjs asserts that before it runs anything, because the previous arrangement was a
// comment asking a human to keep two copies in step, and it silently failed. Changing this string
// is a PROMPT_VERSION bump and invalidates every measured number in RESULTS.md.
export const SYSTEM_PROMPT = `You extract follow-up recommendations from clinical reports. You do not interpret them.

Your only task is to find statements in the report where the clinician recommends that
something further should happen after this report: another test, a procedure, a referral,
a treatment, or a review.

ABSOLUTE RULES

1. Copy exactly. Every "_verbatim" field must be copied character-for-character from the
   report, including any spelling or spacing errors. Never paraphrase, correct, translate,
   or tidy. If you cannot copy it exactly, omit the recommendation.

2. Never interpret. Do not state or imply what a finding means, how serious it is, or what
   it might indicate. Do not add urgency that is not written in the report.

3. Never infer an interval. If the report recommends follow-up without saying when, set
   "interval" to null. If it refers to a guideline instead of a time, for example "as per
   Fleischner criteria", set "interval" to null. Do not supply a time from your own
   knowledge of guidelines. This is not optional.

4. Never invent. If the report contains no follow-up recommendation, return an empty
   "recommendations" array and set "no_recommendation_found" to true. An empty result is a
   correct and common answer. A guessed recommendation is a serious error.

5. Describing a finding is not recommending follow-up. A report may describe an abnormality
   and recommend nothing. In that case there is no recommendation to extract, regardless of
   how significant the finding appears to you.

6. Do not guess location. Set "anatomy" only when the report names the location specifically.
   If it says "nodule in the lung" with no lobe, "anatomy" is null.

WHAT TO EXTRACT

Include:
  - "Recommend CT follow-up in 6 months."
  - "Suggest correlation with ultrasound."
  - "Further evaluation with MRI is advised."
  - "Referral to respiratory recommended."
  - "Consider repeat imaging if symptoms persist."  (set "conditional": true)
  - "No further imaging is required."               (set "negated": true)

Exclude:
  - Findings described with no recommended action.
  - Actions taken during this examination, for example "repeat views obtained".
  - Things already done, for example "CT performed yesterday".
  - Generic boilerplate such as "clinical correlation advised" when no specific test is named.

FLAGS

  "conditional": true       follow-up depends on a condition, e.g. "if symptoms persist"
  "negated": true           the report says follow-up is NOT needed
  "already_scheduled": true the report says the follow-up is already arranged

ONE ENTRY PER RECOMMENDED ACTION

"Recommend PET-CT and referral to the respiratory team" is TWO entries: one imaging, one
referral. Do not merge distinct actions into a single entry.

Do NOT create an entry for a finding that is merely described. An entry requires a
recommended action.

HOW TO FILL EACH FIELD

  finding          Pick the category matching the abnormality the recommendation is about.
                   A lung nodule or lung mass is "pulmonary_nodule". A liver lesion is
                   "hepatic_lesion". A kidney lesion is "renal_mass". An adrenal nodule is
                   "adrenal_nodule". If the report names no abnormality, or none of the
                   categories fits, use "other". Never pick a category for a disease the
                   report does not mention.

  action           imaging for any scan or X-ray. laboratory for blood or tissue tests.
                   referral for sending the patient to a person or team. procedure for
                   biopsy or intervention. specialist_review for review of the images or
                   case. unclear if you cannot tell.

  interval_value   The number of time units stated. Use 0 when no time is stated.
  interval_unit    day, week, month or year. Use "none" when no time is stated.
  interval_verbatim
                   The time exactly as printed, for example "in 6 months". Use "none" when
                   no time is stated. If you write a unit or value you MUST also quote the
                   words you read it from, copied exactly.

  finding_verbatim, anatomy, modality
                   Use the string "none" when the report does not state it. Never guess.

Set "confidence" to your confidence that a real follow-up recommendation is stated in the
text you quoted. Use the full range. Low confidence is useful information; a confident wrong
answer is not.

Return only JSON matching the given schema. No commentary, no explanation, no markdown.`;

// Structural schema handed to Ollama for constrained decoding.
//
// Two deliberate departures from SCHEMA.json, both because constrained decoding degrades badly
// on union types and on optional fields:
//
//   1. NO UNION TYPES. `interval` is flattened to interval_value / interval_unit, both plain
//      scalars with a sentinel for absent. A nullable-object union caused the 3B model to emit
//      null for every interval, including "in 6 months".
//
//   2. EVERY FIELD IS REQUIRED. An optional boolean is a boolean the model silently omits, and
//      an omitted flag defaults to false, which reads as a confident negative rather than an
//      absent answer. Forcing a decision makes wrong answers visible instead of invisible.
//
// Spans are still excluded: the model never produces offsets, this file computes them.
const OUTPUT_FORMAT = {
  type: 'object',
  required: ['date_found', 'date_verbatim', 'no_recommendation_found', 'recommendations'],
  properties: {
    date_found: { type: 'string', description: 'YYYY-MM-DD from the report, or "none"' },
    date_verbatim: { type: 'string', description: 'the date exactly as printed, or "none"' },
    no_recommendation_found: { type: 'boolean' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'recommendation_verbatim', 'finding_verbatim', 'finding', 'anatomy', 'action',
          'modality', 'interval_value', 'interval_unit', 'interval_verbatim',
          'confidence', 'conditional', 'negated', 'already_scheduled',
        ],
        properties: {
          recommendation_verbatim: { type: 'string' },
          finding_verbatim: { type: 'string', description: 'the finding as printed, or "none"' },
          finding: { type: 'string', enum: FINDING_CATEGORIES },
          anatomy: { type: 'string', description: 'specific location, or "none"' },
          action: { type: 'string', enum: ACTIONS },
          modality: { type: 'string', description: 'test or procedure named, or "none"' },
          interval_value: { type: 'number', description: '0 when no time is stated' },
          interval_unit: { type: 'string', enum: ['day', 'week', 'month', 'year', 'none'] },
          interval_verbatim: { type: 'string', description: 'the time as printed, or "none"' },
          confidence: { type: 'number' },
          conditional: { type: 'boolean' },
          negated: { type: 'boolean' },
          already_scheduled: { type: 'boolean' },
        },
      },
    },
  },
};

/** "none" and empty string are the model's way of saying absent. Normalise to null. */
const nn = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return (s === '' || s.toLowerCase() === 'none' || s.toLowerCase() === 'null') ? null : s;
};

/**
 * Locate a quoted string in the source text.
 *
 * Exact match only. Whitespace is normalised for the search because line wrapping in clinical
 * reports is arbitrary, but the returned span always points at the real source characters.
 *
 * Returns null when the quote is not present, which the caller MUST treat as fabrication.
 */
export function locateSpan(source, quote) {
  if (typeof quote !== 'string' || quote.length === 0) return null;

  const direct = source.indexOf(quote);
  if (direct !== -1) return [direct, direct + quote.length];

  // Whitespace-insensitive search. Build a map from collapsed offsets back to real offsets so
  // the span still refers to genuine source positions.
  const map = [];
  let collapsed = '';
  let prevWasSpace = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      if (prevWasSpace) continue;
      collapsed += ' ';
      map.push(i);
      prevWasSpace = true;
    } else {
      collapsed += ch;
      map.push(i);
      prevWasSpace = false;
    }
  }
  const needle = quote.replace(/\s+/g, ' ').trim();
  const idx = collapsed.indexOf(needle);
  if (idx === -1) return null;

  const start = map[idx];
  const endCollapsed = idx + needle.length - 1;
  const end = map[Math.min(endCollapsed, map.length - 1)] + 1;
  return [start, end];
}

/** Validate and repair one recommendation. Returns {ok, value, reason}. */
export function validateRecommendation(rec, source) {
  const recVerbatim = nn(rec.recommendation_verbatim);
  const recSpan = recVerbatim ? locateSpan(source, recVerbatim) : null;
  if (!recSpan) {
    return { ok: false, reason: 'fabricated_recommendation_quote' };
  }

  const findVerbatim = nn(rec.finding_verbatim);
  let findingSpan = null;
  if (findVerbatim) {
    findingSpan = locateSpan(source, findVerbatim);
    if (!findingSpan) return { ok: false, reason: 'fabricated_finding_quote' };
  }

  // An interval only survives if the source actually contains the words it was read from.
  // A model that "knows" Fleischner will otherwise supply 6 months for a report that never
  // states one (rule 3, R6). This is the check that enforces it, not the instruction.
  const ivVerbatim = nn(rec.interval_verbatim);
  const ivUnit = nn(rec.interval_unit);
  const ivValue = Number(rec.interval_value);
  let interval = null;
  if (ivUnit && ivUnit !== 'none' && Number.isFinite(ivValue) && ivValue > 0) {
    if (!ivVerbatim || !locateSpan(source, ivVerbatim)) {
      return { ok: false, reason: 'interval_not_supported_by_source' };
    }
    interval = { value: ivValue, unit: ivUnit };
  }

  const conf = typeof rec.confidence === 'number'
    ? Math.min(1, Math.max(0, rec.confidence))
    : 0;

  return {
    ok: true,
    value: {
      finding_verbatim: findVerbatim,
      finding_span: findingSpan,
      recommendation_verbatim: recVerbatim,
      recommendation_span: recSpan,
      finding: FINDING_CATEGORIES.includes(rec.finding) ? rec.finding : 'other',
      anatomy: nn(rec.anatomy),
      laterality: null,
      measurement: null,
      action: ACTIONS.includes(rec.action) ? rec.action : 'unclear',
      modality: nn(rec.modality),
      interval,
      interval_verbatim: ivVerbatim,
      urgency_verbatim: null,
      confidence: conf,
      conditional: Boolean(rec.conditional),
      condition_verbatim: null,
      already_scheduled: Boolean(rec.already_scheduled),
      negated: Boolean(rec.negated),
    },
  };
}

export async function extract(reportText, { model = DEFAULT_MODEL, language = 'en' } = {}) {
  const body = {
    model,
    stream: false,
    format: OUTPUT_FORMAT,
    options: { temperature: 0, num_ctx: 8192 },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Report language: ${language}\n` +
          `Today is not relevant. Use only dates written in the report.\n\n` +
          `--- BEGIN REPORT ---\n${reportText}\n--- END REPORT ---`,
      },
    ],
  };

  const started = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const out = await res.json();
  const elapsed_ms = Date.now() - started;

  let raw;
  try {
    raw = JSON.parse(out.message.content);
  } catch {
    return {
      document: { date_found: null, date_span: null, language, modality_of_document: null },
      recommendations: [],
      extraction: {
        model, prompt_version: PROMPT_VERSION, language_validated: false,
        no_recommendation_found: false, unparseable: true,
      },
      rejected: [{ reason: 'model_returned_invalid_json' }],
      elapsed_ms,
    };
  }

  const accepted = [];
  const rejected = [];
  for (const rec of raw.recommendations ?? []) {
    const v = validateRecommendation(rec, reportText);
    if (v.ok) accepted.push(v.value);
    else rejected.push({ reason: v.reason, quote: rec.recommendation_verbatim ?? null });
  }

  // A date the source does not contain is as dangerous as an invented recommendation: every
  // due date is derived from it.
  let dateFound = nn(raw.date_found);
  const dateVerbatim = nn(raw.date_verbatim);
  let dateSpan = null;
  if (dateFound) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFound)) {
      rejected.push({ reason: 'date_malformed', quote: dateFound });
      dateFound = null;
    } else {
      dateSpan = dateVerbatim ? locateSpan(reportText, dateVerbatim) : null;
      if (!dateSpan) {
        rejected.push({ reason: 'date_not_supported_by_source', quote: dateVerbatim });
        dateFound = null;
      }
    }
  }

  return {
    document: {
      date_found: dateFound,
      date_span: dateSpan,
      language,
      modality_of_document: null,
    },
    recommendations: accepted,
    extraction: {
      model,
      prompt_version: PROMPT_VERSION,
      language_validated: false,
      // Only true when the model said so AND nothing survived. Never inferred from an empty
      // array alone, and never presented to a user as an all-clear (C2).
      no_recommendation_found: Boolean(raw.no_recommendation_found) && accepted.length === 0,
      unparseable: false,
    },
    rejected,
    elapsed_ms,
  };
}

// CLI
// pathToFileURL rather than string concatenation. On Windows import.meta.url is
// file:///C:/... with three slashes while the hand-built version had two, so the comparison
// was always false and the CLI below never ran. It failed silently, which is why nobody
// noticed until the corpus tool was tested.
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };

  const file = get('--file');
  const text = get('--text');
  const model = get('--model') ?? DEFAULT_MODEL;
  const language = get('--lang') ?? 'en';

  if (!file && !text) {
    console.error('usage: node extract.mjs --file <path> | --text "<report>" [--model M] [--lang L] [--json]');
    process.exit(2);
  }

  const report = text ?? readFileSync(file, 'utf8');

  // A stack trace for an unreachable model server tells a labeller nothing they can act on, and
  // this is the first thing anyone runs. Now that the CLI actually executes, its failures have to
  // be legible.
  let result;
  try {
    result = await extract(report, { model, language });
  } catch (e) {
    if (e?.cause?.code === 'ECONNREFUSED' || /fetch failed/.test(e?.message ?? '')) {
      console.error(`Cannot reach Ollama at ${OLLAMA}.`);
      console.error('Start it with `ollama serve`, and check the model is pulled:');
      console.error(`  ollama pull ${model}`);
      console.error('Set OLLAMA_HOST to point somewhere else.');
      process.exit(3);
    }
    console.error(e.message);
    process.exit(1);
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`model ${result.extraction.model}  prompt v${result.extraction.prompt_version}  ${result.elapsed_ms} ms`);
    console.log(`date_found: ${result.document.date_found ?? '(none)'}`);
    if (result.recommendations.length === 0) {
      console.log('no follow-up recommendation FOUND (this does not mean none exists)');
    }
    for (const r of result.recommendations) {
      const iv = r.interval ? `${r.interval.value} ${r.interval.unit}` : '(none stated)';
      console.log(`  [${r.finding}/${r.action}] conf=${r.confidence.toFixed(2)} interval=${iv}`);
      console.log(`    "${r.recommendation_verbatim}"  @${r.recommendation_span.join('-')}`);
      const flags = [
        r.conditional && 'conditional', r.negated && 'negated',
        r.already_scheduled && 'already_scheduled',
      ].filter(Boolean);
      if (flags.length) console.log(`    flags: ${flags.join(', ')}`);
    }
    for (const rj of result.rejected) {
      console.log(`  REJECTED (${rj.reason})${rj.quote ? `: "${rj.quote}"` : ''}`);
    }
  }
}
