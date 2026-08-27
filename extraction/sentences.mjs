// Sentence segmentation for clinical reports, with exact source offsets.
//
// Deterministic and dependency-free, because the failure mode of a wrong split is a recommendation
// cut in half, and half a recommendation is a quote that no longer round-trips. R5 is enforced by
// locating every quote in the source, so a splitter that loses characters would break the one check
// standing between a model and a fabricated obligation.
//
// Two properties are asserted in sentences.test.mjs rather than assumed:
//
//   1. The returned spans tile the text. No gaps, no overlaps, and concatenating the slices
//      reproduces the input byte for byte.
//   2. No labelled recommendation in the pilot corpus is cut across two segments.
//
// Splitting clinical text on "." alone fails on decimals (4.9 x 3.0 cm), unit abbreviations
// (8 mm.), titles (Dr. ___), initialisms (RENAL U.S.), and numbered impression lists. Each is
// handled explicitly here. A general-purpose sentence tokeniser would handle most of them and would
// also be a dependency whose behaviour changes under us on a version bump.

const ABBREV = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'np', 'pa', 'md', 'do', 'rn',
  'mm', 'cm', 'm', 'mg', 'ml', 'cc', 'kg', 'sec', 'min', 'hr',
  'approx', 'vs', 'etc', 'eg', 'ie', 'no', 'fig',
]);

/** A header line such as "IMPRESSION:" or "FINDINGS:", used as context for the sentences under it. */
const HEADER = /^[ \t]*([A-Z][A-Z0-9 ()\/&'.-]{2,}):/;

/**
 * Sections that cannot contain a recommendation, as a matter of what they are for.
 *
 * This is LABELLING.md 7.4 and 7.8 written as code. 7.4: the indication line states why the study
 * was done, and a request this report already answered is not a request outstanding after it. 7.8:
 * a notification block describes how the report was delivered.
 *
 * Written as a rule rather than as a prompt instruction because a rule cannot be ignored. Measured
 * on the pilot in RESULTS.md: suppressing these removed seven spurious detections and cost no
 * recall, since no labelled instance in the corpus came from any of them.
 */
export const SECTIONS_WITHOUT_RECOMMENDATIONS = [
  'INDICATION', 'HISTORY', 'CLINICAL HISTORY', 'CLINICAL INFORMATION',
  'REASON FOR EXAM', 'REASON FOR EXAMINATION',
  'TECHNIQUE', 'COMPARISON', 'NOTIFICATION', 'WET READ', 'DOSE',
];

const SUPPRESSED = new RegExp(`^(${SECTIONS_WITHOUT_RECOMMENDATIONS.join('|')})\\b`);

/** True when a sentence under this heading cannot be a recommendation. Null section is not suppressed. */
export const sectionCannotRecommend = (section) =>
  typeof section === 'string' && SUPPRESSED.test(section.trim());

const isTerminator = (ch) => ch === '.' || ch === '?' || ch === '!';

/**
 * True when the period at `i` ends a sentence rather than sitting inside a number, an abbreviation
 * or a list marker.
 */
function endsSentence(text, i) {
  if (text[i] !== '.') return true; // ? and ! are unambiguous in this corpus

  // 4.9, 2.5 mm: a digit on both sides is never a sentence end.
  if (/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) return false;

  // A numbered list marker at the start of a line, as impressions are written: "1. Stranding ...".
  // The period belongs to the marker, not to a sentence.
  const lineStart = text.lastIndexOf('\n', i) + 1;
  if (/^[ \t]*\d+$/.test(text.slice(lineStart, i))) return false;

  const word = (text.slice(Math.max(0, i - 12), i).match(/([A-Za-z.]+)$/) ?? [])[1] ?? '';
  if (word.length === 1) return false; // the U of "U.S."

  // An initialism written with periods: single letters joined by them, as in "U.S." for ultrasound,
  // which appears in exam names throughout this corpus. The closing period is part of the token.
  if (/^[A-Za-z](\.[A-Za-z])+$/.test(word)) return false;

  if (ABBREV.has(word.replace(/\./g, '').toLowerCase())
      && !/\n\s*$/.test(text.slice(i + 1, i + 3))) return false;

  return true;
}

/**
 * Split `text` into segments, each carrying its span and the section heading it falls under.
 *
 * Returns [{span: [start, end], text, section}], where text is the raw slice including its
 * trailing whitespace, so that the segments tile the input exactly.
 */
export function splitSentences(text) {
  const out = [];
  let start = 0;

  const push = (s, e) => {
    if (e <= s) return;
    const raw = text.slice(s, e);
    // Whitespace-only runs attach to the previous segment, so the tiling has no empty members.
    if (!raw.trim() && out.length) {
      out[out.length - 1].span[1] = e;
      out[out.length - 1].text = text.slice(out[out.length - 1].span[0], e);
      return;
    }
    out.push({ span: [s, e], text: raw, section: null });
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (isTerminator(ch) && endsSentence(text, i)) {
      let j = i + 1;
      while (j < text.length && /[\s)"']/.test(text[j])) j++;
      push(start, j);
      start = j;
      i = j - 1;
      continue;
    }

    // A blank line or a new header ends the current segment even with no terminator. Report
    // sections are frequently written without full stops ("BONES: unremarkable").
    if (ch === '\n') {
      const rest = text.slice(i + 1);
      if (/^[ \t]*\n/.test(rest) || HEADER.test(rest.split('\n')[0] ?? '')) {
        push(start, i + 1);
        start = i + 1;
      }
    }
  }
  push(start, text.length);

  // Sections in one forward pass, after splitting. A segment opening with a header takes it and
  // later segments inherit until the next one. Tracking this during the split was wrong: a header
  // and its first sentence usually share a line ("IMPRESSION:  No acute fracture."), so the
  // running value lagged by one segment.
  let current = null;
  for (const s of out) {
    const h = HEADER.exec(s.text);
    if (h) current = h[1].trim();
    s.section = current;
  }
  return out;
}
