// The prepared summary as a page to print or save as a PDF. Phase 2, stage 3.
//
// Section 9 of the specification calls the prepared summary the feature that turns knowing into
// done: the page a patient hands across a counter. obligation/summary.mjs builds it, checks it
// carries all seven required contents, and refuses to produce it if any system text interprets,
// estimates or adds urgency. This file only lays it out. It adds no words of its own to a summary,
// so everything that check guarantees holds on paper.
//
// The report's own words are set apart and marked as copied, because the person reading it at a
// desk needs to see at a glance which sentences are the clinician's and which are the app's.
//
// Conditional recommendations are not obligations and get no summary (section 3). They are listed
// after the summaries as questions, quoting the report, so the patient still has them on paper.

import { preparedSummary, EN } from '../obligation/summary.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const PAGE_COPY = {
  print: 'Print, or save as a PDF',
  copied: 'copied from my report',
  questions: 'Questions for my clinician',
  question_ask: 'My report says this depends on a condition. I am asking whether it applies to me.',
  none: 'There are no open follow-ups to print.',
};

/** One HTML page holding the prepared summary of each obligation, as of `now` (YYYY-MM-DD). */
export function summaryPage(obligations, { now, notes = [] }) {
  const blocks = obligations.map((o) => {
    const s = preparedSummary(o, { now });
    const rows = s.parts.map((p) => `
      <div class="part">
        <div class="label">${esc(p.label)}</div>
        <div class="${p.verbatim ? 'quote' : 'text'}">${p.verbatim ? `&quot;${esc(p.text)}&quot; <span class="from">(${esc(PAGE_COPY.copied)})</span>` : esc(p.text)}</div>
      </div>`).join('');
    return `<article><h1>${esc(EN.title)}</h1>${rows}</article>`;
  });
  const questions = notes.length ? `
    <article><h1>${esc(PAGE_COPY.questions)}</h1>${notes.map((n) => `
      <div class="part">
        <div class="quote">&quot;${esc(n.quote)}&quot; <span class="from">(${esc(PAGE_COPY.copied)}, report dated ${esc(n.document_date)})</span></div>
        <div class="text">${esc(PAGE_COPY.question_ask)}</div>
      </div>`).join('')}</article>` : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(EN.title)}</title>
<style>
  body { font: 15px/1.5 Georgia, "Times New Roman", serif; color: #111; margin: 24px; }
  article { max-width: 720px; margin: 0 auto 32px; page-break-after: always; }
  article:last-of-type { page-break-after: auto; }
  h1 { font: 600 20px/1.3 system-ui, "Segoe UI", Arial, sans-serif; margin: 0 0 16px; }
  .part { margin: 0 0 14px; }
  .label { font: 600 13px/1.4 system-ui, "Segoe UI", Arial, sans-serif; color: #444; text-transform: none; }
  .quote { border-left: 3px solid #999; padding: 2px 10px; }
  .from { font: 12px system-ui, "Segoe UI", Arial, sans-serif; color: #666; }
  .bar { max-width: 720px; margin: 0 auto 24px; }
  button { font: 15px system-ui, sans-serif; padding: 8px 14px; }
  @media print { .bar { display: none; } body { margin: 0; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">${esc(PAGE_COPY.print)}</button></div>
${blocks.join('\n') || `<p>${esc(PAGE_COPY.none)}</p>`}
${questions}
</body></html>
`;
}
