// Build the document PDFs from the Markdown sources.
//
// The PDFs are not committed. They are build artifacts whose canonical home is the Zenodo
// archive, and this file is what makes the claim in .gitignore true: that they are regenerable
// from the Markdown. It exists because the first set was not. Those were produced by hand
// nineteen minutes before the repository's first commit, from a draft that never entered version
// control, and every later correction to the Markdown was invisible to the archived copies until
// somebody noticed.
//
// The pipeline reproduces what made the originals, recovered from their own metadata: Producer
// "Skia/PDF", a Windows browser Creator string, and embedded subsets of Georgia, Segoe UI,
// Consolas and Tahoma. That is Markdown, to HTML, to headless Chrome print-to-PDF.
//
// Three things here are load-bearing rather than cosmetic.
//
//   typographer: false   markdown-it would otherwise convert -- into an em dash and straight
//                        quotes into curly ones. This repository removed those characters in
//                        three separate commits, and a renderer that silently puts them back
//                        defeats the entire point of rebuilding.
//
//   Tahoma in the stack  Georgia has no Arabic glyphs. The name explanation in CONCEPT_NOTE.md
//                        contains أمانة, and Tahoma is what the original PDFs embedded to render
//                        it. Without a font covering the range it prints as empty boxes, and
//                        nothing in the build would complain.
//
//   --no-pdf-header-footer
//                        Chrome otherwise stamps a date and a file:// URL onto every page. In an
//                        archived document that URL is a path on somebody's laptop.
//
// Run `npm run pdf` to build and verify together. Verification is not optional politeness: it is
// what catches a renderer quietly reintroducing the characters this is meant to remove.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import MarkdownIt from 'markdown-it';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error('Chrome not found. It is what renders the PDF.');
  console.error(`Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  console.error('Set CHROME_PATH to override.');
  process.exit(2);
}

const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false, // See the note above. Do not enable this.
});

const CSS = `
@page { size: A4; margin: 20mm 18mm 22mm 18mm; }

body {
  font-family: Georgia, "Times New Roman", Tahoma, serif;
  font-size: 10.5pt;
  line-height: 1.58;
  color: #1a1a1a;
  margin: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

h1, h2, h3, h4, h5, h6 {
  font-family: "Segoe UI", Tahoma, Arial, sans-serif;
  color: #111;
  line-height: 1.25;
  margin: 1.6em 0 0.6em;
  page-break-after: avoid;
}
h1 { font-size: 20pt; margin-top: 0; letter-spacing: -0.2px; }
h2 { font-size: 14.5pt; border-bottom: 1px solid #d8d8d8; padding-bottom: 0.25em; }
h3 { font-size: 12pt; }
h4, h5, h6 { font-size: 10.5pt; }

p { margin: 0 0 0.85em; orphans: 2; widows: 2; }
a { color: #14507a; text-decoration: none; }
strong { color: #000; }

code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 9pt;
  background: #f4f5f7;
  border: 1px solid #e3e5e8;
  border-radius: 3px;
  padding: 0.1em 0.32em;
}

/* white-space: pre-wrap keeps the ASCII state machine in OBLIGATION_SPEC.md from being clipped
   at the page edge, and page-break-inside: avoid keeps it from being split down the middle. */
pre {
  font-family: Consolas, "Courier New", monospace;
  font-size: 8.6pt;
  line-height: 1.45;
  background: #f7f8fa;
  border: 1px solid #e3e5e8;
  border-radius: 4px;
  padding: 0.75em 0.9em;
  white-space: pre-wrap;
  word-wrap: break-word;
  page-break-inside: avoid;
}
pre code { background: none; border: 0; padding: 0; font-size: inherit; }

blockquote {
  margin: 1em 0;
  padding: 0.1em 0 0.1em 1em;
  border-left: 3px solid #c8ccd1;
  color: #333;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  font-size: 9.2pt;
  page-break-inside: avoid;
}
th, td {
  border: 1px solid #d5d8dc;
  padding: 0.4em 0.6em;
  text-align: left;
  vertical-align: top;
}
th { background: #f2f3f5; font-family: "Segoe UI", Tahoma, sans-serif; font-size: 8.8pt; }

ul, ol { margin: 0 0 0.9em; padding-left: 1.5em; }
li { margin: 0.22em 0; }
hr { border: 0; border-top: 1px solid #dcdfe3; margin: 1.8em 0; }
img { max-width: 100%; }
`;

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node build-pdf.mjs <file.md> [file.md ...]');
  process.exit(2);
}

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const title = (src.match(/^#\s+(.+)$/m) || [, basename(f, '.md')])[1].trim();

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${title.replace(/[<>&]/g, '')}</title>
<style>${CSS}</style>
</head><body>
${md.render(src)}
</body></html>`;

  const htmlPath = resolve(f.replace(/\.md$/, '.build.html'));
  const pdfPath = resolve(f.replace(/\.md$/, '.pdf'));
  writeFileSync(htmlPath, html, 'utf8');

  try {
    execFileSync(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=10000',
      `--print-to-pdf=${pdfPath}`,
      `file:///${htmlPath.replace(/\\/g, '/')}`,
    ], { stdio: 'pipe', timeout: 120000 });
  } finally {
    unlinkSync(htmlPath); // intermediate, never archived
  }

  console.log(`${basename(f)} -> ${basename(pdfPath)}`);
}

console.log('\nNow run `npm run verify`. A PDF that has not been checked is not ready to archive.');
