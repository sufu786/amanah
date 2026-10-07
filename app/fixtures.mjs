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
