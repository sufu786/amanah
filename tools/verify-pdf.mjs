// Check a built PDF before it is archived.
//
// A PDF is a poor place to notice a mistake. Once it carries a DOI it is permanent, and the only
// remedy is another version. So the checks that can be made mechanically are made here, and they
// fail the build rather than print a warning.
//
// What this catches, in the order it has actually bitten:
//
//   1. Typography the sources no longer contain. If a renderer is configured with smart
//      punctuation, clean ASCII Markdown produces a PDF full of em dashes and curly quotes, and
//      nothing upstream reports it. This is the specific failure that put em dashes into the
//      archived v1.1 record.
//
//   2. Missing glyphs. Georgia has no Arabic. If the font stack loses its fallback, أمانة prints
//      as empty boxes and the build still succeeds. So: if the Markdown contains Arabic, the PDF
//      must too. Chrome stores it shaped, as presentation forms, which is why the check accepts
//      those ranges as well as the base block.
//
//   3. Truncation. A silently empty or half-rendered page count is not obvious from a file size.
//      The document title must survive into the text layer, and there must be text at all.
//
// This does not check layout. Nothing automated here will tell you a table ran off the page.
// Open the PDF and look at it before publishing.
//
//   node verify-pdf.mjs ../CONCEPT_NOTE.pdf ../OBLIGATION_SPEC.pdf

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Written as escapes, not as the characters themselves, and deliberately so. This repository
// sweeps its files for non-ASCII. A sweep that "cleaned" a detector containing its own targets
// would disarm the check while leaving it looking like it still worked.
const FORBIDDEN = {
  'em dash': /\u2014/g,
  'en dash': /\u2013/g,
  'section sign': /\u00a7/g,
  'curly quote': /[\u2018\u2019\u201c\u201d]/g,
  'replacement character': /\ufffd/g,
};

// Arabic block, plus the Presentation Forms A and B that a shaping engine emits.
const ARABIC = /[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]/;

const squash = (s) => s.replace(/\s+/g, '').toLowerCase();

let failed = false;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failed = true; };
const pass = (msg) => console.log(`  ok    ${msg}`);

for (const file of process.argv.slice(2)) {
  console.log(`\n${basename(file)}`);
  if (!existsSync(file)) {
    fail('file does not exist. Run the build first.');
    continue;
  }

  const doc = await getDocument({
    data: new Uint8Array(readFileSync(file)),
    useSystemFonts: true,
  }).promise;

  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    text += content.items.map((i) => i.str).join('');
  }

  console.log(`  ${doc.numPages} pages, ${text.length} characters of extractable text`);

  if (doc.numPages < 1 || text.length < 500) {
    fail(`almost no text extracted. The render probably failed.`);
  } else {
    pass('has pages and text');
  }

  for (const [label, re] of Object.entries(FORBIDDEN)) {
    const hits = text.match(re) || [];
    if (hits.length) fail(`${hits.length} x ${label}. The renderer is adding typography the sources do not contain.`);
  }
  if (!Object.values(FORBIDDEN).some((re) => re.test(text))) {
    pass('no em dashes, en dashes, section signs, curly quotes or replacement characters');
  }

  const md = file.replace(/\.pdf$/, '.md');
  if (existsSync(md)) {
    const src = readFileSync(md, 'utf8');

    if (ARABIC.test(src)) {
      if (ARABIC.test(text)) pass('Arabic present in the source is present in the PDF');
      else fail('the Markdown contains Arabic but the PDF does not. The font stack has lost its fallback and it is printing boxes.');
    }

    const title = (src.match(/^#\s+(.+)$/m) || [, ''])[1].replace(/[*_`]/g, '').trim();
    if (title) {
      if (squash(text).includes(squash(title))) pass('document title survives into the text layer');
      else fail(`document title not found in the PDF text: "${title.slice(0, 60)}"`);
    }
  } else {
    console.log(`  note  no sibling ${basename(md)}, skipped source-derived checks`);
  }
}

console.log();
if (failed) {
  console.log('VERIFY FAILED. Do not archive this build.');
  process.exit(1);
}
console.log('Verified. Layout is still unchecked: open the PDF and look at it before publishing.');
