// Tests for the corpus builder.
//
//   node --test extraction/corpus.test.mjs
//
// The CSV reader is hand-written, and it is parsing the file every label in this project will be
// anchored to. Its failure mode is not a crash. A mishandled quote truncates a report, and a
// truncated report still loads, still labels, still round-trips its spans, and silently removes
// whatever recommendation sat after the break. That is a false negative manufactured by the
// tooling, which is the one error this project cannot detect after the fact.
//
// So the parser is tested against the shapes real clinical text actually takes: commas inside
// quoted fields, embedded newlines, doubled quotes, CRLF from Windows exports, and a final row
// with no trailing newline.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { readCsv, parseCsvStream, pickStrata, sortKey } from './corpus.mjs';

const dir = mkdtempSync(join(tmpdir(), 'amanah-corpus-'));

/** Write a gzipped CSV and read every row back. */
async function roundTrip(csv, name = 'x.csv.gz') {
  const path = join(dir, name);
  writeFileSync(path, gzipSync(Buffer.from(csv, 'utf8')));
  const rows = [];
  for await (const r of readCsv(path)) rows.push(r);
  return rows;
}

describe('CSV reader, on the shapes clinical text actually takes', () => {
  test('plain rows', async () => {
    const rows = await roundTrip('note_id,subject_id,text\nn1,s1,hello\nn2,s2,world\n');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { note_id: 'n1', subject_id: 's1', text: 'hello' });
    assert.equal(rows[1].text, 'world');
  });

  test('a comma inside a quoted field does not split the row', async () => {
    const rows = await roundTrip('note_id,text\nn1,"8 mm nodule, right upper lobe"\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, '8 mm nodule, right upper lobe');
  });

  test('newlines inside a quoted field are preserved, and do not end the row', async () => {
    // This is what a real report looks like, and the case a naive parser gets wrong.
    const report = 'EXAMINATION: CT CHEST\n\nIMPRESSION:\n  8 mm nodule.\n  Recommend CT in 6 months.';
    const rows = await roundTrip(`note_id,text\nn1,"${report}"\nn2,after\n`);
    assert.equal(rows.length, 2, 'the embedded newlines must not create extra rows');
    assert.equal(rows[0].text, report);
    assert.match(rows[0].text, /Recommend CT in 6 months\.$/, 'the recommendation survives to the end');
    assert.equal(rows[1].text, 'after');
  });

  test('doubled quotes decode to one quote', async () => {
    const rows = await roundTrip('note_id,text\nn1,"he said ""recommend CT"" here"\n');
    assert.equal(rows[0].text, 'he said "recommend CT" here');
  });

  test('a quoted field ending in a quote right before the delimiter', async () => {
    const rows = await roundTrip('note_id,text,tail\nn1,"ends with ""quote""",z\n');
    assert.equal(rows[0].text, 'ends with "quote"');
    assert.equal(rows[0].tail, 'z');
  });

  test('CRLF line endings', async () => {
    const rows = await roundTrip('note_id,text\r\nn1,alpha\r\nn2,beta\r\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].text, 'alpha');
    assert.equal(rows[1].text, 'beta', 'no stray carriage return on the value');
  });

  test('CRLF inside a quoted field is kept verbatim', async () => {
    const rows = await roundTrip('note_id,text\r\nn1,"line one\r\nline two"\r\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, 'line one\r\nline two');
  });

  test('a final row with no trailing newline is not dropped', async () => {
    const rows = await roundTrip('note_id,text\nn1,first\nn2,last-no-newline');
    assert.equal(rows.length, 2);
    assert.equal(rows[1].text, 'last-no-newline');
  });

  test('a final quoted row with no trailing newline is not dropped', async () => {
    const rows = await roundTrip('note_id,text\nn1,"quoted, last"');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, 'quoted, last');
  });

  test('empty fields stay empty rather than shifting the row', async () => {
    const rows = await roundTrip('note_id,hadm_id,text\nn1,,body\n');
    assert.deepEqual(rows[0], { note_id: 'n1', hadm_id: '', text: 'body' });
  });

  test('blank lines between rows are ignored', async () => {
    const rows = await roundTrip('note_id,text\nn1,a\n\nn2,b\n');
    assert.equal(rows.length, 2);
  });

  test('a report split across gzip chunk boundaries is reassembled', async () => {
    // The parser reads fixed-size chunks, so a quoted field longer than a chunk exercises the
    // state carried between iterations. Real reports routinely exceed 64 KB.
    const long = `START ${'x'.repeat(200000)} , with a comma\nand a newline END`;
    const rows = await roundTrip(`note_id,text\nn1,"${long}"\nn2,short\n`, 'big.csv.gz');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].text.length, long.length);
    assert.match(rows[0].text, /END$/, 'the tail of a very long field survives');
    assert.equal(rows[1].text, 'short');
  });

  test('multibyte characters are not corrupted across chunk boundaries', async () => {
    const text = `${'a'.repeat(65535)}ééé end`;
    const rows = await roundTrip(`note_id,text\nn1,"${text}"\n`, 'utf8.csv.gz');
    assert.equal(rows[0].text, text);
  });
});

describe('stratum selection', () => {
  const candidates = Array.from({ length: 500 }, (_, i) => ({
    note_id: `n${i}`,
    subject_id: `s${i}`,
    hasCue: i % 5 === 0,
  }));

  test('the same seed draws the identical sample', () => {
    const a = pickStrata(candidates, { seed: 'trial-1', nA: 50, nB: 20 });
    const b = pickStrata(candidates, { seed: 'trial-1', nA: 50, nB: 20 });
    assert.deepEqual(a.A.map((c) => c.note_id), b.A.map((c) => c.note_id));
    assert.deepEqual(a.B.map((c) => c.note_id), b.B.map((c) => c.note_id));
  });

  test('input order does not change the sample', () => {
    const shuffled = [...candidates].reverse();
    const a = pickStrata(candidates, { seed: 'trial-1', nA: 50, nB: 20 });
    const b = pickStrata(shuffled, { seed: 'trial-1', nA: 50, nB: 20 });
    assert.deepEqual(a.A.map((c) => c.note_id), b.A.map((c) => c.note_id));
  });

  test('a different seed draws a different sample', () => {
    const a = pickStrata(candidates, { seed: 'trial-1', nA: 50, nB: 20 });
    const b = pickStrata(candidates, { seed: 'trial-2', nA: 50, nB: 20 });
    assert.notDeepEqual(a.A.map((c) => c.note_id), b.A.map((c) => c.note_id));
  });

  test('the strata never overlap', () => {
    const { A, B } = pickStrata(candidates, { seed: 'trial-1', nA: 50, nB: 20 });
    const inA = new Set(A.map((c) => c.note_id));
    assert.ok(B.every((c) => !inA.has(c.note_id)),
      'a report in both strata would be counted twice and would put cue-selected text into the '
      + 'only stratum permitted to produce a precision figure');
  });

  test('stratum B contains only cue matches', () => {
    const { B } = pickStrata(candidates, { seed: 'trial-1', nA: 50, nB: 20 });
    assert.ok(B.length > 0);
    assert.ok(B.every((c) => c.hasCue));
  });

  test('stratum A is not filtered by cue, so it stays unbiased', () => {
    const { A } = pickStrata(candidates, { seed: 'trial-1', nA: 100, nB: 20 });
    const withCue = A.filter((c) => c.hasCue).length;
    // One in five candidates carries a cue. A is a random draw, so it should land near that and
    // must not be all-cue or no-cue. This is the property that makes A usable for a base rate.
    assert.ok(withCue > 5 && withCue < 40, `stratum A had ${withCue}/100 cue matches, expected near 20`);
  });

  test('asking for more than exists returns what exists rather than padding', () => {
    const { A, B } = pickStrata(candidates.slice(0, 10), { seed: 's', nA: 50, nB: 50 });
    assert.equal(A.length, 10);
    assert.equal(B.length, 0, 'every cue match was already taken by A');
  });

  test('the sort is total, so equal keys cannot reorder between runs', () => {
    // Two candidates deliberately sharing a note_id produce identical keys. The tie-break on
    // note_id has to leave the order defined rather than dependent on sort stability.
    const dupes = [
      { note_id: 'same', subject_id: 's1', hasCue: false },
      { note_id: 'same', subject_id: 's2', hasCue: false },
    ];
    const a = pickStrata(dupes, { seed: 's', nA: 2, nB: 0 });
    const b = pickStrata([...dupes].reverse(), { seed: 's', nA: 2, nB: 0 });
    assert.deepEqual(a.A.map((c) => c.key), b.A.map((c) => c.key));
  });

  test('the key depends on both seed and note id', () => {
    assert.notEqual(sortKey('s1', 'n1'), sortKey('s2', 'n1'));
    assert.notEqual(sortKey('s1', 'n1'), sortKey('s1', 'n2'));
    assert.equal(sortKey('s1', 'n1'), sortKey('s1', 'n1'));
  });
});

describe('chunk boundaries, forced rather than hoped for', () => {
  /** Feed the parser byte ranges we choose, so the split point is not left to gzip. */
  const streamOf = (buf, cuts) => Readable.from((function* () {
    let prev = 0;
    for (const cut of [...cuts, buf.length]) { yield buf.subarray(prev, cut); prev = cut; }
  })());

  const rowsFrom = async (buf, cuts) => {
    const out = [];
    for await (const r of parseCsvStream(streamOf(buf, cuts))) out.push(r);
    return out;
  };

  test('a two-byte character split down the middle survives', async () => {
    const csv = Buffer.from('note_id,text\nn1,"deg 37\u00b0C here"\n', 'utf8');
    const at = csv.indexOf(0xc2); // first byte of the degree sign
    assert.ok(at > 0, 'fixture must actually contain a two-byte character');
    const rows = await rowsFrom(csv, [at + 1]); // cut between its two bytes
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, 'deg 37\u00b0C here');
    assert.ok(!rows[0].text.includes('\ufffd'), 'no replacement character');
  });

  test('a four-byte character split at every possible point survives', async () => {
    // Four-byte sequences give three ways to break. All three have to hold, because a corrupted
    // character changes the text, its sha256, and every span offset after it.
    const csv = Buffer.from('note_id,text\nn1,"before \u{1f600} after"\n', 'utf8');
    const at = csv.indexOf(0xf0);
    for (const offset of [1, 2, 3]) {
      const rows = await rowsFrom(csv, [at + offset]);
      assert.equal(rows[0].text, 'before \u{1f600} after', `split ${offset} byte(s) in`);
    }
  });

  test('a quoted field broken across many chunks reassembles exactly', async () => {
    const body = 'IMPRESSION: 8 mm nodule.\nRecommend CT follow-up in 6 months.';
    const csv = Buffer.from(`note_id,text\nn1,"${body}"\nn2,tail\n`, 'utf8');
    const cuts = Array.from({ length: csv.length - 1 }, (_, i) => i + 1); // one byte at a time
    const rows = await rowsFrom(csv, cuts);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].text, body);
    assert.equal(rows[1].text, 'tail');
  });

  test('a row boundary landing exactly on a chunk edge still ends the row', async () => {
    const csv = Buffer.from('note_id,text\nn1,a\nn2,b\n', 'utf8');
    for (let cut = 1; cut < csv.length; cut++) {
      const rows = await rowsFrom(csv, [cut]);
      assert.equal(rows.length, 2, `cut at byte ${cut}`);
      assert.equal(rows[1].text, 'b', `cut at byte ${cut}`);
    }
  });

  test('CRLF split between the CR and the LF does not produce an empty row', async () => {
    const csv = Buffer.from('note_id,text\r\nn1,a\r\nn2,b\r\n', 'utf8');
    const at = csv.indexOf(Buffer.from('\r\nn2'));
    const rows = await rowsFrom(csv, [at + 1]); // between CR and LF
    assert.equal(rows.length, 2);
    assert.equal(rows[0].text, 'a');
    assert.equal(rows[1].text, 'b');
  });
});
