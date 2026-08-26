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
