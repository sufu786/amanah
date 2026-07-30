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

## Next

A second verification pass is the obvious candidate: after extraction, ask a narrow question about
each candidate, "is an action actually recommended in this quoted text, yes or no". It targets
precision directly, costs one short call, and would address defect 1 if run per-action.

That must be measured, not assumed. Any change to prompt or model invalidates the table above.
