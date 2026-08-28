# Smoke results

Prompt version 0.1. Ten synthetic fixtures from `fixtures/smoke.json`, run on CPU
(AMD Ryzen 5 5500U, 6 cores, 15 GB RAM) via Ollama 0.32.5.

**These are not performance metrics.** A smoke suite of ten hand-written cases cannot measure
precision or recall. It answers a narrower question: do the safety-critical failure modes behave?
Real numbers require a labelled corpus under `LABELLING.md`.

---

## Runs

| | qwen2.5:3b | qwen2.5:7b |
|---|---|---|
| Cases passed | 7/10 | 6/10 |
| **False positives on clean reports** | **1/3** | **0/3** |
| Fabricated quotes rejected | 0 | 1 (a date) |
| Mean time per report | 18.7 s | 30.6 s |

### Where each one fails

| Case | 3b | 7b |
|---|---|---|
| clean-normal | pass | pass |
| nodule-with-interval | pass | pass |
| guideline-reference-no-interval | pass | **miss** |
| finding-no-recommendation (C1) | **false positive** | pass |
| conditional | pass | pass |
| negated | **miss** | **miss** |
| multiple-recommendations | **merged** | **merged** |
| already-scheduled | pass | **miss** |
| no-date | pass | pass |
| boilerplate-only | pass | pass |

## Reading this

**The aggregate score is misleading, exactly as `LABELLING.md` section 6 warns.** 7/10 beats 6/10,
and the 6/10 model is the safer one.

The 3B is more eager. It catches edge cases the 7B drops, and it also manufactures an obligation
from a described-but-not-actioned hepatic lesion. That is the C1 boundary, and inventing an
obligation there is the failure that destroys user trust.

The 7B is more conservative. It holds the C1 line, and pays for it by missing negated follow-up,
already-scheduled follow-up, and a guideline-reference recommendation.

Neither is acceptable yet. They are not close to each other in behaviour, only in score.

## What the fabrication check caught

On the `no-date` fixture, which contains no date at all, the 7B produced one. The verbatim check
could not locate it in the source and rejected it:

```
-> REJECTED date_not_supported_by_source
```

The obligation still extracted correctly, with `date_found: null`.

This is the mechanism working as designed. Every due date derives from that field, so a silently
substituted date produces a silently wrong obligation. Instruction alone did not prevent the model
from supplying one; the check did.

Across 30 extractions, no fabricated recommendation quote reached output.

## Known defects

1. **Merged multi-action recommendations.** Both models return "Recommend PET-CT and referral to
   the respiratory MDT" as one entry. Both actions are real and both need tracking.
2. **Negated follow-up dropped.** "No further imaging is required" returns empty on both. It should
   be captured with `negated: true`, since it is evidence supporting the `not_indicated` terminal
   state, not an absence.
3. **Precision and recall trade against each other across model size**, which means model choice is
   not a tuning decision to be made on aggregate score.

---

# Real-corpus pilot

50 real radiology reports from the Indiana University chest X-ray collection (Open-i), obtained
without credentialing. Chest radiographs, overwhelmingly normal. Suitable for measuring false
positives, close to useless for measuring recall: after manual reading, **none of the 50 contains a
follow-up recommendation.**

| | qwen2.5:3b | qwen2.5:7b |
|---|---|---|
| Reports sampled | 50 | 50 |
| Reports with a real recommendation | 0 | 0 |
| **False positives** | **2 (4.0%)** | **0 (0%)** |
| Fabrication rejections | 6 | 0 |
| Mean seconds per report | 7.2 | 10.7 |

## A proxy metric that misled, and the correction

The pilot screened for "no recommendation" by absence of cue words (recommend, suggest, follow-up,
advise, consider, repeat). Three of the fifty reports matched. **All three were false cues.** Every
one used "suggest" diagnostically, not as a recommendation:

- "Mediastinal calcification and dense right upper lung nodule suggest a previous granulomatous process."
- "Appearance suggest atelectasis."
- "no focal air space opacity to suggest a pneumonia"

Consequences, both of which changed the conclusion:

1. The 7B extracting nothing from those three initially read as excessive silence. It was **correct
   behaviour**. There was nothing to extract.
2. The 3B's false-positive count was understated. Rerun on those three specifically, it produced a
   fabricated quote on one (caught by the check) and on another extracted this, at confidence 1.00:

   > "Low lung volumes are present. The heart size and pulmonary vascularity appear within normal limits."

   A pure finding statement, offered as a recommendation. Corrected rate is **2 of 50, not 1 of 47**.

The lesson generalises: a keyword screen is not a label, and in clinical text "suggest" is far more
often a hedge than a recommendation. `LABELLING.md` requires hand labels for a reason.

## What the fabrication check caught on real text

Six rejections in fifty reports for the 3B, against one in thirty on synthetic fixtures. Real
reports are messier and the model invents more against them. Every one was caught before output.

The 7B produced none.

## Model choice

**qwen2.5:7b.** Zero false positives on 50 real reports and zero fabrications, at 10.7 s/report on
six CPU cores. The 3B is faster and worse in the way that matters.

This does not settle recall, which this corpus cannot measure. The 7B's misses on the synthetic
negated and already-scheduled cases remain unresolved and need MIMIC-IV-Note, or hand-labelled
reports containing real recommendations.

## Statistical honesty

Zero errors in 50 is consistent with a true rate anywhere up to about 6%. The exact 95% upper bound
is 5.8%; the rule of three, 3/n, gives 6% and is the figure worth carrying around. Reaching an upper
bound near 1% takes roughly 300 clean reports, which is where the sizes in `CORPUS.md` come from.

This is a pilot. It rules out a badly broken extractor; it does not establish a safe one.

## Next

A second verification pass remains the candidate for the known recall defects: after extraction,
ask a narrow per-candidate question, "is an action actually recommended in this quoted text, yes or
no". It targets precision directly and would split merged multi-action recommendations.

It cannot be evaluated on this corpus, which contains no positives. It needs a corpus with real
recommendations in it, which means MIMIC or hand labelling.

Any change to prompt or model invalidates every table above.

---

# MIMIC-IV-Note stratum A pilot

50 radiology reports from MIMIC-IV-Note v2.2, drawn by seed `amanah-pilot-2026-08-19` and recorded
in `CORPUS.md` section 5.1 before the draw was taken. Hand-labelled under `LABELLING.md` protocol
v0.1 by one labeller, 11 instances across 10 reports. Prompt v0.1, qwen2.5:7b-instruct-q4_K_M,
Ollama 0.32.6, 963 s for 50 reports at 19.3 s each.

**This is the first run where recall means anything**, because it is the first corpus with real
recommendations in it. Everything before it measured false positives against reports that had
nothing to find.

| | |
|---|---|
| Reports | 50 |
| Labelled instances | 11 |
| **False positives on clean reports** | **0 of 40 (0%)** |
| Detection recall | 27.3% (3/11) |
| Detection precision | 100% (3/3) |
| Category accuracy | 66.7% (2/3) |
| Span validity, exact | 66.7% (2/3) |
| Fabrication and malformed-date rejections | 5 |
| Unparseable outputs | 0 |

Gold standard: 1 labeller, agreement between people not measured. That line prints above the table
and travels with every number in it. See `LABELLING.md` section 5c.

Span validity below 100% is reported as a defect rather than a metric, and the scorer says so. The
one failure is a quote the model reproduced across a line break, so it locates whitespace-normalised
and the stored span differs from the quoted string by a newline. It points at the right sentence.
Normalised, all three are valid.

## The result that matters, and the result that hurts

**The C1 boundary held on real clinical text.** Forty reports that recommend nothing, many of them
describing real abnormalities, and the model invented nothing from any of them. That is the failure
mode that destroys trust, and it is now clean across two corpora and ninety clean reports.

**Recall is 27.3%.** Eight of eleven duties were not found. `CORPUS.md` section 5.4 predicted, in
writing and before the run, that the prompt would cap recall near 91% and that the one structural
miss would be the breast excision in `LABELLING.md` 7.7. The prediction was right about that
instance and wrong about the ceiling being the constraint. The prompt is not what is limiting this.
The model is.

## Where the eight went

| Report | Wording | Why it was missed |
|---|---|---|
| `13738010-RR-34` | "recommend correlation with ultrasound" | Quoted a doubled sentence. Rejected as fabricated. |
| `16800796-RR-15` | "was given information to schedule an appointment" | No clinician recommends it. The 7.7 gap. |
| `12889749-RR-9` | "non of which requires followup imaging" | Negated. The smoke suite predicted this. |
| `18018980-RR-60` | "Recommend lateral some for further evaluation" | Dictation error. Carries the verb even so. |
| `10840861-RR-25` | "dedicated radiographs can be obtained" | Permission, not instruction. |
| `12286776-RR-17` | "this could be further evaluated with MRI lumbar spine" | Permission, not instruction. |
| `19303239-RR-45` | "Continue follow-up" | Second duty in the report. The first was found. |
| `13789201-RR-12` | "RECOMMENDATION: Additional imaging is needed." | A bare need, under its own header. |

A pattern runs through this, and it is sharper than expected. Split the eleven instances by whether
the labelled sentence contains the verb "recommend":

| | Instances | Returned by the model |
|---|---|---|
| Sentence contains "recommend" | 5 | 3 |
| Sentence does not | 6 | **0** |

**Every instance the model returned contains the verb.** Not one of the six without it came back:
"can be obtained", "could be further evaluated", "is needed", "Continue follow-up", "requires", "was
given information to schedule". The two verb-carrying instances it did not deliver failed for
separate reasons, and neither looks like a failure to notice. On `13738010-RR-34` it quoted a
sentence duplicated back to back and the fabrication check rejected the quote. On `18018980-RR-60`
the sentence is itself a dictation error.

On this evidence the extractor behaves closer to a keyword trigger than to a reader. The Open-i
pilot above concluded that a keyword screen is not a label, after a cue-word screen misread three
reports and the author had to correct a published count. The model has now arrived at the same
shortcut from the other direction. It is worth noticing that the mistake was attractive enough to
catch both.

The last row of the table is where it costs most. An explicit `RECOMMENDATION:` header, an
unambiguous sentence, and a BI-RADS 0 assessment that means incomplete by definition. The sentence
says "is needed" rather than "is recommended", and that appears to have been the whole difference.

## What the fabrication check cost, visibly

Five rejections. Four were attempts to read a date out of a `___` de-identification placeholder,
which is `LABELLING.md` 7.1's problem arriving from the extraction side rather than the labelling
side. The fifth was on `13738010-RR-34`, a report that does contain a real recommendation.

That fifth one deserves care, because it is easy to describe too generously. The model returned a
recommendation entry whose quote was the sentence **after** the recommendation, printed twice back
to back. It is not knowable from the output whether the model had located the duty and quoted the
wrong line, or had not located it at all. What is knowable is that the string it offered does not
appear in the report, so the check refused it and the instance was lost.

That is the mechanism working. Recording a sentence the report does not contain would put invented
words in front of a patient under the heading of what their report said. Losing a true positive is
the correct trade against that, and this is the first run where the trade shows up as a number
instead of an argument.

## What this run cannot tell you

**Interval accuracy has no denominator.** Not one of the eleven instances stated a time, so two of
the six metrics in section 6 returned nothing. `already_scheduled` was never exercised either. No
amount of model improvement changes this. It needs a corpus with intervals in it, and `CORPUS.md`
section 5.3 records why that may be harder than expected.

**The false-positive bound is looser here than in the Open-i pilot**, because 40 clean reports gives
a rule-of-three bound of 7.5% against 6.0% for 50. Two independent zeroes are more reassuring than
either alone, and neither establishes a safe extractor.

**Recall carries a known downward bias of unknown size.** Where a report states a recommendation
twice in different words, an extractor quoting the copy the labeller did not choose scores as a
miss. `LABELLING.md` 7.6 explains why the fix covers exact repeats and stops there.

## What this changes about the plan

The second verification pass proposed above targets precision and merged multi-action
recommendations. **Precision is already 100% and nothing merged.** The problem is not that this
extractor says too much. It is that it says almost nothing, and a pass that asks "is an action
really recommended here" can only remove output that already exists.

So that proposal is not the next thing to build. The next thing is to find out whether the recall
failure is the prompt's phrasing or the model's capacity, and those are separable: reword the
prompt's examples to include permissions and bare needs, hold the model fixed, and rerun. That is a
`PROMPT_VERSION` bump which invalidates the tables above, which is exactly why it waits until the
question is worth asking properly.

Any change to prompt or model invalidates every table in this section too.

---

# Prompt v0.2, and what it ruled out

The rerun the section above asked for. Same fifty reports, same labels, same model, prompt v0.2.
Acceptance rule fixed before the run and recorded in `PROMPT.md`: zero false positives on the forty
clean reports, or the prompt is rejected whatever recall does.

| | v0.1 | v0.2 |
|---|---|---|
| False positives on clean reports | 0 of 40 | 0 of 40 |
| Detection recall | 27.3% (3/11) | 27.3% (3/11) |
| Detection precision | 100% | 100% |
| Verbatim-check rejections | 5 | 2 |

**Nothing changed.** Not only the same counts. The same three instances, with character-identical
quotes. All six instances whose sentence lacks the verb "recommend" were missed again.

## The case that ended the line of enquiry

v0.2 carries this among its include examples, character for character:

> "Additional imaging is needed."

Report `13789201-RR-12` contains that exact sentence, under its own `RECOMMENDATION:` header, in a
study assessed BI-RADS 0, which means incomplete by definition. The model returned an empty array
and set `no_recommendation_found` to true.

The sentence was in the prompt. The identical sentence was in the report. It was still missed. On
this evidence the constraint is not how the task is worded, and further prompt iteration would be
fitting noise to fifty reports that are now a development set.

## What v0.2 was still worth adopting for

It is kept, and not because it helped. v0.1 asked for statements "where the clinician recommends"
something, which excludes the `LABELLING.md` 7.7 shape by construction: a patient handed information
to schedule an appointment is owed something, and no clinician recommended it. No model could have
extracted that under v0.1. The prompt was wrong about the task, and a null result does not make it
right.

## The number that looks the same and is not

**v0.2's zero false positives is weaker evidence than v0.1's, despite being the same figure.**

v0.1 was written before this corpus existed, so its 0 of 40 was out-of-sample. v0.2's five new
exclusions were written after reading those same forty reports: the indication line, the
interpretive hedges, the technique caveats, the notification blocks and the companion-report
pointers all came from them. Its 0 of 40 is in-sample and partly circular.

The safety evidence resets with the version. Until the held-out stratum A draw tests it, v0.2's
clean-report result should not be quoted with the confidence v0.1's carried, and the two zeroes in
the table above should not be read as equally strong.

## What this leaves

The failure looks like search rather than judgement. Given "Recommend X" the model handles it
correctly every time, including a garbled variant it declined to guess at. It does not appear to be
scanning a thousand-character report for the other shapes.

If that reading is right, the fix is architectural and not textual: ask the question one sentence at
a time rather than asking the model to find the sentences. That removes the search and leaves the
judgement, which is the half already working. It costs more inference per report, which is the cheap
resource for a local model on CPU.

That is a change to how extraction is structured rather than to what it is told, so it needs its own
design and its own measurement. It is not started, and it should be measured on held-out reports
rather than on these.

---

# Per-sentence detection, and the trade it makes

The architectural test the section above asked for. Same fifty reports, same labels, same model.
Instead of one call per report, the report is split into sentences and each is asked one question:
does this sentence leave something still to be done? One call per sentence, so there is nothing to
scan and search cannot be the failure.

**Every figure here is a development-set figure.** These fifty reports were spent as development
data by prompt v0.2, and this section spends them further: the section filter below was designed
after reading which sentences came back wrong. Nothing here is a held-out result and none of it
belongs in a claim about performance.

| | FP on clean reports | Recall | Precision |
|---|---|---|---|
| Whole report, prompt v0.1 | 0 of 40 | 27.3% | 100% |
| Whole report, prompt v0.2 | 0 of 40 | 27.3% | 100% |
| Per sentence | 6 of 40 | 90.9% | 38.5% |
| Per sentence, plus section filter | 1 of 40 | 90.9% | 52.6% |

## The diagnosis was right

Recall goes from 27.3% to 90.9% without touching the model. The sentence prompt v0.2 contained
verbatim and still could not find, `RECOMMENDATION: Additional imaging is needed.`, is returned
correctly the moment it is asked about on its own.

So the failure was search and not judgement. Given a sentence, this model decides well. Given a
thousand-character report, it does not reliably find the sentence.

## The acceptance rule rejects it anyway

The rule was fixed before the v0.2 run and it is not renegotiated because a better number appeared:
zero false positives on the clean reports, or the extractor is rejected whatever recall does. This
scores 1 of 40. It is rejected as a shippable extractor.

What the rule cannot decide is whether the trade is worth making, because that is a product question
rather than a measurement. Recall more than triples. The cost is one report in forty gaining an
obligation nobody asked for, and the remaining error is not the kind the rule was written to stop.
It is not a fabricated quote. It is a real line of the report read too generously:

> "CT-GUIDED BIOPSY OF THE RIGHT TIBIA"

The exam title of a procedure report. In isolation it names a procedure, and the sentence carries
nothing to say the procedure already happened. A whole-report reader has the tense; a single
sentence does not.

## The section filter is precedent, not tuning

Seven of the twelve spurious detections sat under `INDICATION`, `HISTORY`, `CLINICAL HISTORY` or
`NOTIFICATION`. Every one is a request that this report already answered, or a note about how the
report was delivered, and `LABELLING.md` 7.4 and 7.8 already say neither can hold a recommendation.

Suppressing those sections deterministically removed seven false positives and cost no recall at
all. No true positive in the pilot came from any of them: they arrive under `IMPRESSION`,
`RECOMMENDATION` and `RECOMMENDATION(S)`. Writing an existing precedent as code rather than as an
instruction the model may ignore is the standing preference in this project for deterministic over
heuristic, and this is a clean case of it.

**The last false positive was left alone deliberately.** A rule that suppresses headerless preamble
would remove it, and would be justified by exactly one report. Tuning a filter per remaining error
on a development set is how a number stops surviving contact with held-out data.

## What the pre-registration got right and wrong

`CORPUS.md` 5.4 predicted a recall ceiling near 91% and named the instance that would be missed: the
7.7 breast excision, where a patient is handed information to schedule and no clinician recommends
anything.

The ceiling was right, to within one instance out of eleven. The named report was wrong. The breast
excision was found. What was missed is the negated pulmonary nodules in `12889749-RR-9`, where a
long sentence describes several nodules and ends by saying none of them requires follow-up imaging.

That miss is consistent with the smoke suite at the top of this file, which recorded the 7B failing
the negated case on a synthetic fixture months earlier. The prediction was wrong about which report
and the evidence for the correct answer was already written down.

## What is left, and what it costs

Nine of the nineteen surviving predictions do not match gold. They fall into three groups.

**Restatements of a duty that is real.** The `BI-RADS: 0 Incomplete` line of a report whose
recommendation was already found. The same duty, said again in the structured assessment.

**Reworded repeats.** `13738010-RR-34` states its thyroid recommendation once in the findings and
again in the impression, in different words. The equivalent-span mechanism added for 7.6 covers
exact repeats and deliberately stops there, so the findings copy scores as a miss. This is the known
downward bias on recall already recorded above, appearing from the other direction.

**Genuine over-reads.** Hedges taken as requests, and one instance of "clinical correlation with
patient's symptoms is recommended", which the prompt excludes by name as boilerplate with no test
named.

Only the third group is a defect. The first two are scoring artefacts of decisions taken for good
reasons elsewhere.

## The pass that was set aside becomes the right one

The section above proposed a second verification pass and then rejected it, on the grounds that it
could only remove output and precision was already 100%. That reasoning was correct for that
extractor.

It has now inverted. Detection recall is 90.9% and precision is 52.6%, so the problem is no longer
that the extractor says too little. A pass that asks, of each candidate sentence with the whole
report in view, whether the duty is real and still outstanding is now the obvious next thing, and
the tense information the single-sentence view loses is exactly what it would restore.

It is not built. Stage two, which fills the fields rather than detecting the sentence, is not built
either. Neither should be measured on these fifty reports.

---

# Two stages: detect per sentence, then verify against the report

detect.mjs finds candidate sentences one at a time. verify.mjs checks each against the whole report.
Between them, deduplication by LABELLING.md 7.6, which needs no model.

**Development-set figures.** These fifty reports were spent by prompt v0.2, spent again by the
section filter, and spent again here: the verification prompt was written after listing what the
pilot's true positives looked like, and a defect in it was found and fixed by debugging against
these reports. Nothing in this section is a held-out result and none of it belongs in a claim about
performance. Stratum A positions 106 to 350 exist to test it.

| | Whole report v0.2 | Detect only | Detect, dedupe, verify |
|---|---|---|---|
| False positives on clean reports | 0 of 40 | 1 of 40 | **0 of 40** |
| Detection recall | 27.3% | 90.9% | **90.9%** |
| Detection precision | 100% | 52.6% | **90.9%** |

The acceptance rule is met at more than three times the recall.

## What was predicted before the run, and what happened

The prediction was written first, as with CORPUS.md 5.4, and named which candidates should die.

Right: dedup would remove exactly one, the identical repeat. Verification would remove the exam
title, the three hedges and the boilerplate. The BI-RADS restatement would survive as a false
positive, because a per-candidate check cannot see that a duty has already been counted.

Wrong: verification also removed two candidates from the report whose duty matters most in the
whole corpus, and that is worth more than the numbers.

## The defect the numbers hid

The first verified run scored 0 of 40 and 81.8% recall, which passes the rule. It reached that
partly by deleting `19376441-RR-36`: BI-RADS 5, highly suggestive of malignancy, tissue diagnosis
recommended. The most serious obligation in the pilot.

The first explanation was that the report's notification block, which records that findings and
recommendations were reviewed with the patient, read as evidence the duty had been discharged. That
explanation was tested by removing the block and asking again. It was wrong: the candidate was kept
either way.

The real cause, reproducible:

| Candidate sent to the verifier | Verdict |
|---|---|
| `RECOMMENDATION(S):  Tissue diagnosis is recommended.` | remove |
| `Tissue diagnosis is recommended.` | keep |

A section heading and its first sentence usually share a line, so the segment for that sentence
began with the heading, and the heading travelled into the model as part of the sentence being
judged. `spanAfterHeading` in sentences.mjs strips it, before either stage sees anything, so the
sentence asked about and the sentence stored are the same string.

Two things about this are worth keeping.

**It was invisible in the metrics.** 81.8% recall and zero false positives reads like a pass. The
report it lost was the one where a missed obligation does the most harm, and no aggregate figure
was ever going to say so. Reading which instances died, rather than how many, is what found it.

**It was also a patient-facing bug.** The stored quote carried `RECOMMENDATION(S):` into
`recommendation_verbatim`, which is the string the prepared summary shows a patient under "what my
report says". It would have shipped as a formatting oddity long before anyone traced it to a
deleted obligation.

## What survives, and what it costs

Ten of eleven labelled instances are found. Both conditionals in the impression and the third in
the findings survive, as does the 7.7 case where a patient is handed information to schedule an
appointment. Those were the four the verification prompt was rewritten to protect, after listing
every true positive and asking what a whole-report check would do to each. Without that step the
pass would have removed all four.

One false positive remains. `13789201-RR-12` states its recommendation twice, once under a
RECOMMENDATION heading and once as `BI-RADS: 0 Incomplete - Need Additional Imaging Evaluation`.
Both are real and both name the same duty. Deduplication does not catch it because the wordings
differ, which is the same boundary equivalent spans draw in labels.mjs, and for the same reason: two
differently worded sentences may be two duties, and deciding they are not is a judgement rather than
a string comparison.

One instance is still missed: the negated pulmonary nodules in `12889749-RR-9`, where a long
sentence describes several nodules and ends by saying none requires follow-up. The smoke suite at
the top of this file recorded the 7B failing negation on a synthetic fixture, and it has now failed
it on real text in three separate architectures.

## What this does not settle

Field extraction does not exist. Both stages answer yes or no, so finding and action are
placeholders and those columns mean nothing here.

Interval accuracy still has no denominator, because no instance in this corpus states an interval.
Two of the six metrics in LABELLING.md section 6 have never been measured on anything.

And the number that matters has not been measured at all. Everything above describes fifty reports
that this pipeline was built and debugged against. What it does on reports it has never seen is the
open question, and answering it needs the held-out labels that do not exist yet.

---

# Stage three: filling the fields

detect, verify and dedupe answer yes or no. fields.mjs describes what was found: category, action,
anatomy, modality, interval and the flags. The model is told the sentence is a recommendation and
asked only to describe it, which is a smaller question than extract.mjs asks. Every quoted string
goes through the same `validateRecommendation` the whole-report extractor uses, so a quote that
cannot be located in the source is treated as invented.

Development-set figures, on the same fifty reports as everything above.

| | Placeholders | Stage three |
|---|---|---|
| False positives on clean reports | 0 of 40 | 0 of 40 |
| Detection recall | 90.9% | 90.9% |
| Detection precision | 90.9% | 90.9% |
| Category accuracy | 80.0% | 80.0% |
| **Action accuracy** | not measured | **60.0%** |
| Conditional flag agreement | 7 of 10 | 9 of 10 |
| Quotes rejected as invented | n/a | 0 of 11 |

## The category number is the same and means something different

Before this stage, `finding` was hard-coded to `other` and `action` to `unclear`. Category accuracy
read 80% because eight of ten gold instances are `other`, so a constant scored well by accident.
It now reads 80% because the model reads the reports: `thyroid_nodule` and `mammography_recall` are
both identified correctly, and six of the eight `other` cases are correctly declined.

Same figure, different fact. It is worth saying because a metric that does not move when a
placeholder is replaced by real work is a metric to distrust, not a result to report.

## Action was never measured, and it is the weaker number

`score.mjs` computed category accuracy and not action accuracy, for no reason anyone recorded.
Action is what an obligation is routed on and what a patient is asked to arrange, so it matters more
than the category does. It is now measured, and it is 60%.

Four of the ten are wrong, and one of those is the failure this project cares about most.

**A guessed action on a recommendation nobody can read.** `18018980-RR-60` contains a dictation
error: "Recommend lateral some for further evaluation". `LABELLING.md` 7.9 records the label as
action `unclear`, because something is being asked for and the words naming it did not survive. The
model returned `imaging`.

Nothing in the report says imaging. The model supplied the most likely action for a bladder filling
defect from its own knowledge, which is exactly what rule 3 of the prompt forbids for intervals and
what constraint C6 forbids generally. The verbatim check cannot catch it, because no quote was
fabricated. Only the field was.

That is a new class of failure for this project. Every mechanical check built so far catches
invented **text**. This is an invented **judgement**, sitting behind a quote that is entirely
genuine.

The other three are ordinary errors: a correlation with ultrasound called `procedure` rather than
`imaging`, and two follow-up requests called `referral` rather than `imaging`.

## Anatomy cannot be scored at all, and that is the most serious finding

The gold standard writes anatomy as a dotted path: `thyroid.left`, `breast.right`,
`spine.lumbar.l5_s1`. The model returns prose: `left lobe of the thyroid`, `left breast`,
`lumbar spine`. Every one of those pairs describes the same place and not one of them would ever
compare equal.

`score.mjs` does not measure anatomy, so this was invisible until the fields were read by hand.

It matters far beyond a metric. `anatomy` is part of `identity_key`, which is how an obligation is
recognised as being about the same finding across serial studies. Section 6 of the specification
calls the failure to resolve that identity the most dangerous silent failure available. With a free
text anatomy field, identity resolution does not work at all: the same thyroid nodule reported twice
produces two obligations, and neither closes the other.

There is a second problem in the same column. On `18373059-RR-30` the gold anatomy is null, because
the recommendation asks for "further evaluation with MRI" and names no body part. The model returned
`head`. It is a reasonable inference from a head CT and it is still an invented location, which
rule 6 of the prompt forbids by name.

**A controlled vocabulary for anatomy is now a prerequisite rather than a refinement.** It needs to
be decided, applied to the labels already written, and enforced in the schema the way
`FINDING_CATEGORIES` and `ACTIONS` already are. Until then anatomy is unmeasured, unusable for
identity, and free to be guessed.

## What stage three does not settle

Intervals remain unmeasurable: no instance in this corpus states one.

No obligation can be built from any of this. Every date in MIMIC is de-identified, so
`acceptProposal` refuses every proposal for want of a document date. `CORPUS.md` section 8 records
the check: from the hand labels, which are better input than this pipeline will ever produce, zero
obligations are created.

And all of it is measured on fifty reports the pipeline was debugged against.

---

# Closing the anatomy vocabulary, and what it exposed

`identity_key` is `sha256(subject_ref | category | anatomy | laterality)`. Two spellings of one
place produce two obligations for one finding and neither closes the other, which section 6 of the
specification calls the most dangerous silent failure available.

Two things were producing exactly that.

**`laterality` was dead plumbing.** It is in `SCHEMA.json`, in `identityKey`, in
`from-extraction.mjs` and in the obligation object. It was never populated anywhere:
`extract.mjs` hard-coded it to null, and the labelling tool had no control for it.

**Side was travelling inside `anatomy`, in two formats.** The specification's own example says
`lung.right.upper_lobe`. The gold standard said `thyroid.left`. So `thyroid.left` with a null
laterality, and `thyroid` with laterality `left`, hash differently while describing one nodule.

Both are now closed lists in `extract.mjs` beside `FINDING_CATEGORIES`, the loader rejects anything
outside them, the six gold values were migrated by hand-written mapping, and `score.mjs` measures
anatomy and laterality together as one claim, because half a location is not half an identity.

## The measurement it made possible says the extraction does not work

| | Free text | Closed vocabulary |
|---|---|---|
| Location accuracy | 40% | **30%** |

Closing the vocabulary made the number worse, and the reason is worth more than the number.

The old 40% was mostly two nulls agreeing. Where the report named a place, the model wrote
"left lobe of the thyroid" against a gold `thyroid.left` and the mismatch looked like a formatting
problem. It was hiding a judgement problem.

With a menu to choose from, the model started choosing. Three of the seven errors are inventions
where the gold standard says nothing:

| Report | Gold | Predicted |
|---|---|---|
| `18373059-RR-30` | none | `brain` / `bilateral` |
| `10840861-RR-25` | none | `rib` |
| `18018980-RR-60` | `bladder`, no side | `bladder` / `right` |

Every one is a reasonable inference and every one is the guess rule 6 forbids by name. The first is
inferred from the study being a head CT. The third invents a side for a bladder lesion the report
describes without one.

The other four errors run the opposite way: the report is specific, `breast` twice and
`spine_lumbar` once, and the model returned nothing.

So it over-fills where the report is silent and under-fills where the report is specific. On this
sample that is close to unrelated to what the report says, and **location cannot currently be used
for identity resolution at all.**

## Why the vocabulary was still the right change

It did not fix the problem. It made the problem visible and it is a precondition for fixing it.
Under free text there was no measurement, because no two strings agreed; the gold standard itself
carried a format the specification contradicted; and nothing stopped the next labeller inventing a
third spelling.

That closing a vocabulary made a metric worse is not an argument against closing it. The 40% was
never a description of anything.

## What follows

Identity resolution must not be wired to model-extracted anatomy on these numbers. Resolution rule 3
already refuses to merge on absent or coarse anatomy and flags it for a person, which is the correct
behaviour and is now the behaviour almost every obligation would get.

The guessing has the same shape as the invented action in the section above: a field filled from
knowledge of medicine rather than from the report, behind a quote that is entirely genuine. Two
instances of one failure mode is enough to treat it as a class rather than a pair of bugs, and
nothing in the pipeline currently detects it. The verbatim check cannot: no quote was fabricated.

An anatomy the report does not state is exactly as dangerous as an interval the report does not
state, and R6 and rule 3 of the prompt already forbid the second by name. The asymmetry is an
accident of which field happened to be noticed first.

## Correction: the gold standard was wrong, not the model

The section above reports three invented locations and draws a conclusion from them. Checked against
the report text, rather than against the gold standard, two of the three were correct extractions
scored against a wrong label.

| Report | Gold said | Model said | The report says |
|---|---|---|---|
| `18018980-RR-60` | `bladder`, no side | `bladder` / `right` | "the right posterior lateral bladder" |
| `10840861-RR-25` | no location | `rib` | "continued concern for rib fracture" |
| `18373059-RR-30` | no location | `brain` / `bilateral` | a head CT asking for MRI, no side anywhere |

Only the third is an invention, and only half of it. `bilateral` is unsupported. `brain` is
defensible for an MRI requested to look for infarct, and the gold standard's null is at best
arguable.

## Why the gold was wrong, which is the more useful finding

Location was never really labelled. It was one free-text field filled in passing, and laterality had
no field at all, so side was captured only when a labeller happened to write it into the anatomy
string. Six of eleven instances carry a location the report states and the gold does not:

| Report | Gold | Report states |
|---|---|---|
| `12889749-RR-9` | none | subpleural pulmonary nodules, so `lung` at organ level |
| `18018980-RR-60` | `bladder`, no side | "right posterior lateral bladder" |
| `10840861-RR-25` | none | "rib fracture", with no side anywhere |
| `12286776-RR-17` | `spine_lumbar`, no side | "right eccentric disc bulge", "right S1 nerve root" |
| `19303239-RR-45` | none | "right base opacity and left mid lung opacification", so `lung` bilateral |
| `19303239-RR-45` | none | "Prominence of the right mediastinum" |

So the 30% is not a measurement of the extractor. It is a measurement of a gold standard that was
never made carefully for this field, against an extractor doing better than the number says. The
corrected figure is unknown until those six are relabelled, which is a labelling decision and not
one to take while writing up a result.

**The finding stands with its subject changed.** Closing the vocabulary did expose a real problem,
and the problem was in the labels rather than the model. That is worth more than the conclusion it
replaces: a free-text field nobody could score is a field nobody was checking, and it reached a
committed gold standard and a published metric while empty.

One part of the original section survives intact. `12889749-RR-9` is 7.12, where a lobe is named for
the largest of several nodules and the gold correctly refuses to attach it to the group. At organ
level that reasoning does not apply, because `lung` describes every nodule in the set. The precedent
was written against a finer vocabulary than the one now in use, and needs revisiting on those
grounds rather than because it was wrong.

## Location, measured against a corrected gold standard

The six locations the gold standard was missing are now labelled, read from the words in each
instance's own finding span. With those in place and the vocabulary closed, location can be scored
for the first time.

```
detection recall     90.9%   (10/11)
category accuracy    80.0%   (8/10)
action accuracy      60.0%   (6/10)
location accuracy    40.0%   (4/10)
```

Location is the weakest field, and it fails in the opposite direction to the one the earlier draft
of this section claimed. Five of the six errors are the model returning nothing where the report
states a location. Only one is an over-reach: `brain` on a head CT whose recommendation names no
body part.

## An attempted fix that made it worse, and was reverted

The obvious cause was an instruction in `fields.mjs` telling the model that anatomy is "none" when
the recommendation names no body part. Locations live in the finding, not the recommendation:
"Additional imaging is needed" names nothing, while the finding above it says "Right breast focal
asymmetry". The prompt pointed at the wrong sentence.

Rewriting it to read the location from the finding was tried and is not kept.

| | Before | After |
|---|---|---|
| Detection recall | 90.9% | 81.8% |
| Location accuracy | 40.0% | 33.3% |

One instance improved, one regressed from correct to nothing, and one was lost entirely when the
model invented a finding quote that the verbatim check refused. Net worse on every column.

The reverted wording is arguably the more accurate description of where a location comes from. It
also measured worse, on the only evidence available, so it is not adopted. With ten instances
neither version is well evidenced, and that is the point: this was a second prompt edit chasing a
number on a development set, which the section above this one explicitly warns against. It should
not have been attempted, and it is recorded because a reverted change with a measurement attached is
more useful to the next person than a quiet deletion.

## What the number means

40% location accuracy is not usable. `anatomy` and `laterality` are two of the four components of
`identity_key`, so a location that is wrong or absent six times in ten means serial studies of the
same finding will not resolve to one obligation. Section 6 of the specification calls that failure
the most dangerous silent one available, and this measurement says the system currently has it.

What it does not say is why. The corpus is ten instances, the labels were corrected once already,
and one prompt attempt has produced noise rather than a direction. Both a real cause and a real fix
need the held-out set rather than more iteration on these fifty reports.
