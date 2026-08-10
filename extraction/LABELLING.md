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

**Decided 2026-08-07: one labeller.** The first version of this protocol required two on every
report, which is the right design and the wrong budget for an independent researcher. A second
labeller on a MIMIC corpus must hold their own PhysioNet credential, because the data use agreement
is per person and reports cannot be handed to anyone who has not signed it. Recruiting one means
finding a clinically literate person willing to complete CITI training, wait out credentialing, and
then work unpaid for many hours.

So 5a is the plan. 5b stays in the protocol because a volunteer may appear, and if one does the
work should not have to be redesigned to accept them.

The cost of this decision is real and is not hidden: **no agreement between people will be
measured, so nothing here demonstrates that a second reader would have labelled the same way.** That
sentence travels with every number produced from these labels. See section 5c.

### 5a. One labeller, the operating plan

There is no honest single-labeller version of an agreement statistic, so none is invented.

1. Every report is labelled by one labeller, working to this protocol.
2. A subset of at least 100 reports is relabelled blind by the same person after at least two weeks,
   with the first labels not consulted. This is reported as **intra-rater consistency** and is never
   called inter-annotator agreement. It measures whether one person applies the protocol the same
   way twice. That is worth knowing, and it is a different question from whether the protocol is
   unambiguous to somebody else.
3. Section 7 precedents are mandatory rather than optional. With one labeller they are the only
   external record of how judgement calls were made, and they are what a reader disagreeing with a
   call has to work from.
4. Every precedent is applied back across all reports labelled before it was written down.
5. All labels are published.

### 5b. Two labellers, if one becomes available

Applies only if a second credentialed labeller volunteers. The corpus does not need relabelling to
adopt this; the subset can be drawn from work already done.

1. A random subset of at least 100 reports is labelled independently by the second labeller, who
   has not seen the first labels. The subset is drawn by seed, and the seed is recorded first.
2. **Report inter-annotator agreement on that subset before resolution, always.** Cohen's kappa on
   the binary question "does this report contain at least one recommendation", plus exact-match
   agreement on interval and finding category.
3. If kappa on the binary question is below 0.75, the protocol is too ambiguous. Fix the protocol
   and relabel. Do not proceed to model evaluation on a set the humans cannot agree about.
4. Disagreements are recorded, then resolved by discussion; if unresolved, a third labeller decides.
5. Each resolution becomes a precedent in section 7 and is applied back across the single-labelled
   remainder. This is what makes a subset protect the whole corpus rather than only the sample: an
   ambiguity found in 100 reports was present in all 500.

### 5c. How the labels were made travels with the metrics

A metric is not independent of the ground truth it was scored against, in the same way that no
extraction metric is independent of the model that produced it. A reader who is told the recall and
not told that one person wrote every label has been given a number without the thing needed to
weigh it.

So a gold standard declares how it was made, `score.mjs` prints that declaration in its header
alongside the model and prompt version, and it refuses to run without it. Under 5a the declaration
reads `1 labeller, agreement between people not measured`, and it appears above every table.

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

---

## 8. The harness

The tools that implement sections 4 to 6. They exist before the corpus does, so that the first
labelled report is scored by machinery nobody could tune after seeing the results.

| File | What it does |
|---|---|
| `LABELS.schema.json` | The label file format. A label is what a human decided, so it carries no confidence field. |
| `labels.mjs` | Loading, validation, instance matching, Cohen's kappa. Shared, so agreement and scoring cannot use different rules. |
| `agreement.mjs` | Section 5. Two labellers against each other, before resolution. |
| `score.mjs` | Section 6. Extractor against the resolved gold standard. |
| `redact.mjs` | Produces the publishable copy of a label set, with quoted report text stripped. See section 8a. |
| `fixtures/labels-example/` | Four reports, two labellers who disagree, a resolution, and a hand-written prediction set reproducing the defects in `RESULTS.md`. Exercises the harness on failures, not only successes. It is **not** a corpus: it violates the 60% rule in section 1 by design. |

```
node agreement.mjs --corpus reports.json --a labeller-a.json --b labeller-b.json
node score.mjs --corpus reports.json --gold gold.json --predictions predictions.json
```

Both take `--json`.

### Validation is refusal, not warning

A label set that does not load cannot be scored. `labels.mjs` rejects, rather than repairs:

- **A span that does not round-trip.** `text.slice(start, end)` must equal the verbatim string. This
  is the most dangerous defect available here, because it points at the wrong sentence while looking
  entirely well-formed, and the C3 verification screen would show the patient that wrong sentence.
- **A `text_sha256` that does not match the corpus.** If the text is re-extracted or whitespace-fixed
  after labelling, every offset moves silently. There is no safe automatic repair; the answer is to
  relabel or restore the text.
- **A corpus report with no label entry.** A report with no recommendation is labelled `[]`. Leaving
  it out removes it from the false-positive denominator, which is the headline figure.
- **Scoring against an unresolved labeller pass.** That measures agreement with one person, and it
  skips the kappa gate.

### How an extracted recommendation is counted as matching a labelled one

By character overlap of the recommendation span, one-to-one, greedily, largest overlap first. This
rule determines every number in section 6, so it is stated here rather than left in the code.

- **Any overlap counts.** Both parties quote the same sentence; a threshold would mostly measure
  where a quote begins.
- **One-to-one.** A single extraction spanning two labelled instances matches one and leaves the
  other a miss. That is intended. The merged-recommendation defect loses a real obligation, and the
  metric must show a loss rather than absorb it. `score.mjs` also counts these separately, as
  *swallowed by a merged prediction*.
- **Ties broken by index**, so the same inputs give the same pairing on every run.

### Two figures that are reported but easy to misread

**Interval accuracy** is reported twice: over all matched instances, and over only those where the
gold label states an interval. The first is inflated by agreement on `null`, which is the common
case and the easy one. Read the second.

**Span validity** is reported exactly and whitespace-normalised. The protocol requires exact.
`extract.mjs` locates quotes whitespace-insensitively, so the two can differ, and reporting only the
lenient figure would hide a real defect in the verification screen.

### Gates

`agreement.mjs` exits non-zero below kappa 0.75, per section 5.4. Undefined kappa does not pass:
where both labellers put every report in one class, chance agreement is total and the statistic does
not exist. It is reported as undefined rather than as a number, because the usual cause is a corpus
with no positives, which is a corpus problem and not an agreement result.

`score.mjs` reports no F1, and will not pool a language below 200 labelled reports into a combined
figure. Languages excluded from the pooled figure are named in the output.

### 8a. Publishing labels without redistributing the corpus

This protocol says labels are published alongside the metrics, so the judgement calls can be
checked rather than taken on trust. A data use agreement that forbids redistributing the corpus
pulls the other way, because a label quotes the report.

`redact.mjs` resolves it without waiting for a ruling:

```
node redact.mjs --in gold.json --out gold.public.json
```

The published copy keeps the spans, categories, intervals, flags and `text_sha256`, and drops every
quoted string. A credentialed reader rebuilds the corpus from the row identifiers, and the loader
refuses the labels unless the text hashes to what was labelled, then derives each quote from their
own copy. Scoring a redacted gold standard produces numbers identical to the unredacted one, which
is checked.

What a reader without corpus access loses is the ability to see the quoted sentence. That reader
could not have judged the call anyway. A category beside one sentence, with none of the surrounding
report, is not enough to say whether a labeller was right, so the quotes buy the appearance of
checkability more than the substance of it.

Three things are refused, because a published artefact gets no second look:

- **Redacting a set with no `text_sha256`.** A redacted file is nothing but offsets. Without the
  hash nobody can prove they rebuilt the corpus those offsets belong to, which is worse than not
  publishing at all.
- **A half-stripped file.** Redaction is all or nothing. A file with some quotes left in has the
  disclosure risk of the full version and the reduced usefulness of the stripped one.
- **Redacted labels loaded against a corpus that is not the one they describe.** Caught by the
  hash, as with any other corpus drift.

If PhysioNet confirms that short quotations are permitted, publish the unredacted file and this
becomes unnecessary. Until then it is the safe default and it costs almost nothing.
