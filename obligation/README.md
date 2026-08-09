# The obligation

Sections 2 to 6 of `OBLIGATION_SPEC.md`, implemented. This is the primitive the specification is
about: everything in `extraction/` produces a *proposal* for one of these, and until now nothing
could hold one.

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

Three places, found by implementing it. Two are here, the third is under the escalation ladder
below. None is resolved silently: each is written down so the specification can be corrected in
whichever direction the author intends.

The state diagram in section 3 draws an arrow into `resolved` labelled `not_indicated`, while also
listing `not_indicated` as a terminal exit in its own right. Those two readings conflict.

The text immediately below the diagram is the tiebreaker: *"there is no edge from any state to
`resolved` that does not pass through recorded evidence."* So this implementation makes `resolved`
reachable only from `completed`, and treats `not_indicated` as its own terminal state requiring a
documented reason and an actor.

That is the conservative reading, and it is the one where an obligation cannot reach the success
state without evidence, which is the invariant the whole specification exists to protect. It is
recorded here rather than resolved silently, because the diagram should be corrected in whichever
direction the author intends.

A second, smaller one: `reopened` appears in the section 5 event vocabulary, but no reopen edge is
drawn in section 3, and section 3 says permitted transitions only. Terminal states here have no
exits. If reopening is meant to exist, the diagram needs an edge and the conditions for it.

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

**A third place the specification pulls against itself.** Section 8 says of L4: "Final escalation;
on exhaustion, becomes `lost_to_followup`". Read plainly that is a state change caused by the
passage of time. R1 says there are no implicit state transitions. R2 says elapsed time never closes
an obligation, and while `lost_to_followup` is explicitly not a closure, it is still terminal, and
drifting into a terminal state unattended is the same failure wearing a different label.

So the ladder reports exhaustion and names who should act. Somebody records the transition with
their name against it. If an obligation ends as `lost_to_followup`, the history says which person
accepted that, which is the entire point of keeping one.

The alternative reading, where a scheduler quietly moves obligations to a terminal state on a
timer, would make the system's own worst outcome the one thing that happens without anyone
deciding it. The wording in section 8 should be tightened.

An obligation with no due date stays at L0 and keeps reminding, rather than being dropped because
the rungs cannot be computed. Silently ceasing to remind is the failure this system exists to fix.

## Not built yet

Locale packs (section 10), and the scheduler that would drive the ladder. The scheduler is the one
component that legitimately reads a clock. When it is written it belongs outside these modules, and
it must produce `reminded` and `escalated` events through `record()` rather than move state itself.
