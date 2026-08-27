// Stage three: fill the fields of a recommendation that has already been found.
//
//   node fields.mjs --corpus reports.json --predictions verified.json --out filled.json
//
// detect.mjs and verify.mjs answer yes or no. Everything downstream needs more than that: a
// category to resolve identity across serial studies, an action to route on, an interval to derive
// a due date from. Until this stage exists the pipeline produces sentences rather than obligations.
//
// The model is told the sentence IS a recommendation and asked only to describe it. That is a
// smaller question than the one extract.mjs asks, and the split is the point: detection failed at
// 27% recall while field-filling was never the problem.
//
// Every quoted string is validated against the source by validateRecommendation, which is the same
// function extract.mjs uses. A quote that cannot be located character for character is treated as
// fabricated and the whole candidate is rejected. That check is what enforces R5, and reusing it
// rather than reimplementing it is deliberate: three copies of a rule is how PROMPT.md drifted.
//
// WHAT THIS CANNOT DO ON MIMIC. Every date in the corpus is de-identified, so no obligation can be
// created from it whatever this stage returns. See CORPUS.md section 8. Intervals cannot be
// measured either: no instance in the pilot states one. This stage is measurable on action and on
// the flags, and honestly on category, where the placeholder that preceded it scored well by
// accident.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  FINDING_CATEGORIES, ACTIONS, ANATOMY, LATERALITY, validateRecommendation,
} from './extract.mjs';

export const FIELDS_VERSION = '0.1';

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:7b-instruct-q4_K_M';

export const FIELDS_PROMPT = `You are shown a clinical report and one sentence from it that HAS ALREADY BEEN CONFIRMED to ask
for something to be done after the report.

Do not judge whether it is a recommendation. That is settled. Describe it.

ABSOLUTE RULES

1. Copy exactly. Every "_verbatim" field must be copied character for character from the report,
   including any spelling or spacing errors. Never paraphrase, correct or tidy. A quote that cannot
   be found in the report is treated as invented and the whole answer is discarded.

2. Never infer an interval. If the sentence asks for follow-up without saying when, the interval is
   none. If it names a guideline instead of a time, for example "as per Fleischner criteria", the
   interval is still none. Do not supply a time from your own knowledge. This is not optional.

3. Do not guess. Every field has a "none" and it is the right answer more often than not.

HOW TO FILL EACH FIELD

  finding          The category of the abnormality this recommendation is about. A lung nodule or
                   lung mass is "pulmonary_nodule". A liver lesion is "hepatic_lesion". A kidney
                   lesion is "renal_mass". An adrenal nodule is "adrenal_nodule". A thyroid nodule
                   is "thyroid_nodule". A screening mammogram recalled for more imaging is
                   "mammography_recall". If the report names no abnormality, or none of the
                   categories fits, use "other". Never pick a category for a disease the report
                   does not mention. "other" is common and correct.

  finding_verbatim The words naming the abnormality, copied from the report. This is usually a
                   different sentence from the recommendation, often in the findings or the
                   impression. Use "none" only when the report names no abnormality at all, which
                   happens when a normal study still asks for something.

  action           imaging for any scan or X-ray. laboratory for blood or tissue tests. referral
                   for sending the patient to a person or team. procedure for a biopsy or
                   intervention. treatment_initiation for starting a treatment. specialist_review
                   for review of the images or the case. unclear if the sentence asks for
                   something but does not say what.

  modality         The kind of test asked for, in the report's own words, with the body part
                   removed. "MRI lumbar spine" is modality "MRI". A biopsy performed under
                   ultrasound guidance has modality "ultrasound" and action "procedure". Use
                   "none" when no test is named.

  anatomy          The organ or structure, chosen from the list the schema allows and nothing else.
                   A nodule in the left lower lobe is "lung". A lesion in the left thyroid lobe is
                   "thyroid". Where several findings are described and only one is located, the
                   location belongs to that one and not to the group, so the group is "none". If
                   the recommendation names no body part at all, it is "none". Do not infer the
                   body part from what kind of study this was.

  laterality       left, right, bilateral or midline, and only when the report says so. This is a
                   separate field from anatomy: a left thyroid lesion is anatomy "thyroid" and
                   laterality "left", never anatomy "thyroid.left". Use "none" when no side is
                   stated or the structure has no side.

  interval_value   The number of time units stated. Use 0 when no time is stated.
  interval_unit    day, week, month or year. Use "none" when no time is stated.
  interval_verbatim
                   The time exactly as printed, for example "in 6 months". Use "none" when no time
                   is stated. If you give a unit or a value you MUST also quote the words you read
                   them from, copied exactly.

FLAGS

  "conditional": true       the request depends on a condition, for example "if symptoms persist"
  "negated": true           the sentence says follow-up is NOT needed
  "already_scheduled": true the report says it is already booked. Being told to arrange something,
                            or handed information to book it, is NOT already scheduled.

Set "confidence" to your confidence in the fields you have filled. Use the full range. Low
confidence is useful information; a confident wrong answer is not.

Return only JSON matching the given schema. No commentary, no explanation, no markdown.`;

const FORMAT = {
  type: 'object',
  properties: {
    finding: { type: 'string', enum: FINDING_CATEGORIES },
    finding_verbatim: { type: 'string' },
    action: { type: 'string', enum: ACTIONS },
    modality: { type: 'string' },
    anatomy: { type: 'string', enum: [...ANATOMY, 'none'] },
    laterality: { type: 'string', enum: [...LATERALITY, 'none'] },
    interval_value: { type: 'number' },
    interval_unit: { type: 'string', enum: ['day', 'week', 'month', 'year', 'none'] },
    interval_verbatim: { type: 'string' },
    conditional: { type: 'boolean' },
    negated: { type: 'boolean' },
    already_scheduled: { type: 'boolean' },
    confidence: { type: 'number' },
  },
  required: ['finding', 'action', 'interval_unit', 'conditional', 'negated', 'already_scheduled'],
};

/**
 * Fill the fields of one confirmed recommendation.
 *
 * Returns {ok: true, value} shaped as the schema expects, or {ok: false, reason} when a quoted
 * string could not be located in the source. The recommendation quote is supplied rather than
 * asked for, so it cannot be fabricated here.
 */
export async function fillFields(reportText, sentence, { model = DEFAULT_MODEL } = {}) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: FORMAT,
      options: { temperature: 0, num_ctx: 8192 },
      messages: [
        { role: 'system', content: FIELDS_PROMPT },
        {
          role: 'user',
          content: `REPORT:\n${reportText}\n\n---\n\nTHE CONFIRMED RECOMMENDATION:\n${sentence}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama returned ${res.status}`);
  const raw = JSON.parse((await res.json()).message.content);

  // The recommendation quote comes from detection, which located it in the source already. Only
  // the fields the model added are subject to the fabrication check.
  return validateRecommendation({ ...raw, recommendation_verbatim: sentence }, reportText);
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
    console.error('usage: node fields.mjs --corpus <reports.json> --predictions <verified.json> '
      + '--out <filled.json> [--model M]');
    process.exit(2);
  }

  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
  const reports = new Map((corpus.reports ?? corpus).map((r) => [r.id, r.text]));
  const pred = JSON.parse(readFileSync(predPath, 'utf8'));

  let filled = 0;
  let rejected = 0;
  const started = Date.now();

  for (const p of pred.predictions) {
    const text = reports.get(p.report_id);
    const out = [];
    for (const rec of p.output.recommendations ?? []) {
      let v;
      try {
        v = await fillFields(text, rec.recommendation_verbatim, { model });
      } catch (err) {
        console.error(`  ${p.report_id}: ${err.message}`);
        v = { ok: false, reason: 'model_unreachable' };
      }
      if (v.ok) {
        filled++;
        // The span from detection is kept. locateSpan finds the first occurrence, and a sentence
        // stated twice would otherwise silently move to the copy the labeller did not choose.
        out.push({ ...v.value, recommendation_span: rec.recommendation_span });
      } else {
        rejected++;
        (p.output.rejected ??= []).push({ reason: v.reason, quote: rec.recommendation_verbatim });
        console.log(`  rejected ${p.report_id}: ${v.reason}`);
      }
    }
    p.output.recommendations = out;
    p.output.extraction.prompt_version += `+fields${FIELDS_VERSION}`;
  }

  pred.prompt_version += `+fields${FIELDS_VERSION}`;
  writeFileSync(outPath, JSON.stringify(pred, null, 2) + '\n', 'utf8');

  console.log(`\n${filled} filled, ${rejected} rejected by the verbatim check, `
    + `${((Date.now() - started) / 1000).toFixed(0)}s`);
}
