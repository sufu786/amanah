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

**How much to select.** The span has to contain the words that state the action. "She prefers
excision" is not a sufficient span for a `referral`: the sentence continues "and was given
information to schedule an appointment", and the duty is in the second half. Section 6 matches an
extractor's output against the gold standard by span, so a gold span that omits the action
penalises an extractor for quoting the right words.

The span does not have to exclude the finding. Reports often state both in one sentence, as in
"11-mm lesion in the left thyroid lobe for which recommend correlation with ultrasound", and cutting
that in two would quote the clinician less faithfully than leaving it whole. `finding_span` is set
separately whenever the report names a finding, and the two spans are allowed to overlap.

**`finding_verbatim` is not optional decoration.** Set it whenever the report names the abnormality
the recommendation is about. `from-extraction.mjs` copies it into the obligation's
`finding.text_verbatim`, `createObligation` refuses an obligation without one under R5, and it is
the first of the seven required contents of the prepared summary. A label that leaves it null while
the report names a finding produces a proposal that cannot be accepted, and the failure appears at
the point a patient presses confirm rather than during labelling.

Leave it null only when the report names no finding at all. That does happen. A negative study can
still carry a recommendation, and `CORPUS.md` section 5.5 records what the pilot found about it.

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

### 5d. Model assistance, which is advisory

The labeller works alongside a language model used as a guide. The division is fixed and it is the
point of this section: **the model advises and the labeller decides.** No label in this corpus
originated with a model, and every call, including the ones where the model disagreed, was made by
the person holding the credential.

What the model does. It is shown the report, checks the labeller's call against the section 7
precedents, and says which precedent applies or where it thinks the call is wrong. Once a decision
is made it drafts the precedent text recording it. It is a faster way to hold thirteen precedents in
mind than remembering them, and that is the whole of its function.

What it does not do. It does not choose a label, resolve an ambiguity, or break a tie. Where it
disagreed with the labeller during the pilot, the labeller settled it, sometimes by accepting the
correction and sometimes by overruling it.

Three things follow, recorded because section 5c requires that how the labels were made travels with
every metric.

**Precedent text was drafted by the model.** Six of the thirteen were, from decisions the labeller
made. Precedents shape later calls, so this is influence on the protocol even where it is not
influence on any individual label, and it should be visible rather than inferred.

**A model is not a second labeller.** It holds no PhysioNet credential, it agrees with itself twice
for the same reasons, and its agreement with the labeller is not an inter-annotator statistic and
must never be reported as one. Section 5b describes the only thing that would be, and 5b is what
answers a reader who suspects the protocol only makes sense to its authors: one credentialed person
who has not seen this work, labelling a subset independently.

**Report text reaches a hosted service.** The data use agreement forbids MIMIC data being stored or
retained by third-party language model services. The labeller holds the credential and made that
decision. It is recorded here so the decision is explicit rather than implicit.

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

The first two were written before labelling started, from the corpus survey rather than from
labelling itself, because both are frequent enough that discovering them mid-corpus would mean
relabelling what came before.

### 7.1 An interval the de-identification removed

**The text.** 7,687 reports in MIMIC-IV-Note carry a recommendation whose interval has been
replaced by a placeholder:

> "repeat Chest CT in `___` weeks to reevaluate"
> "Recommend continued imaging followup in `___` year"
> "chest CT for surveillance in `___` year"

**The decision.** Label it as a recommendation. `interval` is null. The placeholder is kept exactly
as printed in `interval_verbatim`, as `"in ___ weeks"`. Do not guess the number, do not omit the
recommendation, and do not treat the placeholder as though the report said nothing about timing.

**The reason.** The recommendation is real and a duty is owed. Only the timing is unknowable, and
section 4 already forbids inventing an interval the report does not state. This is exactly the case
that rule exists for, arrived at from the opposite direction.

**Two consequences worth knowing.**

An obligation built from one of these has no due date. That is handled: the escalation ladder holds
it at L0 and keeps reminding rather than dropping it, and it is flagged as needing a human to
establish a date. Silently ceasing to remind would be the failure this project exists to fix.

These instances are **excluded from interval accuracy** by `score.mjs`, which detects the
placeholder in `interval_verbatim` and reports the excluded count. An extractor returning null here
is right for a reason that has nothing to do with whether it can read an interval, so counting it
as a correct null measures the de-identification rather than the extractor. It is an artefact of
this corpus and would not occur in deployment.

### 7.2 A placeholder that is an age, not an interval

**The text.** `"INDICATION: ___ year old woman with COPD"`.

**The decision.** Not an interval, and usually not a recommendation at all. The INDICATION line
states why the study was done. Do not label it, and do not let the shape of `___ year` pull it into
7.1.

**The reason.** Worth writing down because a machine made this exact error first. The survey tool
that counted 7.1 cases matched `___ year` and reported better than double the true number, because
`___ year old` is a de-identified age and appears in a large share of these reports. Section 1 of
this protocol records the same lesson from the Open-i cue screen. A pattern is not a label, and the
fact that the pattern was written by the person who knew that did not help.


### 7.3 "Cannot exclude" and other hedges about interpretation

**The text.** From a portable chest radiograph:

> "Given the extensive changes described above, it would be impossible to exclude superimposed
> aspiration/pneumonia in the appropriate clinical setting."

**The decision.** Not a recommendation.

**The reason.** It qualifies the radiologist's own reading and names no test, referral or action.
"Cannot exclude", "would be difficult to exclude", "may be", "is likely due to" and "in the
appropriate clinical setting" describe diagnostic uncertainty. Uncertainty is not a duty. A named
action turns the same sentence into a recommendation, and nothing else does.

The amount of pathology is irrelevant to this call. A report can describe osteoarthritis, retained
shrapnel and surgical suture material, conclude "Degenerative changes", and recommend nothing.

### 7.4 The indication line is never a recommendation, under any header

**The text.** Four of the first six reports labelled carried one of these. The header varies:
INDICATION, REASON FOR EXAMINATION, REASON FOR EXAM, HISTORY and CLINICAL INDICATION all appear,
and all are treated the same way.

> "// Assess right HIP pain."
> "Evaluate for acute process."
> "Please reassess disease."
> "Evaluation for carotid stenosis."

**The decision.** Not a recommendation, in any of them.

**The reason.** The indication records why the study was requested, written before it was
performed. The report is the answer to it. "Evaluate for", "assess", "reassess", "rule out" and
"r/o" in that line describe the question, not a future duty, and treating them as recommendations
would create an obligation for work that has already been done.

Only text in the findings or the impression can create an obligation, and only when it names an
action.


### 7.5 Correlation with a named test

**The text.** From an MRI of the cervical spine:

> "11-mm lesion in the left thyroid lobe for which recommend correlation with ultrasound."

**The decision.** A recommendation.

**The reason.** Section 2 excludes generic boilerplate such as "clinical correlation is advised"
**unless it names a specific test or action**. "Correlation" on its own names nothing. "Correlation
with ultrasound" is an order for a scan, and section 2 already lists "Suggest correlation with
ultrasound" among the examples that count.

That the lesion is unchanged from the prior study does not withdraw the recommendation, and an
incidental finding on a study ordered for something else is the case this registry exists for.

### 7.6 The same recommendation stated twice is one instance

**The text.** The thyroid recommendation in 7.5 appeared once in the findings and again, almost
word for word, in the impression.

**The decision.** One instance, labelled from the impression.

**The reason.** Section 3 separates distinct **actions**, not distinct sentences. One ultrasound is
being asked for, so one obligation is owed. Labelling both would double-count it in recall and
create two obligations for one duty. The impression is preferred because it is the authoritative
summary and is usually self-contained enough to stand alone in the prepared summary.

**What this cost, and what was done about it.** The first extraction run scored a correct
prediction as both a miss and a false positive. The model quoted the findings copy of a
recommendation whose gold span was the impression copy, `matchBySpan` found no character overlap,
and one right answer was counted wrong twice.

An instance therefore carries `equivalent_spans`: every other place the same sentence appears. The
canonical span does not move. It still does the two jobs that need exactly one answer, which are
highlighting on the verification screen and quoting in the prepared summary. Matching consults all
of them. The duplicates are found by `label-server.mjs` when the label is saved rather than hunted
for by hand, and the loader rejects any equivalent whose text differs from the canonical one, so
this cannot become a way to make the gold standard match anything.

Two easier rules were rejected on the way here. Falling back to comparing quoted text would pair a
prediction with the wrong finding whenever a radiologist words two follow-ups the same way, and a
silently wrong match is worse than a visible miss because nothing reports it. Accepting either copy
as canonical would leave the prepared summary's wording undetermined, which is improving the
measurement by degrading the thing being measured.

One guard is not optional. Where two instances in the same report carry identical wording, each
occurrence belongs to the instance that quoted it, so an occurrence landing on another instance's
canonical span is dropped rather than claimed by both.

**This fixes exact repeats and not near ones, including the example above.** The thyroid
recommendation this precedent was written from reads "11-mm rounded lesion in the left lobe of the
thyroid" in the findings and "11-mm lesion in the left thyroid lobe" in the impression. Same duty,
reworded. The search is exact once whitespace is collapsed, so it finds nothing, and an extractor
quoting the findings copy of a reworded recommendation is still scored as a miss and a false
positive.

Loosening the search to catch rewordings is the obvious next move, and it is not being made. Any
similarity threshold loose enough to pair those two sentences is also loose enough to pair two
genuinely different recommendations in a report that discusses one finding twice, and that failure
is silent where this one is merely unfair. The honest position is that recall carries a known
downward bias of unknown size. The full stratum A draw will show how many instances are reworded
rather than repeated, and that number decides whether this is worth solving and how.

### 7.7 A future appointment or procedure counts, whoever asked for it

**The text.** From a diagnostic mammogram reported as BI-RADS 2, benign:

> "Findings reviewed with the patient. She prefers excision and was given information to schedule
> an appointment at the Breast ___."

**The decision.** A recommendation. Action `referral`, `already_scheduled` not set.

**The reason.** Section 2 asks whether **the report states** that a further test, procedure,
referral, treatment or review should happen after it. It does not ask who said so. A patient handed
information and told to book is carrying an outstanding duty whose completion depends entirely on
her doing something, which is the most loseable kind there is.

Two distinctions this precedent fixes.

**Given information to schedule is not scheduled.** `already_scheduled` is for "patient is booked
for CT next month". A patient told how to book has an open obligation, and the gap between those
two states is the one this project exists to close.

**A benign imaging assessment does not discharge a surgical duty.** BI-RADS 2 settles that no
imaging follow-up is needed. It says nothing about an excision the patient is expecting.

**A known consequence, recorded rather than resolved.** `PROMPT.md` tells the extractor to find
statements where "the clinician recommends" something, which is narrower than this precedent. The
extractor will therefore miss reports of this shape, and recall will show it. That is a real gap
and the measurement should carry it. Widening the prompt to match is a `PROMPT_VERSION` bump that
invalidates every measured number in `RESULTS.md`, so it is a decision to take deliberately after
the pilot rather than mid-corpus.

### 7.8 A notification block is never a recommendation

**The text.** Four of the fifty pilot reports end with a notification block. Two shapes appeared.
From a screening mammogram reported BI-RADS 0:

> "NOTIFICATION: The mammography department will attempt to contact the patient to arrange for
> additional evaluation; the patient will be sent a letter requesting her return and her clinician
> will be sent a copy of this report."

From a renal transplant ultrasound whose impression lists three findings and asks for nothing:

> "NOTIFICATION: The impression and recommendation above was entered by Dr. ___ on ___ at 14:23
> into the Department of Radiology critical communications system for direct communication to the
> referring provider."

**The decision.** Neither is an instance. The mammogram carries one, taken from its recommendation
line. The ultrasound is labelled as having none.

**The reason.** Section 2 asks whether the report states that something further should happen. A
notification block states how the report itself was delivered. It names no test, procedure,
referral, treatment or review beyond what the report has already said, so labelling it would count
one duty twice.

The second example is the one worth writing down. The block says "the impression and recommendation
above", and there is no recommendation above it. The sentence is template text, printed whether or
not the radiologist asked for anything. Any extractor keying on the word will fire here, and this
precedent is what makes that a false positive rather than a labeller oversight.

One consequence for `already_scheduled`. A department that "will attempt to contact the patient" has
booked nothing. Section 7.7 draws the same line for a patient handed information to schedule: an
attempt to arrange is an open obligation, and the flag stays clear.

### 7.9 A recommendation whose wording is damaged

**The text.** From the impression of a CT abdomen and pelvis:

> "A soft tissue density and filling defect is noted in the right posterior lateral bladder may
> represent a blood clot or a bladder polyp. Recommend lateral some for further evaluation."

**The decision.** A recommendation. Action `unclear`, finding `other`, modality and interval empty.

**The reason.** "Recommend lateral some for further evaluation" is a dictation error. Something was
asked for and the words naming it did not survive. The report still states that a duty exists, which
is the whole of the section 2 test, so the instance is real. What cannot be read is what the duty
is, and section 4 forbids supplying it.

`unclear` is the honest encoding, and constraint C6 requires one. A recommendation nobody can parse
is the case most likely to be quietly dropped by software, and dropping it is the failure this
project was built to prevent. An obligation recorded with action `unclear` reaches a human. A
discarded one reaches nobody.

Do not infer the missing words from the finding. A bladder filling defect is commonly worked up by
cystoscopy and commonly worked up by delayed imaging. Either could be what the sentence meant, and
choosing between them here would be a guess wearing the clothes of a label.

### 7.10 A pointer to another report is not an action

**The text.** From a CT chest, in two places:

> "Sequential scanning of the abdomen and pelvis will be reported separately."

> "For abdominal findings please refer to CT abdomen report."

**The decision.** No instance.

**The reason.** Both sentences point at a document. Neither asks for anything to be done to the
patient. "Please refer to" reads as an instruction, which is why it appears here, but the object of
the instruction is a report rather than a clinician, and reading it as a `referral` would invent a
duty the radiologist never stated.

The test that separates this from a real instance: once the pointer has been followed, is anything
still owed? Reading the companion report discharges nothing, because nothing was requested,
scheduled or deferred. Compare 7.7, where following the instruction means booking an operation.

### 7.11 Two follow-up statements against two findings are two instances

**The text.** From a portable chest radiograph, impression items 2 and 3:

> "2. Patchy right base opacity and left mid lung opacification could be due to multifocal
> infection, aspiration or malignant process not excluded. Recommend followup to resolution.
> 3. Prominence of the right mediastinum is similar compared to ___ scout image from CT, which may
> in part relate to prominent ascending aorta. Continue follow-up."

**The decision.** Two instances. "Recommend followup to resolution" against the lung opacities, and
"Continue follow-up" against the mediastinal prominence. Both action `imaging`, both finding
`other`, neither with an interval.

**The reason.** Section 3 separates distinct actions, and 7.6 settled that one action stated twice
is one instance. This is the other side of that rule. These two sentences are near-identical in
wording and attach to different findings, so two duties are owed and either can be discharged
without touching the other. Resolution of the lung opacities says nothing about the mediastinum.

Collapsing them into one instance would produce a single obligation that closes on whichever
evidence arrives first, which is rule R4 applied to the wrong object. An obligation is identified by
the finding it belongs to, not by the sentence it was written in.

The same report also states "Recommend followup to resolution" in its findings section, word for
word. That repetition is 7.6, and it is not labelled.

### 7.12 A location given for the largest of several findings is not the location of the finding

**The text.** A CT chest describing multiple small subpleural pulmonary nodules, giving a
measurement and a lobe for the largest one only, and stating that none of them requires follow-up
imaging.

**The decision.** Finding `pulmonary_nodule`, `negated` true, `anatomy` null. Not the lobe named for
the largest nodule.

**The reason.** The statement covers every nodule in both lungs. One of them has a location in the
report, and it is there to identify which nodule was measured rather than to place the group.
Section 4 allows anatomy only where the report is specific, and the report is not specific about the
set this statement is about.

This deserves more care than its size suggests, because `anatomy` is part of `identity_key`. Keying
the record to the left lower lobe would assert that the radiologist cleared a left lower lobe
nodule. What was cleared was every nodule seen. A later report raising a right upper lobe nodule
would then fail to find this evidence, and a clinician's statement would have been narrowed without
anyone deciding to narrow it.

The general form: where one finding among several is located and the recommendation covers all of
them, the recommendation has no anatomy. Locate the recommendation, not the measurement.

### 7.13 Modality names the test, anatomy names the body part, neither carries the other

**The text.** Three modality values written during the pilot: `MRI`, `MRI lumbar spine`, and
`ultrasound-guided core needle biopsy`.

**The decision.** The first stands. The other two were rewritten to `MRI` and `ultrasound`.

**The reason.** Section 4 gives `anatomy` a field of its own and says what belongs in it. Nothing
said what belongs in `modality`, so the same body part went into both fields, and there was no rule
for which one wins if they ever disagree.

`modality` is the kind of test being asked for, in the report's own words, with the body part
removed. The body part is `anatomy`. Where a procedure names the technique guiding it, the guidance
is the modality and the procedure is the `action`: a core needle biopsy performed under ultrasound
is action `procedure`, modality `ultrasound`.

Trimming loses nothing. R5 keeps the whole phrase in `recommendation_verbatim`, and that is the
string a patient is shown. These two fields exist to be matched and counted on, not to be read
aloud.

A closed vocabulary for `modality` is the obvious next step, and `corpus.mjs` already carries a
usable one in `classifyExamName`. It is not adopted here. Fixing granularity is worth doing across
eleven instances. Agreeing an enum is worth doing once the full stratum A shows which values occur.

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
| `corpus.mjs` | Surveys the source corpus and draws the sample. Survey first; see CORPUS.md section 2. |
| `label-server.mjs`, `label.html` | The labelling tool. Local only, and every save is validated by the loader above. See section 8b. |
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

**What this rule covers, and what it does not.** It governs the label file: a machine-readable
derivative of the corpus with an entry for every report in it. It does not govern the sentences
quoted in section 7. A protocol recording how judgement calls were made has to show the wording the
call turned on, and a dozen illustrative sentences in a methods document are a different artefact
from a redistributable set of 500. This is written down because a reader meeting section 7 and this
section in the same file would otherwise be right to call them inconsistent.

### 8b. The labelling tool

```
node label-server.mjs --corpus reports-A.json --out labels-A.json \n                      --corpus reports-B.json --out labels-B.json
```

Then open `http://127.0.0.1:7777`. Reports arrive in one shuffled order across every stratum given,
and which stratum a report came from is not sent to the page at all. That is section 6 step 5: a
labeller who knows a report came from the cue-enriched stratum expects to find something, and
expecting to find something is how the C1 boundary gets crossed. The shuffle is seeded, so the order
a labeller saw is reproducible rather than merely asserted, and each stratum is still written to its
own label file because section 6 forbids pooling them for scoring. Select the recommendation text and press `R`. Select the finding
and press `F`. Press `N` for a report with no recommendation, which will be most of them. Every save
writes the file and moves on, and restarting resumes where you stopped.

**Nothing leaves the machine.** The server binds to 127.0.0.1 and makes no outbound request. The
page loads no fonts, scripts or styles from anywhere. The corpus is held under a per-person data use
agreement, and a labelling tool that quietly posted a report somewhere would be a breach rather than
a bug.

**The browser validates nothing.** It collects a selection and some dropdown values and is trusted
with none of it. Every check runs on the server, through the same `loadLabelSet` that gates scoring,
so a label the scorer would reject cannot be written. The failure appears while the report is still
on screen rather than hours later against a file of five hundred.

**The span is authoritative and the quote is derived from it.** Offsets come from the browser's own
selection into the exact text the server sent, and the stored quote is then cut from that text. A
quote and an offset can never disagree, because only one of them is recorded by hand and it is not
the quote. This removes the entire class of error where a span is off by two characters, still
loads, still looks well-formed, and points at the wrong sentence.

It also refuses an interval value with no quoted words behind it, and refuses a value read from a
de-identified placeholder, per 7.1.
