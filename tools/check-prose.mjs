// Enforce the mechanical half of STYLE.md.
//
// Characters are checked in every tracked text file. The word list is checked in Markdown only,
// because code legitimately contains some of these terms as data: summary.mjs holds a lexicon of
// language the prepared summary may not use, and the tests deliberately construct bad copy to
// prove the check refuses it. Scanning those would mean the detector reporting itself.
//
// This is a floor. It catches the tells that can be matched; it cannot tell you a paragraph
// explains the same decision twice, which is the more common problem.
//
//   cd tools && npm run prose

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// The deliberate Arabic in the name explanation.
const ALLOWED_CHARS = new Set(['أ', 'م', 'ا', 'ن', 'ة']);

// Deliberately excluded, after the first run flagged them wrongly:
//
//   harness   This project's own noun for the labelling tooling, and a section heading. The tell
//             is the verb, "harness the power of", which is caught as a phrase below.
//
// The check exists to serve the writing. When it disagrees with correct prose, the check is what
// gets fixed.
const BANNED_WORDS = [
  'delve', 'delves', 'delving', 'leverage', 'leverages', 'leveraging',
  'seamless', 'seamlessly', 'holistic', 'cutting-edge', 'game-changing',
  'myriad', 'plethora', 'pivotal', 'paramount',
  'comprehensive', 'robust',
];

const BANNED_PATTERNS = [
  [/it is worth noting/, 'it is worth noting'],
  [/it is important to note/, 'it is important to note'],
  [/it should be noted/, 'it should be noted'],
  [/in conclusion/, 'in conclusion'],
  [/let us dive in|dive deep/, 'dive in / dive deep'],
  [/that being said/, 'that being said'],
  [/at the end of the day/, 'at the end of the day'],
  [/in today's world/, "in today's world"],
  [/harness(ing)? the (power|potential)/, 'harness the power of'],
  // The scaffolding, not the ordinary use. "on failures, not only successes" is fine English;
  // "not only X but also Y" is the construction worth losing.
  [/not only\b.*\bbut also\b/, 'not only X but also Y'],
];

// Paragraph openers. Matched at the start of a line only, so the words remain usable mid-sentence.
const BANNED_OPENERS = [
  'importantly', 'notably', 'furthermore', 'moreover', 'additionally', 'crucially',
];

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/\.(pdf|png|jpg|jpeg|zip|cff)$/.test(f));

let errors = 0;
const report = (file, line, msg) => {
  console.log(`  ${file}:${line}  ${msg}`);
  errors++;
};

for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  const isMarkdown = file.endsWith('.md');

  lines.forEach((line, i) => {
    const n = i + 1;

    for (const ch of line) {
      if (ch.codePointAt(0) > 127 && !ALLOWED_CHARS.has(ch)) {
        report(file, n, `non-ASCII U+${ch.codePointAt(0).toString(16).toUpperCase()} ${JSON.stringify(ch)}`);
      }
    }
    if (/!(?![=[])/.test(line) && isMarkdown && !line.trim().startsWith('```')) {
      const bare = line.replace(/`[^`]*`/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, '');
      if (/!\s|!$/.test(bare)) report(file, n, 'exclamation mark');
    }

    // STYLE.md is the word list. Running the word list over it reports every entry as a
    // violation, which is the detector finding itself. Characters are still checked there.
    if (!isMarkdown || file === 'STYLE.md') return;

    const lower = line.toLowerCase();
    for (const w of BANNED_WORDS) {
      if (new RegExp(`\\b${w}\\b`).test(lower)) report(file, n, `"${w}" (STYLE.md word list)`);
    }
    for (const [pattern, label] of BANNED_PATTERNS) {
      if (pattern.test(lower)) report(file, n, `"${label}" (STYLE.md phrase list)`);
    }
    const opener = lower.replace(/^[>\-*\s#]+/, '').match(/^([a-z]+),/);
    if (opener && BANNED_OPENERS.includes(opener[1])) {
      report(file, n, `paragraph opens with "${opener[1]},"`);
    }
  });
}

console.log();
if (errors) {
  console.log(`${errors} style issue(s). See STYLE.md.`);
  process.exit(1);
}
console.log(`No style issues in ${files.length} tracked files.`);
