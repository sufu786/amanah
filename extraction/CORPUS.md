# Corpus sampling plan v0.1 (draft)

**Status:** draft. Section 2 verified against the real corpus on 2026-08-15. Both decisions in
section 9 are settled, and the frame is decided in section 4. The sizes in section 5 still depend
on the base-rate pilot, which has not been run.
**Written:** 2026-08-03, while PhysioNet credentialing is under review.

This plan is written before access is granted, for the same reason `LABELLING.md` was written
before any model ran. A sampling frame chosen after seeing which reports produce good numbers is
not a sampling frame.

It answers one question: what has to be labelled, and in what proportions, for the metrics in
`LABELLING.md` section 6 to mean anything.

---

## 1. What the Open-i pilot established, and what it cost

The 50-report pilot in `RESULTS.md` returned zero false positives and no measurable recall, because
after manual reading **none of the 50 reports contained a follow-up recommendation**. Two lessons
carry directly into this plan.

1. **A corpus can be useless for recall while looking like a corpus.** Chest radiographs are
   overwhelmingly normal, and normal reports recommend nothing. Composition has to be designed, not
   assumed.
2. **A keyword screen is not a label.** All three reports flagged by the cue screen were false cues:
   "suggest" used diagnostically ("appearance suggest atelectasis"), not as a recommendation. Any
   screen used below is a sampling device only, and never a label, a denominator, or a filter on
   what gets read.

## 2. Source

**MIMIC-IV-Note**, radiology reports. Credentialed access via PhysioNet, CITI training complete,
DUA required.

It is chosen for the one property Open-i lacked: reports that contain real follow-up
recommendations, written by clinicians in ordinary practice rather than curated for teaching.

**Verified 2026-08-15**, against MIMIC-IV-Note v2.2, by `node corpus.mjs survey`. The three
questions this section asked in advance are answered below. They were asked before access and
answered after, which is the order that keeps the frame honest.

**2,321,355 reports, 237,427 patients, median length 782 characters.**

**Modality mix.** Cross-sectional imaging is 39.7% of the corpus, roughly 740,000 reports.

| | share |
|---|---|
| Radiograph | 47.7% |
| CT | 20.9% |
| Ultrasound | 11.6% |
| MR | 7.2% |
| Interventional | 5.7% |
| Mammography | 3.6% |
| de-identified exam name | 1.5% |
| Fluoroscopy | 1.0% |
| unclassified | 0.6% |
| Bone densitometry | 0.1% |

Volume is not the constraint this section feared. There is no shortage of cross-sectional imaging,
so the frame does not need restricting for that reason. See section 4 for why it is not restricted
for any other reason either.

**Addenda and duplicates.** 25,735 notes are an addendum to another report, matching the 25,720
carrying `note_type` AR. `radiology_detail` records the relationship directly as
`addendum_note_id` and `parent_note_id`, so it does not have to be inferred. The draw excludes
addenda outright. 78.1% of patients have more than one report, so one-report-per-patient discards a
great deal, leaving 237,427 candidates against the 500 needed.

**De-identification placeholders.** 90.4% of reports contain `___` somewhere, and 3.3% have one in
a sentence containing a cue word. The case that matters is narrower: **7,687 reports, 0.3%, carry a
recommendation whose interval was replaced by a placeholder**, as in "repeat Chest CT in `___`
weeks to reevaluate". That is frequent enough to need deciding before labelling rather than during,
and it is now `LABELLING.md` section 7.1. Those instances are excluded from interval accuracy,
since an extractor returning null there is right for a reason that has nothing to do with reading
an interval.

A caution recorded with the answer: the first version of this count was better than double the
truth, because it matched `___ year` and swept up "`___` year old" from the INDICATION line. That
is section 1 of `LABELLING.md` repeating itself, in the tool written to apply it.

## 3. The publication problem, and why the harness already handles it

`LABELLING.md` says labels are published alongside the metrics, so the judgement calls can be
checked rather than taken on trust. The MIMIC DUA prohibits redistributing the report text. These
are in direct conflict for `reports.json`, which contains the text.

The split that satisfies both:

| Artefact | Published | Why |
|---|---|---|
| `reports.json` | **No** | Contains MIMIC text. DUA. |
| Label sets, gold standard | **Yes** | Verbatim quotes are the obstacle here; see below. |
| `text_sha256` per report, and MIMIC row identifiers | **Yes** | Lets a credentialed party rebuild the exact corpus and prove it is the same one. |
| Metrics, and the scoring output | **Yes** | The point of the exercise. |

The `text_sha256` binding in `LABELS.schema.json` was built to catch corpus drift. It also does this
job: a credentialed reader reconstructs `reports.json` from the identifiers, and the loader refuses
the labels if the text is not character-identical to what was labelled. Reproducibility without
redistribution.

**Handled.** Label files carry `recommendation_verbatim`, which is MIMIC text. Short quotations from
a de-identified corpus are probably not redistribution of the corpus, but *probably* is not the
standard to apply to a data use agreement, and the question was not worth guessing at.

So it is not guessed at. `redact.mjs` strips the quoted strings and publishes spans, and the loader
derives every quote from the reader's own rebuilt corpus. Checkability is preserved for exactly the
people who could act on it, since judging a labelling call needs the surrounding report and only a
credentialed reader has that. Ask PhysioNet anyway, because a permissive answer means publishing
the fuller file, but nothing waits on the reply.

## 4. Two strata, because one sample cannot serve both metrics

The false-positive rate must come from an unbiased sample. Recall needs positives, which an unbiased
sample of radiology reports supplies too slowly. Trying to satisfy both from one draw is what
produced a corpus with no positives in it.

**Stratum A, random.** A uniform random draw from the frame, unscreened, unfiltered. This is the
only stratum that may be used for the false-positive rate and for the base rate.

**Decided 2026-08-15: the frame is not restricted by modality.** Before the survey, the plan was to
narrow it if cross-sectional imaging turned out to be thin, on the grounds that recommendations
concentrate there and plain film is where Open-i failed. The survey shows it is not thin, so the
volume argument does not apply. The argument against restricting is stronger than the argument for.

Stratum A exists to produce the false-positive rate, and false positives on ordinary normal reports
are what destroys the trust of the people using the system. Radiographs are 47.7% of what arrives
and are overwhelmingly clean, which makes them the best material for that measurement rather than
the worst. Excluding them would produce a false-positive rate for a population no deployment sees,
and would quietly convert an honest number into a flattering one.

Stratum B exists precisely so that A never has to be bent toward positives. Bending A anyway would
give up the one unbiased estimate in the design to solve a problem B already solves.

**Stratum B, cue-enriched.** Drawn at random from reports matching a deliberately over-inclusive cue
list (recommend, suggest, follow-up, follow up, advise, consider, repeat, correlate, referral,
further evaluation, as per, surveillance, re-image, reassess). The list is tuned for recall, not
precision, and every drawn report is hand-labelled in full regardless of why it matched. Its only
purpose is to raise the density of positives so recall can be estimated at all.

**What each stratum may be used for.** This is the part that must not slip.

| Metric | A | B |
|---|---|---|
| False-positive rate on clean reports | Yes | **No** |
| Detection precision | Yes | **No** |
| Base rate of recommendations | Yes | **No** |
| Detection recall | Yes, imprecise | Yes, conditional on the cue list |
| Interval / category accuracy | Yes | Yes |
| Span validity | Yes | Yes |

A precision figure computed over B is a precision figure over text pre-selected for containing
recommendation-shaped words. It would be higher than the truth and unfalsifiable from the output.
`score.mjs` takes one corpus at a time, so run it per stratum and report per stratum. Do not
concatenate them into a single corpus file.

Recall will therefore be reported twice: from A alone (unbiased, wide interval) and from A and B
together (narrow, and conditional on the cue list, which cannot find a recommendation phrased in
words nobody thought of). Both figures, always, with that sentence attached.

## 5. Sizes, and the arithmetic behind them

**Pilot first: 50 reports from stratum A, labelled, before any of the sizes below are committed.**
Its only job is to estimate the base rate of follow-up recommendations in this frame. Every number
that follows is sensitive to it, and it was unknown for MIMIC radiology when this was written.
Section 5.2 records what the pilot found. If the pilot shows
a base rate high enough, stratum B may not be needed at all.

### 5.1 The pilot draw, recorded before it was taken

```
seed        amanah-pilot-2026-08-19
stratum     A only, 50 reports
frame       one report per patient, addenda excluded, minimum 200 characters,
            no modality restriction (see section 4)
source      MIMIC-IV-Note v2.2 radiology.csv.gz
command     node corpus.mjs draw --in radiology.csv.gz --detail radiology_detail.csv.gz \
                                 --seed amanah-pilot-2026-08-19 --a 50 --b 0
```

This block is committed **before** the draw is run, and the commit order is checkable in the
history rather than asserted here. That is the whole point of writing it down. A seed chosen after
seeing a sample, or changed because the first sample looked unhelpful, is not a seed, and there is
otherwise no way for a reader to tell the difference.

The draw is reproducible from this block alone by anyone holding the same source file, and
`corpus.mjs` refuses to run without a seed for the same reason.

Targets, assuming the pilot does not overturn them:

| | n | What it buys |
|---|---|---|
| Stratum A | 350 | Roughly 300 clean reports after positives are removed. Zero false positives in 300 bounds the true rate at about 1% (rule of three, 3/n). The Open-i pilot of 50 bounded it at about 6%, which rules out a broken extractor and not much else. |
| Stratum B | 150 | Together with A's positives, roughly 150 to 200 labelled positives. At 80% recall that is a 95% interval of about plus or minus 6 points. At 60 positives it would be plus or minus 10. |
| Total | 500 | Clears the 200-report floor in `LABELLING.md` section 6 for `en`. |

Composition check: stratum A alone is about 85% clean, comfortably above the 60% floor in section 1.
Across A and B combined it falls to roughly 65%, still above. If the pilot shows a base rate above
about 25%, increase A rather than let the combined share drop below 60%.

**500 reports is the real cost of this plan.** At two minutes per report that is roughly 17 hours
of labelling for one person, plus about 3 more for the blind relabel of 100 reports under section
5a. If a second labeller appears, add about 3 hours for their subset. This is the dominant cost of
Phase 1 and it should be planned as such rather than discovered.

### 5.2 What the pilot found

Fifty reports from stratum A, drawn 2026-08-19 and labelled by one labeller under protocol v0.1.

| | |
|---|---|
| Reports carrying at least one instance | 10 of 50 |
| Base rate | 20%, Wilson 95% interval 11.2% to 33.0% |
| Instances | 11 |
| Instances per positive report | 1.1 |
| Conditional | 3 of 11 |
| Negated | 1 of 11 |
| Already scheduled | 0 of 11 |
| Stating an interval | 0 of 11 |

The sizes in 5.1 stand, and they survive the interval rather than only the point estimate.

**Stratum A at 350.** A 20% base rate leaves 280 clean reports. Zero false positives in 280 bounds
the true rate at 1.07% by the rule of three, against the 1% the table claims. At the top of the
interval the bound is 1.28% and at the bottom 0.97%, so it holds across the range 50 reports can
distinguish.

**Composition.** Stratum A is 80% clean rather than the 85% assumed above, still well clear of the
60% floor in `LABELLING.md` section 1. Combined with a cue-enriched stratum B the share lands near
65%, which is what 5.1 predicted.

**Stratum B at 150.** A contributes about 70 positives and B about 105, for roughly 175. At 80%
recall that is a 95% interval of plus or minus 5.9 points, against the plus or minus 6 in the table.

The base rate did not reach the 25% that would have required stratum A to grow, and it is not high
enough to make stratum B unnecessary. Both are drawn as planned.

**Instances track reports.** Eleven instances across ten positive reports. The labelling cost of the
full corpus therefore scales with report count, which is the assumption behind the 17-hour estimate
above.

### 5.3 Two things the pilot broke, recorded before scoring

Both concern what the metrics in `LABELLING.md` section 6 can mean on this corpus. Both were found
by labelling and neither was predicted.

**No recommendation stated an interval. Not one of eleven.** Section 7.1 was written expecting the
problem to be de-identification stripping the times, and 7,687 reports in the source do carry a
removed interval. In this sample the times were not removed. They were never written. Interval
accuracy is one of the six metrics and it has no denominator here, so it cannot be reported from
the pilot, and on the full corpus it may rest on a much smaller base than 500 reports implies.

This is worth more than a note about metrics. An obligation with no stated interval cannot be
overdue on the report's own authority, and deciding when it becomes overdue is exactly the
guideline judgement rule R6 forbids the extraction layer from making. If the full corpus confirms
the pattern, then most obligations this system creates will have no due date that came from the
report, and the specification should say so plainly rather than treat the missing interval as an
edge case.

**Eight of eleven findings fell outside the controlled vocabulary.** The three that fitted were a
thyroid nodule, a pulmonary nodule and a BI-RADS 0 screening recall. Labelled `other`: a bladder
filling defect, a breast mass sent for tissue diagnosis, a benign breast cyst the patient wanted
excised, a rib fracture, a lumbar spine, and two separate lung and mediastinal opacities.

The vocabulary was built around the incidental findings the follow-up literature studies, and this
sample is mostly not those. The consequence for measurement is direct: with `other` as the majority
class, an extractor that answers `other` every time scores well on finding-category accuracy. That
metric is close to uninformative until the vocabulary covers the corpus, and it should not be quoted
in `RESULTS.md` from the pilot.

Expanding the vocabulary changes every label already written and every metric computed from them, so
it waits for the full stratum A draw, where the frequencies will be worth acting on. The pilot is
recorded here as the reason to expect the change.

### 5.4 What the extractor should miss, written before it runs

So that the comparison afterwards is a test and not a description.

Ten of the eleven instances are shapes `PROMPT.md` v0.1 describes. The eleventh is the breast
excision in `LABELLING.md` 7.7, where the patient states a preference and is handed information to
schedule an appointment. The prompt asks for statements where "the clinician recommends" something,
and no clinician recommends anything in that sentence. It should be missed.

Pilot recall therefore has a ceiling near 91% that belongs to the prompt rather than to the model.
A run scoring materially above it has matched something the gold standard does not contain, and
that is a reason to read the output rather than to celebrate.

Two cases to watch, offered as questions rather than predictions:

- The damaged bladder recommendation in 7.9. The word "Recommend" is there, so the instance should
  be found. Whether the model returns action `unclear` or supplies a plausible modality for the
  missing words is what rule 3 of the prompt exists to test.
- The negated nodules in `12889749-RR-9`. The prompt lists "No further imaging is required" as an
  include with `negated` set, while rule 5 says describing a finding is not recommending follow-up.
  A model returning an empty array here has read the second and not the first.

### 5.5 A recommendation with no finding, which the obligation core cannot hold

Two of the eleven instances attach to no abnormality. Both are negative studies that ask for a
further test if clinical concern persists.

> "No acute intracranial hemorrhage. If there is continued clinical concern for infarct or vascular
> causes given the nature of symptoms, further evaluation with MRI is recommended."

> "No sequela of acute trauma visualized. If there is continued concern for rib fracture, dedicated
> radiographs can be obtained."

There is nothing to quote as the finding. The study found none, and the recommendation is contingent
on something the clinician cannot see in the images.

`createObligation` refuses this. It requires `finding.text_verbatim` under R5, on the reasoning that
an obligation carrying no quoted source is a paraphrase of one. The reasoning holds and the refusal
is the right behaviour. It is also incomplete, because 2 of 11 instances in this sample are a shape
it cannot represent.

Nothing fails today, and the reason is luck rather than design. Both instances are conditional, and
`acceptProposal` already refuses a conditional proposal on separate grounds: the condition has to be
resolved by a person before any due date exists. The two rules happen to cover the same two labels.
An unconditional recommendation on a negative study would pass the first check and fail the second,
and fifty reports cannot say whether that shape occurs.

This is a specification decision rather than a labelling one, so it is recorded and not settled.
The options are that an obligation may quote a negative statement as its finding, that the finding
may be absent when the report names none, or that this class is out of scope for Phase 1. The first
two both change section 7 of `OBLIGATION_SPEC.md` and the R5 check in `obligation.mjs`, which is a
version bump on a document that already carries a DOI. The full stratum A draw will give the
frequency, and the frequency should decide it.

## 6. Drawing the sample

1. **Fix the frame first**: modality set, date range, report types included and excluded. Record it
   here before drawing. A frame adjusted after seeing results is not a frame.
2. **One report per patient.** Serial studies of the same finding are correlated, and both the
   metrics and the identity-resolution work in section 6 of the specification would be quietly
   measuring the same nodule several times.
3. **Exclude addenda and corrections**, or treat the report and its addendum as one document. Decide
   which, record it, do not mix.
4. **Seeded, recorded draw.** The random seed and the resulting identifier list are committed before
   labelling begins, so the sample cannot drift toward reports that behave well.
5. **Randomise labelling order** and strip stratum membership from what the labeller sees. A labeller
   who knows a report came from the cue-enriched stratum expects to find something, and expecting to
   find something is how the C1 boundary gets crossed.

## 7. Development and test splits

Three known extraction defects in `RESULTS.md` are unfixed, and the candidate second verification
pass is unimplemented. Both mean prompt iteration, and prompt iteration against the same reports
used for the final numbers produces a figure that describes the reports rather than the extractor.

- **Development split, 30%.** Iterate freely. Every figure from it is provisional and labelled as
  such.
- **Test split, 70%. Scored once**, after the prompt is frozen and `PROMPT_VERSION` is bumped.
  Stratify the split so both halves keep the A and B proportions.

**Lock the labels before running the model on the test split.** Commit the gold standard, then
generate predictions. The `text_sha256` binding makes the order provable after the fact, which is the
only reason to care about it: a claim to have held a set out is worth exactly as much as the evidence
that it was held out.

If the test split is scored and then the prompt changes, the test split is spent. Score it again and
the number is no longer a held-out result, whatever the file names say.

## 8. What this corpus cannot do

**It cannot validate any language other than English.** MIMIC is English. `language_validated` stays
false for every locale pack, the unvalidated-extraction interface stays mandatory outside English
(constraint C3), and no claim about multilingual extraction can rest on this work. A second corpus in
at least one other language is a separate piece of work and should be planned as one.

**It is one institution.** Recommendation phrasing is institutional and dictation habits are local.
Numbers from BIDMC radiology are numbers from BIDMC radiology.

**It measures extraction, not linkage.** Nothing here says anything about whether an obligation, once
created, gets closed. That is Phase 2 and it needs a deployment, not a corpus.

## 9. Open decisions

**9.1 How many labellers. Decided 2026-08-07: one.** Section 5 of `LABELLING.md` is amended to
match, and the reasoning is there rather than repeated here. In short, a second labeller on MIMIC
needs their own PhysioNet credential, and recruiting one means asking somebody to complete CITI
training and then work unpaid for many hours.

If a credentialed volunteer appears, section 5b takes effect and a subset is double-labelled. The
work does not need redesigning to accept them.

The cost is that no agreement between people will be measured, so nothing will demonstrate that a
second reader would have labelled the same way. That is a real weakening and it is not buried: the
gold standard declares how it was made, and `score.mjs` prints `1 labeller, agreement between
people NOT measured` above every table it produces, and refuses to run without the declaration.

**9.2 Quotation under the DUA. Handled 2026-08-10, and no longer blocking.** `redact.mjs` produces
a publishable copy of any label set with the quoted report text stripped, keeping spans, categories,
intervals, flags and `text_sha256`. A credentialed reader rebuilds the corpus and the loader derives
every quote from their own copy, refusing the labels if the text does not hash to what was labelled.
Scoring a redacted gold standard gives numbers identical to the unredacted one, which is checked.

Still worth asking PhysioNet whether short quotations are permitted, because a permissive answer
means publishing the fuller file. But nothing waits on the answer now. See `LABELLING.md` section 8a.

---

*Draft. Sizes in section 5 are contingent on the pilot in the same section.*
