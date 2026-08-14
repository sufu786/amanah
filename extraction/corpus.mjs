// Build the labelling corpus from MIMIC-IV-Note radiology reports.
//
//   node corpus.mjs survey --in /path/to/radiology.csv.gz
//   node corpus.mjs draw   --in /path/to/radiology.csv.gz --seed <string> --a 350 --b 150 --out ../corpus
//
// THE DATA NEVER LEAVES YOUR MACHINE. This reads a local file and writes a local file. The
// repository ignores data/, corpus/, mimic/ and phi/, and nothing here uploads, posts or logs
// report text. The MIMIC data use agreement is per person, so the corpus this produces is yours
// and is not publishable. What is publishable is the label file, via redact.mjs.
//
// TWO COMMANDS, IN THAT ORDER, DELIBERATELY
//
// `survey` answers the three questions CORPUS.md section 2 says must be checked against the real
// data before any size is committed. It writes nothing. Running it first is not a formality: the
// Open-i pilot failed because a corpus was drawn before anyone asked whether it could contain the
// thing being measured, and 50 reports were labelled to discover it could not.
//
// `draw` takes the sample, once the frame is decided. It records the seed and every filter in the
// output, because a frame adjusted after seeing results is not a frame.
//
// HOW THE DRAW IS RANDOM AND REPRODUCIBLE AT THE SAME TIME
//
// No random number generator. Each candidate gets a key of sha256(seed + note_id), and the lowest
// keys win. That is deterministic given the seed, uniform enough for sampling, needs no state, and
// anyone with the same seed and the same source file draws the identical sample. It also means the
// sample cannot be quietly redrawn until it looks better without changing the recorded seed.

import { createReadStream, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

// Section 4 of CORPUS.md. Deliberately over-inclusive: this is a sampling device to raise the
// density of positives in stratum B, and it is never a label, a denominator, or a filter on what
// gets read. Every drawn report is labelled in full regardless of why it matched.
const CUES = [
  'recommend', 'suggest', 'follow-up', 'follow up', 'advise', 'consider', 'repeat',
  'correlate', 'referral', 'further evaluation', 'as per', 'surveillance', 're-image',
  'reassess',
];

const MODALITY_PATTERNS = [
  [/\bCT\b|COMPUTED TOMOGRAP/i, 'CT'],
  [/\bMRI?\b|MAGNETIC RESONANCE/i, 'MR'],
  [/ULTRASOUND|\bUS\b|SONOGRA/i, 'Ultrasound'],
  [/MAMMOGRA/i, 'Mammography'],
  [/PET\b/i, 'PET'],
  [/RADIOGRAPH|\bX-?RAY\b|\bCXR\b|\bXR\b/i, 'Radiograph'],
];

const classifyModality = (text) => {
  const head = text.slice(0, 400);
  for (const [re, name] of MODALITY_PATTERNS) if (re.test(head)) return name;
  return 'other/unclassified';
};

/**
 * Streaming RFC 4180 CSV reader.
 *
 * Written rather than pulled in, because MIMIC report text contains commas, quotes and newlines
 * inside quoted fields, and a naive split on commas silently truncates reports. A truncated report
 * is worse than a missing one: it still labels, still round-trips, and quietly removes whatever
 * recommendation sat after the break.
 */
export async function* parseCsvStream(stream) {
  // StringDecoder, not chunk.toString('utf8'). A multibyte character split across a chunk
  // boundary decodes to replacement characters with toString, silently altering the report text
  // and therefore its sha256 and every span offset after it. The decoder holds the partial bytes
  // until the rest arrives. Whether this bites depends on where gzip happens to break the stream,
  // which is not a thing to leave to chance in the file every label is anchored to.
  const decoder = new StringDecoder('utf8');
  let field = '';
  let row = [];
  let inQuotes = false;
  let pendingQuote = false;
  let header = null;

  for await (const chunk of stream) {
    const s = decoder.write(chunk);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') { field += '"'; continue; }
        inQuotes = false;
        // fall through to handle c as a normal character
      }
      if (inQuotes) {
        if (c === '"') { pendingQuote = true; continue; }
        field += c;
        continue;
      }
      if (c === '"') { inQuotes = true; continue; }
      if (c === ',') { row.push(field); field = ''; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (header === null) header = row;
        else if (row.length > 1 || row[0] !== '') yield Object.fromEntries(header.map((h, k) => [h, row[k] ?? '']));
        row = [];
        continue;
      }
      field += c;
    }
  }
  field += decoder.end();
  if (field !== '' || row.length) {
    row.push(field);
    if (header && (row.length > 1 || row[0] !== '')) {
      yield Object.fromEntries(header.map((h, k) => [h, row[k] ?? '']));
    }
  }
}

export function readCsv(path) {
  return parseCsvStream(createReadStream(path).pipe(createGunzip()));
}

export const sortKey = (seed, id) => createHash('sha256').update(`${seed}|${id}`, 'utf8').digest('hex');
const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
const pct = (n, d) => (d === 0 ? '  n/a' : `${(100 * n / d).toFixed(1)}%`);

/**
 * Choose stratum A and stratum B from one-per-patient candidates.
 *
 * Separated out and exported so the sampling can be tested without a multi-gigabyte file. This is
 * the part where a quiet mistake is least visible: an overlapping A and B, or a draw that is not
 * reproducible from its seed, produces numbers that look ordinary and cannot be checked afterwards.
 *
 * A note on a bias worth knowing about. One report per patient is chosen BEFORE the cue filter, so
 * stratum B is drawn only from patients whose randomly chosen report happens to contain a cue. That
 * is deliberate: choosing the cue-bearing report per patient instead would select, within a patient,
 * for the report most likely to contain a recommendation, and stratum B would stop being a random
 * sample of anything. The cost is a smaller B pool. The alternative costs its meaning.
 */
export function pickStrata(candidates, { seed, nA, nB }) {
  const keyed = candidates
    .map((c) => ({ ...c, key: sortKey(seed, c.note_id) }))
    // Ties broken by note_id so the order is total, not merely mostly-determined.
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : (a.note_id < b.note_id ? -1 : 1)));

  const A = keyed.slice(0, nA);
  const takenA = new Set(A.map((c) => c.note_id));
  const B = keyed.filter((c) => c.hasCue && !takenA.has(c.note_id)).slice(0, nB);
  return { A, B };
}

function requireColumns(row, needed, path) {
  const missing = needed.filter((c) => !(c in row));
  if (missing.length) {
    throw new Error(`${basename(path)} is missing column(s): ${missing.join(', ')}\n`
      + `Found: ${Object.keys(row).join(', ')}\n`
      + 'MIMIC column names change between releases. Check the version you downloaded rather than '
      + 'letting this guess.');
  }
}

// ---------------------------------------------------------------------------------- survey

async function survey(path) {
  let total = 0;
  const noteTypes = new Map();
  const modalities = new Map();
  const perPatient = new Map();
  let withCue = 0;
  let placeholderTotal = 0;
  let placeholderNearCue = 0;
  let placeholderInIntervalShape = 0;
  const lengths = [];
  const examples = [];

  for await (const row of readCsv(path)) {
    if (total === 0) requireColumns(row, ['note_id', 'subject_id', 'text'], path);
    total++;
    const text = row.text ?? '';

    noteTypes.set(row.note_type ?? '(none)', (noteTypes.get(row.note_type ?? '(none)') ?? 0) + 1);
    const mod = classifyModality(text);
    modalities.set(mod, (modalities.get(mod) ?? 0) + 1);
    perPatient.set(row.subject_id, (perPatient.get(row.subject_id) ?? 0) + 1);
    if (lengths.length < 200000) lengths.push(text.length);

    const lower = text.toLowerCase();
    const hasCue = CUES.some((c) => lower.includes(c));
    if (hasCue) withCue++;

    // The de-identification placeholder question. A recommendation reading "Recommend CT follow-up
    // in ___ months" is a real recommendation whose interval cannot be quoted, and it has to be
    // labelled interval null with the placeholder kept in interval_verbatim. Whether that becomes
    // a section 7 precedent depends on how often it actually happens, which is what this counts.
    if (text.includes('___')) {
      placeholderTotal++;
      for (const m of text.matchAll(/[^.\n]*___[^.\n]*/g)) {
        const sentence = m[0].toLowerCase();
        if (CUES.some((c) => sentence.includes(c))) {
          placeholderNearCue++;
          if (/\b(in|at|within|after)\s+___|___\s*(month|week|day|year)/i.test(m[0])) {
            placeholderInIntervalShape++;
            if (examples.length < 6) examples.push(m[0].trim().slice(0, 150));
          }
          break;
        }
      }
    }
  }

  const sorted = [...lengths].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const multi = [...perPatient.values()].filter((n) => n > 1).length;

  console.log(`\nSurvey of ${basename(path)}`);
  console.log(`  reports            ${total.toLocaleString()}`);
  console.log(`  distinct patients  ${perPatient.size.toLocaleString()}`);
  console.log(`  median length      ${median.toLocaleString()} characters`);

  console.log('\n1. Modality mix. Recommendations concentrate in cross-sectional imaging.');
  console.log('   Plain film is where Open-i failed.');
  for (const [m, n] of [...modalities].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${m.padEnd(20)} ${String(n).padStart(9)}  ${pct(n, total)}`);
  }
  const cross = ['CT', 'MR', 'Ultrasound', 'PET'].reduce((s, k) => s + (modalities.get(k) ?? 0), 0);
  console.log(`   cross-sectional total: ${pct(cross, total)}`);
  if (cross / total < 0.2) {
    console.log('   WARNING: under a fifth of this frame is cross-sectional. Restricting the frame');
    console.log('   to those modalities is likely necessary, or stratum A will look like Open-i.');
  }

  console.log('\n2. Addenda and duplicates. Each would otherwise enter the sample as an');
  console.log('   independent report, and serial studies of one finding are correlated.');
  console.log('   note_type values:');
  for (const [t, n] of [...noteTypes].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(t).padEnd(20)} ${String(n).padStart(9)}  ${pct(n, total)}`);
  }
  console.log(`   patients with more than one report: ${multi.toLocaleString()} `
    + `(${pct(multi, perPatient.size)} of patients)`);
  console.log('   The draw takes one report per patient, so this is handled, but it is worth');
  console.log('   knowing how much of the frame it discards.');

  console.log('\n3. De-identification placeholders inside recommendation sentences.');
  console.log(`   reports containing ___              ${placeholderTotal.toLocaleString()}  ${pct(placeholderTotal, total)}`);
  console.log(`   ___ in a sentence with a cue word   ${placeholderNearCue.toLocaleString()}  ${pct(placeholderNearCue, total)}`);
  console.log(`   ___ where an interval would be      ${placeholderInIntervalShape.toLocaleString()}  ${pct(placeholderInIntervalShape, total)}`);
  if (examples.length) {
    console.log('   examples:');
    for (const e of examples) console.log(`     ${e}`);
  }
  if (placeholderInIntervalShape / Math.max(1, total) > 0.005) {
    console.log('   This is frequent enough to need a LABELLING.md section 7 precedent written');
    console.log('   BEFORE labelling starts. Label interval null, keep the placeholder in');
    console.log('   interval_verbatim.');
  }

  console.log(`\nCue-word prevalence (sampling device only, NOT a positive rate): ${pct(withCue, total)}`);
  console.log('   The Open-i pilot found every cue-word match was a false cue. This number tells');
  console.log('   you how large stratum B can be drawn, and nothing about how many are real.\n');
}

// ------------------------------------------------------------------------------------ draw

async function draw(path, { seed, nA, nB, out, modalities: allow }) {
  // Pass 1: keep only the lowest-keyed note per patient, holding no text. A Map over patients is
  // affordable; a Map over reports holding text is not.
  const best = new Map();
  let total = 0;
  let eligible = 0;

  for await (const row of readCsv(path)) {
    if (total === 0) requireColumns(row, ['note_id', 'subject_id', 'text'], path);
    total++;
    const text = row.text ?? '';
    if (text.length < 200) continue;
    const mod = classifyModality(text);
    if (allow && !allow.includes(mod)) continue;
    eligible++;

    const key = sortKey(seed, row.note_id);
    const prev = best.get(row.subject_id);
    const hasCue = CUES.some((c) => text.toLowerCase().includes(c));
    if (!prev || key < prev.key) {
      best.set(row.subject_id, { key, note_id: row.note_id, subject_id: row.subject_id, mod, hasCue });
    }
  }

  const { A: strA, B: strB } = pickStrata([...best.values()], { seed, nA, nB });

  if (strA.length < nA) console.log(`WARNING: stratum A wanted ${nA}, frame yielded ${strA.length}`);
  if (strB.length < nB) console.log(`WARNING: stratum B wanted ${nB}, cue-matching pool yielded ${strB.length}`);

  // Pass 2: fetch text for the chosen ids only.
  const wanted = new Map([...strA, ...strB].map((c) => [c.note_id, c]));
  const texts = new Map();
  for await (const row of readCsv(path)) {
    if (wanted.has(row.note_id)) texts.set(row.note_id, row.text ?? '');
    if (texts.size === wanted.size) break;
  }

  mkdirSync(out, { recursive: true });
  const write = (name, stratum, list) => {
    const reports = list.map((c) => ({
      id: c.note_id,
      language: 'en',
      subject_id: c.subject_id,
      modality: c.mod,
      text: texts.get(c.note_id),
    }));
    const doc = {
      corpus: `mimic-radiology-${stratum}`,
      // The frame, recorded with the sample rather than remembered separately.
      frame: {
        source: basename(path),
        stratum,
        seed,
        one_report_per_patient: true,
        min_length_chars: 200,
        modalities: allow ?? 'all',
        cue_list: stratum === 'B' ? CUES : null,
        source_reports_scanned: total,
        eligible_after_frame: eligible,
        distinct_patients: best.size,
      },
      note: stratum === 'A'
        ? 'Random stratum. The ONLY stratum permitted to produce a false-positive rate, a precision figure, or a base rate. See CORPUS.md section 4.'
        : 'Cue-enriched stratum. MUST NOT be used for false positives, precision, or base rate. Recall computed over this is conditional on the cue list. See CORPUS.md section 4.',
      reports,
    };
    writeFileSync(join(out, name), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    const sums = reports.map((r) => sha256(r.text));
    console.log(`  ${name.padEnd(26)} ${String(reports.length).padStart(4)} reports  `
      + `sha256 of set: ${sha256(sums.join('')).slice(0, 16)}`);
  };

  console.log(`\nDraw from ${basename(path)}  seed "${seed}"`);
  console.log(`  scanned ${total.toLocaleString()} reports, ${eligible.toLocaleString()} passed the frame, `
    + `${best.size.toLocaleString()} patients`);
  write('reports-A.json', 'A', strA);
  write('reports-B.json', 'B', strB);
  console.log(`\nWritten to ${out}. This directory is gitignored and must stay that way.`);
  console.log('Score each stratum separately. Concatenating them produces a precision figure over');
  console.log('text pre-selected for recommendation-shaped words, which is higher than the truth.\n');
}

// ------------------------------------------------------------------------------------ cli

// Guarded, matching extract.mjs. Without it, importing this module to test the parser runs the
// CLI and exits the test process, which is how this was found.
// pathToFileURL rather than string concatenation. On Windows import.meta.url is
// file:///C:/... with three slashes while the hand-built version had two, so the comparison
// was always false and the CLI below never ran. It failed silently, which is why nobody
// noticed until the corpus tool was tested.
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

const args = process.argv.slice(2);
const cmd = args[0];
const get = (f, d = null) => { const i = args.indexOf(f); return i === -1 ? d : args[i + 1]; };

const usage = () => {
  console.error('usage:');
  console.error('  node corpus.mjs survey --in <radiology.csv.gz>');
  console.error('  node corpus.mjs draw --in <radiology.csv.gz> --seed <string> [--a 350] [--b 150]');
  console.error('                       [--modalities CT,MR,Ultrasound] --out <dir>');
  process.exit(2);
};

if (isMain) {
  const input = get('--in');
  if (!input || !['survey', 'draw'].includes(cmd)) usage();
  if (!existsSync(input)) { console.error(`not found: ${input}`); process.exit(2); }

  if (cmd === 'survey') {
    await survey(input);
  } else {
    const seed = get('--seed');
    if (!seed) {
      console.error('--seed is required, and it must be recorded before the draw rather than after.');
      console.error('A sample redrawn until it looks better is not a sample.');
      process.exit(2);
    }
    const mods = get('--modalities');
    await draw(input, {
      seed,
      nA: Number(get('--a', '350')),
      nB: Number(get('--b', '150')),
      out: get('--out', '../corpus'),
      modalities: mods ? mods.split(',').map((s) => s.trim()) : null,
    });
  }
}
