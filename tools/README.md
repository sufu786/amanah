# Document build

Rebuilds `CONCEPT_NOTE.pdf` and `OBLIGATION_SPEC.pdf` from the Markdown sources.

```
cd tools
npm install
npm run pdf        # build, then verify
```

The PDFs are written next to their sources in the repository root and are not committed. They are
build artifacts; the archived copies on Zenodo are canonical.

## Why this exists

The first set of PDFs was produced by hand nineteen minutes before the repository's first commit,
from a draft that never entered version control. Every later correction to the Markdown was
invisible to the archived copies, and stayed invisible until someone read the record and asked why
the typography did not match. `.gitignore` claimed the PDFs were regenerable from the Markdown.
This is what makes that true.

## Requirements

Node 20 or newer, and Google Chrome. Chrome is the renderer, not a convenience: the original PDFs
were produced by it, and matching it is how new versions stay visually consistent with the archived
ones. Set `CHROME_PATH` if it is installed somewhere unusual.

## Verification is part of the build

`npm run pdf` builds and then verifies. The verifier fails the build rather than warning, because a
PDF is a poor place to discover a mistake: once it carries a DOI it is permanent, and the only
remedy is publishing another version.

It checks three things that have each gone wrong or could:

- **Typography the sources do not contain.** A renderer configured with smart punctuation turns
  clean ASCII Markdown into a PDF full of em dashes and curly quotes, and reports nothing. That is
  how they reached the archived v1.1 record.
- **Missing glyphs.** Georgia has no Arabic. If the font stack loses its Tahoma fallback, أمانة
  prints as empty boxes and the build still succeeds.
- **Truncation.** The document title must survive into the text layer, and there must be text.

It does not check layout. Nothing here will tell you a table ran off the page, so open the PDF and
look at it before publishing.

## Publishing a new version

Zenodo cannot replace files on a published record. Corrections to the documents need a new version,
which mints a new DOI while the concept DOI continues to resolve to the latest. Metadata, including
the abstract, can be edited in place on the existing record without a new version.
