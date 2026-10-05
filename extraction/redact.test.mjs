// Tests for redact.mjs.
//
//   node --test extraction/redact.test.mjs
//
// CORPUS.md 9.2 promises that scoring a redacted gold standard gives the same numbers as scoring
// the file it came from. That promise was checked by hand once, and it was false: interval accuracy
// moved, because the scorer recognised a de-identified interval by reading interval_verbatim and
// redaction strips that field. Nothing errored. The numbers were simply different. So the promise
// is now a test, run on a gold standard that contains the case that broke it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'labels-example');

const run = (script, args) => {
  const r = spawnSync(process.execPath, [join(here, script), ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${script} failed:\n${r.stderr}${r.stdout}`);
  return r.stdout;
};

const score = (gold) => JSON.parse(run('score.mjs', [
  '--corpus', join(fixtures, 'reports.json'),
  '--gold', gold,
  '--predictions', join(fixtures, 'predictions.json'),
  '--json',
]));

test('a redacted gold standard scores identically, including a de-identified interval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redact-'));

  // The example gold standard, with its one stated interval turned into the MIMIC shape: the
  // number replaced by ___, the interval therefore null, and the placeholder kept (LABELLING.md 7.1).
  const gold = JSON.parse(readFileSync(join(fixtures, 'gold.json'), 'utf8'));

  // The fixture predates the closed anatomy vocabulary and writes side inside anatomy, as in
  // "lung.right.upper_lobe". The loader now refuses that, so map it to anatomy plus laterality.
  for (const r of gold.labels.flatMap((e) => e.recommendations)) {
    const [organ, side] = String(r.anatomy ?? '').split('.');
    if (side) {
      r.anatomy = organ;
      r.laterality = side;
    }
  }

  const rec =gold.labels.flatMap((e) => e.recommendations).find((r) => r.interval_verbatim === 'in 6 months');
  assert.ok(rec, 'fixture changed: no instance with interval_verbatim "in 6 months"');
  rec.interval = null;
  rec.interval_verbatim = 'in ___ months';

  const full = join(dir, 'gold.json');
  const pub = join(dir, 'gold.public.json');
  writeFileSync(full, JSON.stringify(gold));
  run('redact.mjs', ['--in', full, '--out', pub]);

  const published = readFileSync(pub, 'utf8');
  assert.ok(!published.includes('___'), 'the placeholder text must not survive redaction');
  assert.ok(!published.includes('_verbatim'), 'no verbatim field may survive redaction');

  const a = score(full);
  const b = score(pub);
  assert.deepEqual(b, a);
  assert.match(JSON.stringify(a), /"interval_excluded_deidentified":[1-9]/,
    'the test is only meaningful if the de-identified interval was matched and excluded');
});
