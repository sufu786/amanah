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

/**
 * The report's own EXAMINATION header, which MIMIC radiology notes carry as their first line.
 *
 * Classifying from this rather than from the first 400 characters of arbitrary text matters more
 * than it looks. The modality mix decides whether stratum A has to be restricted, and the body of
 * a chest radiograph report routinely mentions CT in a comparison line. Reading the header asks
 * what the study was. Reading the body asks what words happen to appear in it.
 */
export const examinationOf = (text) => {
  const m = text.match(/^[ \t]*EXAMINATION:[ \t]*(.+)$/im)
    ?? text.match(/^[ \t]*(?:STUDY|PROCEDURE):[ \t]*(.+)$/im);
  return m ? m[1].trim() : null;
};

export const classifyModality = (text) => {
  const exam = examinationOf(text);
  const subject = exam ?? text.slice(0, 200);
  for (const [re, name] of MODALITY_PATTERNS) if (re.test(subject)) return name;
  return exam ? 'other/unclassified' : 'no examination header';
};

/**
 * Note ids that are addenda to another report, read from radiology_detail.
 *
 * CORPUS.md section 2 asks how addenda and corrections are represented, because each would
 * otherwise enter the sample as an independent report. The detail table answers that directly
 * rather than by inference from note_type: a note named as another note's addendum_note_id is an
 * addendum. Held as a Set because they are few relative to the corpus.
 */
export async function loadAddenda(detailPath) {
  const addenda = new Set();
  const parents = new Set();
  const examNames = new Map();
  const modalityByNote = new Map();
  for await (const row of readCsv(detailPath)) {
    if (row.field_name === 'addendum_note_id') addenda.add(row.field_value);
    else if (row.field_name === 'parent_note_id') parents.add(row.field_value);
    else if (row.field_name === 'exam_name' && row.field_ordinal === '1') {
      examNames.set(row.field_value, (examNames.get(row.field_value) ?? 0) + 1);
      // Interned by construction: classifyExamName returns one of a handful of constants, so this
      // holds millions of keys pointing at a few shared strings rather than millions of strings.
      modalityByNote.set(row.note_id, classifyExamName(row.field_value));
    }
  }
  return { addenda, parents, examNames, modalityByNote };
}

/**
 * Modality from the exam name recorded in radiology_detail.
 *
 * This replaced pattern-matching the report body, which got half the corpus wrong on the real
 * data. "CHEST (PORTABLE AP)" is plainly a radiograph and contains none of the words a body-text
 * matcher looks for, so 24% came back unclassified and another 27% had no EXAMINATION header the
 * matcher could find. The modality mix decides whether stratum A has to be restricted, so roughly
 * right was not good enough.
 *
 * Order matters. CTA and MRA are caught before the plain CT and MR patterns, and the interventional
 * and fluoroscopy shapes before the plain-film fallback, because "CHEST PORT. LINE PLACEMENT" is a
 * line placement rather than a chest film.
 */
export function classifyExamName(name) {
  const n = String(name).toUpperCase();
  if (n === '___' || n.trim() === '') return 'de-identified exam name';
  if (/MAMMO|TOMOSYNTHESIS/.test(n)) return 'Mammography';
  if (/\bPET\b/.test(n)) return 'PET';
  if (/ANGIO|EMBOL|CATHET|\bDRAIN|BIOPSY|ASPIRATION|\bPICC\b|LINE PLACEMENT|\bPORT\.|GUIDANCE/.test(n)) {
    return 'Interventional';
  }
  if (/\bCTA?\b|\bCT[\s/-]|COMPUTED TOMOGRAP/.test(n)) return 'CT';
  if (/\bMRA?\b|\bMR[\s/-]|MAGNETIC RESONANCE/.test(n)) return 'MR';
  if (/\bUS\b|ULTRASOUND|SONOGRAM|DOPPLER|\bECHO\b/.test(n)) return 'Ultrasound';
  if (/NUCLEAR|SCINTIG|BONE SCAN|\bHIDA\b|\bMAG3\b|V\/?Q\b/.test(n)) return 'Nuclear medicine';
  if (/FLUORO|BARIUM|SWALLOW|ESOPHAG|UPPER GI|ENEMA|CYSTOGRAM|MYELOGRAM|ARTHROGRAM/.test(n)) {
    return 'Fluoroscopy';
  }
  if (/CHEST|ABDOMEN|PELVIS|SPINE|FEMUR|TIBIA|HUMERUS|FOREARM|HAND|FOOT|ANKLE|KNEE|SHOULDER|WRIST|HIP|RIB|SKULL|SINUS|NECK|CLAVICLE|SCAPULA|RADIOGRAPH|X-?RAY|\bXR\b|\bPA\b|\bAP\b|\bLAT\b/.test(n)) {
    return 'Radiograph';
  }
  return 'other/unclassified';
}

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

async function survey(path, detailPath) {
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

  // Loaded first, because modality is taken from exam_name rather than from the report body.
  let detail = null;
  if (detailPath) {
    process.stdout.write('  reading radiology_detail ... ');
    detail = await loadAddenda(detailPath);
    console.log(`${detail.modalityByNote.size.toLocaleString()} exam names`);
  }

  for await (const row of readCsv(path)) {
    if (total === 0) requireColumns(row, ['note_id', 'subject_id', 'text'], path);
    total++;
    const text = row.text ?? '';

    noteTypes.set(row.note_type ?? '(none)', (noteTypes.get(row.note_type ?? '(none)') ?? 0) + 1);
    const mod = detail?.modalityByNote.get(row.note_id) ?? classifyModality(text);
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
          // "___ year old" is an age, not an interval, and it appears in the INDICATION line of a
          // large share of these reports. The first version of this check counted them and
          // inflated the figure, which is the same mistake CORPUS.md section 1 records about the
          // Open-i cue screen, made here by the tool written to avoid it.
          const isAge = /___[\s-]*(year|yo|y\/o|month)[\s-]*old|\b(age|aged)\b[^.]*___/i.test(m[0]);
          const looksLikeInterval = /\b(in|at|within|after|every|repeat|q)\s+___\s*(month|week|day|year|mo\b|wk\b|yr\b)/i
            .test(m[0])
            || /\bfollow[\s-]?up[^.]{0,40}___\s*(month|week|day|year)/i.test(m[0]);
          if (!isAge && looksLikeInterval) {
            placeholderInIntervalShape++;
            if (examples.length < 8) examples.push(m[0].trim().slice(0, 140));
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
  if (detail) {
    console.log(`   notes that ARE an addendum to another: ${detail.addenda.size.toLocaleString()}`);
    console.log(`   notes that HAVE an addendum:           ${detail.parents.size.toLocaleString()}`);
    console.log('   The draw excludes addenda, so a report and its addendum cannot both be');
    console.log('   labelled as though they were independent.');

    const exams = [...detail.examNames].sort((a, b) => b[1] - a[1]);
    console.log(`\n   exam_name, top 15 of ${detail.examNames.size.toLocaleString()} distinct:`);
    for (const [name, n] of exams.slice(0, 15)) {
      console.log(`     ${String(name).slice(0, 46).padEnd(48)} ${String(n).padStart(8)}`);
    }
  } else {
    console.log('   (pass --detail radiology_detail.csv.gz to count addenda from the data');
    console.log('   rather than inferring them from note_type)');
  }

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

async function draw(path, { seed, nA, nB, out, modalities: allow, detailPath }) {
  // The detail table is not optional for a real draw. Without it, addenda enter the sample as
  // independent reports, and modality is guessed from the report body, which was wrong for half
  // the corpus when it was measured.
  if (!detailPath) {
    console.error('--detail is required for a draw.');
    console.error('Without radiology_detail, addenda cannot be excluded and modality is a guess.');
    process.exit(2);
  }
  process.stdout.write('  reading radiology_detail ... ');
  const detail = await loadAddenda(detailPath);
  console.log(`${detail.addenda.size.toLocaleString()} addenda to exclude`);

  // Pass 1: keep only the lowest-keyed note per patient, holding no text. A Map over patients is
  // affordable; a Map over reports holding text is not.
  const best = new Map();
  let total = 0;
  let eligible = 0;
  let skippedAddenda = 0;
  let skippedShort = 0;
  let skippedModality = 0;

  for await (const row of readCsv(path)) {
    if (total === 0) requireColumns(row, ['note_id', 'subject_id', 'text'], path);
    total++;
    const text = row.text ?? '';

    // An addendum is a continuation of another report, not a report. Labelling both would count
    // one study twice and would put two views of the same finding into the sample.
    if (detail.addenda.has(row.note_id)) { skippedAddenda++; continue; }
    if (text.length < 200) { skippedShort++; continue; }
    const mod = detail.modalityByNote.get(row.note_id) ?? classifyModality(text);
    if (allow && !allow.includes(mod)) { skippedModality++; continue; }
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
  console.log(`  excluded: ${skippedAddenda.toLocaleString()} addenda, `
    + `${skippedShort.toLocaleString()} too short`
    + (allow ? `, ${skippedModality.toLocaleString()} outside the modality filter` : ''));
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
  console.error('  node corpus.mjs survey --in <radiology.csv.gz> [--detail <radiology_detail.csv.gz>]');
  console.error('  node corpus.mjs draw --in <radiology.csv.gz> --detail <radiology_detail.csv.gz>');
  console.error('                       --seed <string> [--a 350] [--b 150] [--modalities CT,MR] --out <dir>');
  process.exit(2);
};

if (isMain) {
  const input = get('--in');
  if (!input || !['survey', 'draw'].includes(cmd)) usage();
  if (!existsSync(input)) { console.error(`not found: ${input}`); process.exit(2); }

  if (cmd === 'survey') {
    await survey(input, get('--detail'));
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
    detailPath: get('--detail'),
      modalities: mods ? mods.split(',').map((s) => s.trim()) : null,
    });
  }
}
