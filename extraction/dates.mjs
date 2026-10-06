// Candidate dates in a report, for the patient to confirm. Phase 2, stage 1.
//
// Every due date is computed from the date of the report, so this one value decides when a patient
// is told something is overdue. The per-sentence pipeline does not read it, and a model asked for it
// has invented one before (RESULTS.md, the no-date smoke fixture). So nothing here chooses. It lists
// every date it can read, with where it is, and the patient picks the report's date or types one.
//
// Two readings are offered rather than one guessed. "03/04/2026" is 4 March in the US and 3 April
// almost everywhere else, and the report alone does not say which. A two-digit year is not read at
// all, since "1/2/24" needs a century nobody stated. A date that is not on the calendar is skipped.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function real(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? iso(y, m, d) : null;
}

const READERS = [
  // 2026-03-14
  [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) => [real(+m[1], +m[2], +m[3])]],
  // 14/03/2026, 03/14/2026, 14.03.2026. Both readings where both are possible.
  [/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g, (m) => {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    return [...new Set([real(y, b, a), real(y, a, b)])];
  }],
  // 14 March 2026, 14th Mar. 2026, 14-Mar-2026
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+${MONTH}\\.?[\\s,-]+(\\d{4})\\b`, 'gi'),
    (m) => [real(+m[3], MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1])]],
  // March 14, 2026, Mar 14th 2026
  [new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'),
    (m) => [real(+m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2])]],
];

/**
 * Every date that can be read from the text, in order of position. Each is
 * {date: 'YYYY-MM-DD', span: [start, end], text, ambiguous}, where `ambiguous` is true when the same
 * written date has a second reading, which is listed beside it.
 */
export function findDates(text) {
  const out = [];
  const seen = new Set();
  for (const [re, read] of READERS) {
    for (const m of String(text ?? '').matchAll(re)) {
      const span = [m.index, m.index + m[0].length];
      const dates = read(m).filter(Boolean);
      for (const date of dates) {
        const key = `${date}@${span[0]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ date, span, text: m[0], ambiguous: dates.length > 1 });
      }
    }
  }
  return out.sort((x, y) => x.span[0] - y.span[0] || (x.date < y.date ? -1 : 1));
}
