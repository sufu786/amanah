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
