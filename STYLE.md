# House style

Everything written in this repository is read by someone deciding whether to trust it. A reviewer
deciding whether the specification is serious. A clinician deciding whether the summary is safe. A
funder deciding whether the author knows what they are doing. Writing that reads as though it came
out of a machine costs the project credibility it cannot spare, and this is a project whose entire
argument is that it does not fabricate.

So: no document in this repository should look generated. That is a rule, not a preference, and
`tools/check-prose.mjs` enforces the mechanical half of it.

## Characters

Plain ASCII. No em dashes, en dashes, curly quotes, section signs, arrows, bullets, or emoji.

Use a full stop where a dash is tempting. Two sentences almost always beat one sentence with a dash
in the middle, and the dash is the single clearest tell in machine-written English.

The one exception is the Arabic أمانة where the name is explained. That is the meaning of the word
the project is named after, and it is deliberate.

## Words and constructions to avoid

Not because they are wrong, but because they cluster in generated text and readers now notice.

- delve, leverage, robust, seamless, holistic, cutting-edge, game-changing
- comprehensive, myriad, plethora, pivotal, crucial, vital, paramount
- "It is worth noting that", "It is important to note", "In conclusion", "Let us dive in"
- "Not only X but also Y"
- Paragraphs opening with Importantly, Notably, Furthermore, Moreover, Additionally
- Lists of exactly three adjectives where one would do
- A closing paragraph that restates what the section just said
- Bold on more than a few words per page
- Exclamation marks

## How to write instead

**Say the thing, then stop.** Most sections here are too long because they explain a decision and
then explain it again in summary. Delete the second one.

**Be concrete.** Name the file, the number, the failure. "The check found this by refusing to print
the Fleischner rule because it contained the word risk" tells a reader something. "Robust
validation ensures quality" tells them nothing and reads as filler.

**Say what is not known.** This repository has no measured recall in any language. Every document
that touches performance should say so. Confidence that is not backed by a measurement is the thing
this project is built to remove from clinical software, and writing it into our own documentation
would be an odd way to start.

**Vary the rhythm.** Generated prose runs to a uniform sentence length. Real writing does not.

**Let the reader disagree.** Where a decision was a judgement call, say so and say what the other
option was. Three specification ambiguities are recorded in section 12 for exactly this reason.

## Commit messages

Same rules. Say what changed and why it changed, in sentences. No trailers naming a tool or a
model as an author: this repository has one author, it is cited by name and ORCID, and the git
history is part of the provenance record that the DOI points at.

## The check

```
cd tools && npm run prose
```

Characters are checked in every tracked text file. The word list is checked in Markdown only, since
code legitimately contains some of these terms as data. The check is a floor, not a substitute for
reading what you wrote.
