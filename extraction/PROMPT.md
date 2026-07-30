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
