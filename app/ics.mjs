// A calendar file for each due date. Phase 2, stage 3.
//
// The app has no server to send reminders from, and is not meant to: constraint C5, and nothing
// leaves the machine. The patient's own calendar already reminds them of things, on every device
// they own, so a due date goes there as an ordinary all-day event, with a reminder at the point the
// ladder's first rung falls (section 8, L1: thirty days before).
//
// An obligation with no due date gets no event. Inventing a date to put in a calendar would be the
// thing R6 forbids, so the app says the report did not give one instead.
//
// RFC 5545 asks for three things that are easy to get wrong: CRLF line endings, text escaping for
// backslash, semicolon, comma and newline, and lines folded at 75 octets. Calendar programs are
// forgiving about some of these and silently drop events over others.

import { DEFAULT_INTERVALS } from '../obligation/escalation.mjs';

const escape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let width = 75;
  while (start < bytes.length) {
    let end = Math.min(start + width, bytes.length);
    // Never split a multi-byte character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    width = 74; // continuation lines start with a space
  }
  return out.join('\r\n ');
}

const day = (iso) => iso.replace(/-/g, '');
const nextDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/**
 * A VCALENDAR with one all-day event for each obligation that has a due date. `stamp` is the
 * creation time, injected. Returns null when none of them has a due date.
 */
export function calendarFor(obligations, { stamp }) {
  const dated = obligations.filter((o) => o.due_date);
  if (!dated.length) return null;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Amanah//Portable Clinical Obligation//EN', 'CALSCALE:GREGORIAN',
  ];
  const remindDays = -DEFAULT_INTERVALS.L1;
  for (const o of dated) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${o.id}@amanah.local`,
      `DTSTAMP:${stamp.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      `DTSTART;VALUE=DATE:${day(o.due_date)}`,
      `DTEND;VALUE=DATE:${day(nextDay(o.due_date))}`,
      `SUMMARY:${escape('Follow-up due (from your report)')}`,
      `DESCRIPTION:${escape(`Your report dated ${o.source.document_date} says: "${o.recommendation.text_verbatim}"\nCheck that this has been arranged.`)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escape('Follow-up from your report is due in 30 days. Check that it has been arranged.')}`,
      `TRIGGER:-P${remindDays}D`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
