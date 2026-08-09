# The obligation

Sections 2 to 6 and 8 to 10 of `OBLIGATION_SPEC.md`, implemented. This is the primitive the
specification is about: everything in `extraction/` produces a proposal for one of these, and until
this existed nothing could hold one.

```
node --test obligation/*.test.mjs
```

No dependencies. Node 20 or newer.

## What it is

`obligation.mjs` is pure and transport-agnostic. No storage, no network, no framework. The
specification says the object can travel as JSON, as a FHIR `Task`, or printed on paper, so this
layer commits to none of them. Every function takes an obligation and returns a new one.

Nothing mutates. History is append-only, so returning a longer history rather than editing one in
place is the honest representation: a caller holding the previous value still holds a true record
of what the obligation was.

## Time is injected, never read

Nothing in `obligation.mjs` calls the clock. Every function that changes an obligation takes an
explicit `at`.

This is not a testing convenience. R2 says elapsed time never closes an obligation, and a module
that cannot see the clock cannot accidentally use it. It is the requirement most easily broken by a
reasonable later change: one `Date.now()` in an auto-close helper and silent expiry is back, which
is the precise failure this project exists to correct.

So the conformance suite checks it structurally, by reading the source. No runtime test can wait
six months to prove that a due date did nothing.

## Conformance

`conformance.test.mjs` covers the seven conditions in section 11, plus the state machine, finding
identity and due-date arithmetic. Each test names the requirement it covers.

Passing does not mean the system is safe. It means this module does not violate the seven
conditions the specification was able to state mechanically. The interesting failures in a
follow-up registry are social and operational, and no test suite reaches them.

## Where the specification pulls against itself

Three places, found by writing this against it. They are recorded in section 12.1 of
`OBLIGATION_SPEC.md`, not here, because they are findings about the specification rather than notes
about this code, and any independent implementer will meet the same three.

In short: `not_indicated` is drawn both as an edge and as a state, `reopened` has no edge, and L4
asks elapsed time to make a state change that R1 forbids. This implementation took the conservative
reading of each. None should be treated as settled until the specification is corrected.

## The prepared summary

`summary.mjs`. Section 9 calls this the single feature that converts knowing into done. It is the
page a patient hands across a counter, so it is the only part of the system most people will ever
read, and it is where the non-interpretive promise either holds or fails in public.

Seven required contents, three prohibited ones, both enforced. The prohibition is the interesting
half. Section 9 forbids "urgency language not present in the source report", so a plain blocklist
over the finished page cannot work: it would either censor the clinician's own words or let the
system's through. Instead each part records where its words came from.

| Origin | Scanned | Why |
|---|---|---|
| report | no | The clinician's words are not ours to censor. A report that says urgent must print urgent. |
| guideline | no | A citation to an external published rule, which R6 requires be named. |
| system | yes | The system speaking, including every string from a locale pack. |

A violation throws. A summary that interprets is not a degraded summary, it is the thing this
system promises not to do.

That third origin was not in the first draft. The check found it by refusing to print the
Fleischner rule `solid_nodule_6to8mm_low_risk`, on the grounds that it contained the word risk.
Naming a rule is not estimating one, and refusing to print it would have broken R6 to satisfy a
word match.

The same check runs over locale packs, which is what makes translated copy safe to accept from
contributors (section 10).

## The escalation ladder

`escalation.mjs`. Section 8. It works out which rung an obligation is on and who should act. It
does not act, and it does not change state.

Exhaustion at L4 is reported, never performed. Section 12.1 C of the specification explains why:
asking elapsed time to move an obligation into a terminal state is what R1 forbids. A person
records it, and the history then says who accepted that outcome.

An obligation with no due date stays at L0 and keeps reminding, rather than being dropped because
the rungs cannot be computed. Silently ceasing to remind is the failure this system exists to fix.

## From an extraction to an obligation

`from-extraction.mjs`. The seam that had never been joined. `extraction/` produces structured
fields; this turns them into proposals, and a separate call turns an accepted proposal into an
obligation.

The two-step shape is the constraint rather than a convenience. C3 makes the patient the validator:
fields are shown beside the highlighted source sentence and confirmed before anything becomes real.
So a proposal carries the character span, and `acceptProposal` takes an actor.

**Nothing is dropped.** C6 says below-threshold extractions enter a review queue and are never
silently accepted or silently dropped. Every recommendation the extractor returned leaves in
exactly one bucket, and the count is asserted:

| Bucket | Why |
|---|---|
| proposals | above threshold, ready for the patient to confirm |
| review_queue | below threshold (C6) |
| blocked | no document date, and every due date derives from one |
| not_indicated_evidence | the report says follow-up is not needed. Evidence, not a duty. |

The threshold is a required argument with no default. It depends on measured performance for the
model and language in use, and this repository has not measured recall for any language yet, so
any number written here would be inventing evidence.

A conditional recommendation is flagged and cannot be accepted as it stands: converting it into an
unconditional due date invents a duty the report made contingent. An empty result carries the C2
wording, in the concept note's own words, and an unreadable document is reported as a failure to
read rather than a finding that there was nothing there.

## Locale packs

`locale.mjs`. Section 10. The README calls these the most valuable contribution anyone can make,
which means they arrive from people this project has never met, in languages nobody here reads.
That decides the design: a pack is untrusted input.

Every user-facing string in a pack is the system speaking, so it goes through the same check as the
English copy. A contributor cannot introduce interpretation, risk language or added urgency through
a translation, and neither can a well-meaning maintainer. Signposting is checked too.

`resolvePack` never fails. It matches the exact locale, falls back to the nearest language, and
finally to English with a flag set. Section 10 makes this mandatory: no user is ever blocked
pending support for their country. Under full fallback a patient still gets a printable page, and
the two lines that matter most on it are verbatim quotes from their own report, which they do read.

Signposting is omitted rather than guessed when there is no pack for the country. A wrong address
for a TB clinic is worse than no address: it sends someone on a journey they may not be able to
afford twice.

A pack that fails validation is never served. It degrades to the fallback instead.

## Not built yet

**The scheduler.** It is the one component that legitimately reads a clock. When it is written it
belongs outside these modules, and it must produce `reminded` and `escalated` events through
`record()` rather than move state itself. Everything here is a pure function of an obligation and
an injected `now`, so a scheduler is the only place the clock needs to enter the system.

**Storage.** Deliberately absent. The specification is transport-agnostic and these modules commit
to no database, no wire format and no framework. An obligation is a value.

**C4, the permanent miss-rate audit.** A continuously sampled, manually reviewed stream estimating
how often extraction misses a real recommendation. The concept note calls it a permanent operating
requirement rather than a one-off validation activity. It cannot be built before there is a
labelled corpus, and it is not something code alone discharges.
