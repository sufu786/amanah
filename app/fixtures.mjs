// An invented report and a stubbed model, shared by the app's tests. Phase 2, stage 2.

import { validateRecommendation } from '../extraction/extract.mjs';

export const REPORT = 'EXAM DATE: 2026-03-14\n\nFINDINGS: 8 mm nodule in the right upper lobe.\n\n'
  + 'IMPRESSION: Recommend CT chest in 6 months. Correlate clinically. '
  + 'If symptoms persist, repeat radiograph. Annual screening mammography is advised.';
export const NODULE = 'Recommend CT chest in 6 months.';
export const CLINICAL = 'Correlate clinically.';
export const PERSIST = 'If symptoms persist, repeat radiograph.';

const hit = (sentence) => {
  const s = REPORT.indexOf(sentence);
  return {
    recommendation_verbatim: sentence, recommendation_span: [s, s + sentence.length], finding: 'other',
    action: 'unclear', finding_verbatim: null, finding_span: null, anatomy: null, modality: null,
    interval: null, interval_verbatim: null, conditional: false, negated: false, already_scheduled: false,
  };
};
const ANSWERS = {
  [NODULE]: {
    finding_verbatim: '8 mm nodule in the right upper lobe', finding: 'pulmonary_nodule', anatomy: 'lung',
    laterality: 'right', action: 'imaging', modality: 'CT', interval_value: 6, interval_unit: 'month',
    interval_verbatim: 'in 6 months', confidence: 0.9, conditional: false, negated: false, already_scheduled: false,
  },
  [PERSIST]: {
    finding_verbatim: null, finding: 'other', anatomy: null, laterality: null, action: 'imaging',
    modality: 'radiograph', interval_value: null, interval_unit: null, interval_verbatim: null, confidence: 0.7,
    conditional: true, condition_verbatim: 'If symptoms persist', negated: false, already_scheduled: false,
  },
};
export const stages = {
  detect: async () => ({ hits: [hit(NODULE), hit(CLINICAL), hit(PERSIST)], asked: 7 }),
  verify: async (_t, s) => s !== CLINICAL,
  fill: async (t, s) => validateRecommendation({ ...ANSWERS[s], recommendation_verbatim: s }, t),
};

/**
 * A small PDF built in code, one array of lines per page, set in Helvetica. Real PDFs are never
 * committed (.gitignore, constraint C5), and a page with no lines stands in for a scan: no text in it.
 */
export function makePdf(pages) {
  const bodies = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    3: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };
  const kids = [];
  let next = 4;
  for (const lines of pages) {
    const page = next++;
    const content = next++;
    kids.push(page);
    // PDF string syntax: parentheses and backslashes inside (...) are escaped with a backslash.
    const ops = lines.map((l, i) => `BT /F1 11 Tf 72 ${760 - i * 16} Td (${l.replace(/[()\\]/g, (m) => `\\${m}`)}) Tj ET`).join('\n');
    bodies[content] = `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`;
    bodies[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`;
  }
  bodies[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < next; i++) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${bodies[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${next}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
    + `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
