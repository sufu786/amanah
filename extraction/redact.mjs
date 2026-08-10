// Produce a publishable copy of a label set, with the quoted report text stripped.
//
//   node redact.mjs --in gold.json --out gold.public.json
//
// LABELLING.md says labels are published alongside the metrics, so the judgement calls can be
// checked rather than taken on trust. The MIMIC data use agreement forbids redistributing the
// report text. Those pull against each other for any label file, because a label quotes the report.
//
// This resolves it without waiting for a ruling. The published copy keeps the spans, the
// categories, the intervals, the flags and the text_sha256, and drops the quoted strings. A
// credentialed reader rebuilds the corpus from the identifiers, and labels.mjs refuses the labels
// unless the text hashes to what was labelled, then derives every quote from their own copy.
//
// What is lost is the ability of a reader with no corpus access to see the quoted sentence. That
// reader could not have judged the call anyway: a category next to a sentence, with none of the
// surrounding report, is not enough to say whether the labeller was right. The quotes buy the
// appearance of checkability more than the substance.
//
// If PhysioNet confirms that short quotations are permitted, publish the unredacted file instead
// and this becomes unnecessary. Until then it is the safe default, and it costs almost nothing.

import { readFileSync, writeFileSync } from 'node:fs';

const STRIP = ['recommendation_verbatim', 'finding_verbatim', 'interval_verbatim',
  'condition_verbatim', 'urgency_verbatim'];

const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const inPath = get('--in');
const outPath = get('--out');

if (!inPath || !outPath) {
  console.error('usage: node redact.mjs --in <labels.json> --out <labels.public.json>');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(inPath, 'utf8'));

if (raw.redacted) {
  console.error(`${inPath} is already redacted. Nothing to do.`);
  process.exit(2);
}

let stripped = 0;
let missingSha = 0;

const out = {
  ...raw,
  redacted: true,
  labels: (raw.labels ?? []).map((entry) => {
    if (!entry.text_sha256) missingSha++;
    return {
      ...entry,
      recommendations: (entry.recommendations ?? []).map((rec) => {
        const clean = { ...rec };
        for (const field of STRIP) {
          if (clean[field] != null) stripped++;
          delete clean[field];
        }
        return clean;
      }),
    };
  }),
};

// Without text_sha256 a reader cannot prove they rebuilt the same corpus, and every span in the
// file becomes an unverifiable offset into a document nobody can identify. That is worse than not
// publishing, so it is a hard stop rather than a warning.
if (missingSha) {
  console.error(`${missingSha} label entr${missingSha === 1 ? 'y has' : 'ies have'} no text_sha256.`);
  console.error('A redacted file is nothing but offsets, so without the hash a reader cannot prove');
  console.error('they rebuilt the corpus these offsets belong to. Add the hashes before publishing.');
  process.exit(1);
}

writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

console.log(`${inPath} -> ${outPath}`);
console.log(`  ${out.labels.length} report(s), ${stripped} quoted string(s) removed`);
console.log('  spans, categories, intervals, flags and text_sha256 all kept');
console.log();
console.log('Check it loads against the corpus before you publish it:');
console.log(`  node score.mjs --corpus <reports.json> --gold ${outPath} --predictions <preds.json>`);
