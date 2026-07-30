# Gold-standard labelling protocol v0.1

This document defines what "correct" means, and it exists **before** any model runs. Written
afterwards, a protocol tends to describe whatever the model already does, and the evaluation stops
being an evaluation.

Labels produced under this protocol are published alongside the metrics, so anyone can check the
judgement calls rather than take the numbers on trust.

---

## 1. Unit of labelling

One label set per **report**, containing zero or more **recommendation instances**.

A report with no follow-up recommendation is labelled with an empty set. **These reports are not
optional and must not be a small share of the corpus.** They are how the false-positive rate is
measured, and false positives on normal reports are how this system loses the trust of the people
using it.

Target composition: at least 60% of the labelled set should be reports with no actionable
recommendation.

## 2. What counts as a follow-up recommendation

**Include** a recommendation instance when the report states that a further test, procedure,
referral, treatment or review should happen after this report.

Examples that count:

- "Recommend CT follow-up in 6 months."
- "Suggest correlation with ultrasound."
- "Further evaluation with MRI is advised."
- "Recommend referral to respiratory."
- "Consider repeat imaging if symptoms persist." (label as **conditional**)
- "Follow-up as per Fleischner criteria." (interval null, since none is stated)

**Exclude:**

- Descriptions of findings with no recommended action. A nodule described and not acted on is not a
  recommendation, however clinically significant a labeller may believe it to be. **The system
  tracks what was recommended, not what should have been.** This is the C1 boundary and it is the
  most common labelling error.
- Recommendations about the current examination, e.g. "repeat views obtained due to motion".
- Statements of what has already happened, e.g. "CT performed yesterday".
- Generic closing boilerplate, e.g. "clinical correlation is advised", unless it names a specific
  test or action.

**Boundary rule:** if the labeller has to reason clinically about whether follow-up *ought* to
happen, the answer is exclude. Only what is written counts.

## 3. Multiple recommendations in one report

Label each distinct recommended action separately, even when they concern the same finding.

> "8 mm right upper lobe nodule. Recommend CT at 3 months and again at 12 months."

Two instances, intervals 3 months and 12 months, same finding.

> "Recommend CT chest and referral to respiratory."

Two instances, actions `imaging` and `referral`.

A single action for multiple findings is one instance, with `finding` set to the primary finding
named in the recommendation, or `other` if the recommendation names none.

## 4. Field-level rules

**`recommendation_verbatim`** and **`finding_verbatim`**: copy the span exactly as printed,
including typographical errors. Do not tidy. Spans are offsets into the extracted text and must
round-trip: `text[start:end]` has to equal the verbatim string, or the label is invalid.

**`interval`**: only when stated in the report.
- "in 6 months" -> `{value: 6, unit: month}`
- "6-12 months" -> interval `null`, `interval_verbatim: "6-12 months"`. Ranges are not silently
  collapsed to either endpoint; the downstream guideline layer decides, versioned and attributed.
- "as per Fleischner" -> interval `null`. The extractor must never supply a guideline default (R6).
- "annually" -> `{value: 1, unit: year}`

**`date_found`**: the report's own date. If several dates appear (study date, dictation date, sign-off
date), take the **study date**. If none is determinable, `null`, never today's date.

**`anatomy`**: only when the report is specific. "nodule in the lung" is `null`, not
`lung.unspecified`. An invented location corrupts identity resolution across serial studies, which
section 6 of the specification treats as the most dangerous silent failure available.

**`negated`**: capture explicit statements that follow-up is not needed. "No further imaging
required" is a labelled instance with `negated: true`, not an empty set. It is evidence, and it
supports the `not_indicated` terminal state.

**`already_scheduled`**: "Patient is booked for CT next month" sets this true.

## 5. Labeller procedure

1. Two labellers work independently on the same reports. No discussion during labelling.
2. Disagreements are recorded, then resolved by discussion; if unresolved, a third labeller decides.
3. **Report inter-annotator agreement before resolution, always.** Cohen's kappa on the binary
   question "does this report contain at least one recommendation", plus exact-match agreement on
   interval and finding category.
4. If kappa on the binary question is below 0.75, the protocol is too ambiguous. Fix the protocol
   and relabel. Do not proceed to model evaluation on a set the humans cannot agree about.
5. Every judgement call not covered here gets appended to section 7 as a precedent, with the
   report ID.

## 6. Metrics, and how they are reported

Reported separately, never as a single aggregate:

| Metric | Definition |
|---|---|
| **Detection recall** | Of labelled recommendations, the share the extractor found. Misses are the C2 risk: false reassurance. |
| **Detection precision** | Of extracted recommendations, the share that are real. Errors here are invented obligations, which destroy trust fast. |
| **False-positive rate on clean reports** | Share of no-recommendation reports where the extractor produced one. **Reported as a headline figure, always.** |
| **Interval accuracy** | Exact match on value and unit, among correctly detected recommendations. |
| **Category accuracy** | Exact match on `finding`, among correctly detected recommendations. |
| **Span validity** | Share of outputs where `text[start:end]` equals the verbatim string. Anything below 100% breaks the C3 verification screen. |

**A single F1 number is not an acceptable summary.** Recall and precision have different clinical
consequences here and must not be traded against each other silently.

Report metrics per language, and never pool a language with fewer than 200 labelled reports into a
combined figure.

## 7. Precedents

Judgement calls, appended as they arise. Each entry: the text, the decision, the reason.

*(none yet)*
