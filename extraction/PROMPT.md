# Extraction prompt v0.1

The prompt is versioned and treated as part of the system, not as a tuning knob. Any change to it
invalidates previously measured metrics, so the version string is recorded in every extraction
output alongside the model identifier.

## Design decision: the model does not produce character offsets

`SCHEMA.json` requires a character span for every verbatim string, because the C3 verification
screen highlights the source sentence. Language models are unreliable at counting characters, so
asking for offsets directly produces plausible-looking but wrong spans.

Instead the model returns **only the verbatim string**, and the harness locates it in the source
text to compute the span.

This turns a weakness into a safety check. If a returned "verbatim" string cannot be found
character-for-character in the source document, the model invented or altered it, and the extraction
is **rejected**. Fabrication becomes a hard validation failure rather than something a human has to
notice. It enforces R5 mechanically.

Consequence: the prompt must insist on exact copying, including any typographical errors in the
original. Tidying a quote is indistinguishable from fabricating one, as far as the check is
concerned, and both are equally unacceptable in text that will be shown to a clinician.

---

## System prompt

```
You extract follow-up recommendations from clinical reports. You do not interpret them.

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

Return only JSON matching the given schema. No commentary, no explanation, no markdown.
```

## User message

```
Report language: {language}
Today is not relevant. Use only dates written in the report.

--- BEGIN REPORT ---
{report_text}
--- END REPORT ---
```

## Notes on wording, and why each line is there

- **"You do not interpret them"** appears in the first line rather than buried in a list. C1 is the
  constraint that keeps this system outside device regulation, so it leads.
- **"An empty result is a correct and common answer"** counteracts the strong tendency of
  instruction-tuned models to produce output when asked to extract something. Most reports contain
  no recommendation, and a model that dislikes returning nothing will manufacture findings.
- **"This is not optional"** on the interval rule is deliberate emphasis. Models know Fleischner
  intervals and will volunteer them. A guideline-derived interval that is not attributed to a
  versioned rule violates R6 and produces a due date nobody can audit.
- **Rule 5** is the C1 boundary restated in operational terms, and it is the rule most likely to be
  broken, because it asks the model to withhold a clinically reasonable inference.
- **"a confident wrong answer is not"** discourages uniformly high confidence, which makes the
  threshold in C6 meaningless.
- **"ONE ENTRY PER RECOMMENDED ACTION"** exists because a merged entry produces one obligation where
  two are owed, and the missing one is invisible: nothing downstream can tell that a referral was
  swallowed by an imaging entry. It restates rule 5 immediately afterwards, because listing an
  example with two actions reliably re-primes the model to also emit entries for bare findings.
  Both models still merge on the `multiple-recommendations` fixture, so this wording is necessary
  and not sufficient. See `RESULTS.md`, known defect 1.
- **"HOW TO FILL EACH FIELD"** disambiguates the closed vocabularies. Without the `finding` guidance
  the model picks categories for diseases the report never mentions, which corrupts `identity_key`
  and therefore supersession (section 6 of the specification).

### Why the prompt names `interval_value` and `interval_unit`, and `SCHEMA.json` does not

`SCHEMA.json` models the interval as a nullable object. The prompt and the decoding schema flatten
it to two scalars with a `"none"` sentinel, and the harness reassembles the object. This is not a
schema disagreement; it is a constrained-decoding workaround, and the reasons are recorded on
`OUTPUT_FORMAT` in `extract.mjs`. A nullable-object union made the 3B emit `null` for every
interval, including "in 6 months".

The instruction *"if you write a unit or value you MUST also quote the words you read it from"* is
what makes rule 3 checkable. The quote is what the harness looks for in the source; an interval
whose words are not there is rejected as `interval_not_supported_by_source`.

---

## Corrections to this document

**2026-08-03 - transcript corrected, version deliberately NOT bumped.**

The `ONE ENTRY PER RECOMMENDED ACTION` and `HOW TO FILL EACH FIELD` blocks above were present in
`SYSTEM_PROMPT` in `extract.mjs` from the moment the runner was written (`3aab9f9`), but were never
backported into this file, which was written first (`03dd1bd`). For that period this document was an
incomplete transcript of the prompt that ran.

The version stays **0.1**, and this is the deliberate choice rather than an oversight:

- Every number in `RESULTS.md` was produced by the `extract.mjs` text, which is what is now
  transcribed here. No measurement was ever taken under the shorter text this file used to show.
- `PROMPT_VERSION` is stamped into every extraction output. Bumping the document alone would
  reintroduce the drift; bumping both would orphan the `prompt_version: 0.1` recorded in every
  result already published, and would assert that re-measurement is required when the prompt that
  was measured has not changed by one character.

So the artefact being corrected is the record, not the system. Nothing in `RESULTS.md` is
invalidated. The rule at the top of this file - that any change to the prompt invalidates previously
measured metrics - is untouched and still binding.

The sync comment on `SYSTEM_PROMPT` is what failed here, because a comment cannot detect its own
violation. It has been replaced with a check: `smoke.mjs` compares the fenced block above against
`SYSTEM_PROMPT` and exits non-zero on any difference, before it makes a single model call. Same
principle as the fabrication check, applied to the document instead of the output.

## Model plan

| Role | Model | Approximate size |
|---|---|---|
| Iteration | `qwen2.5:3b-instruct-q4_K_M` | 2 GB |
| Primary | `qwen2.5:7b-instruct-q4_K_M` | 4.7 GB |

Qwen2.5 is chosen for two reasons: reliable constrained JSON output, and strong multilingual
coverage. The second matters because locale packs and non-English extraction are a stated goal, and
switching model families later would invalidate every measured number.

Runs on CPU via Ollama. On six cores, expect roughly 10 to 20 seconds per report for the 3B and 30
to 60 seconds for the 7B. Iterate on the 3B, measure on the 7B overnight.

Any model swap is a version bump and requires re-measurement. There is no such thing as an
extraction metric independent of the model that produced it.
