# The obligation

Sections 2 to 6 of `OBLIGATION_SPEC.md`, implemented. This is the primitive the specification is
about: everything in `extraction/` produces a *proposal* for one of these, and until now nothing
could hold one.

```
node --test obligation/conformance.test.mjs
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

## One place the specification is ambiguous

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

## Not built yet

The escalation ladder (section 8), the prepared summary (section 9) and locale packs (section 10).
The ladder in particular needs a scheduler, and a scheduler is the one component that legitimately
does read a clock. When it is written, it belongs outside this module, and it must produce
`reminded` and `escalated` events through `record()` rather than move state on its own.
