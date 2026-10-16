// Five invented reports, and what a careful patient would do with each. Phase 2, in place of the
// volunteer test (PHASE2_SAFETY.md section 3).
//
// Every report here was written for this file. None comes from MIMIC or any other real record, and
// any resemblance to a real patient is accidental. They are the five the volunteer protocol names,
// so that the same reports can be used if the protocol is ever run with people.
//
// `recommendations` is the answer key: every sentence in the report that asks for something, with
// the details a careful reader would give it. The run uses it to answer as that reader would, and to
// record what the app found, missed and filled in, which is the model's side of the result.

export const SCENARIOS = [
  {
    id: 1,
    purpose: 'One recommendation with a stated interval.',
    report_date: '2026-02-10',
    study: { modality_code: 'ct', region: 'chest' },
    text: [
      'EXAMINATION: CT CHEST WITHOUT CONTRAST',
      'DATE OF EXAMINATION: 10 February 2026',
      'INDICATION: Chronic cough for three months.',
      '',
      'FINDINGS: There is a 7 mm solid nodule in the left lower lobe. No pleural effusion. The heart is',
      'normal in size. No enlarged lymph nodes.',
      '',
      'IMPRESSION: 7 mm solid nodule in the left lower lobe. Recommend CT chest in 3 months.',
    ].join('\n'),
    recommendations: [
      { quote: 'Recommend CT chest in 3 months.', details: { action: 'imaging', modality: 'CT', interval: { value: 3, unit: 'month' } }, due: '2026-05-10' },
    ],
  },
  {
    id: 2,
    purpose: 'Two recommendations, one written so that it is easy to miss, to see whether it is found.',
    report_date: '2026-03-03',
    study: { modality_code: 'ct', region: 'abdomen_pelvis' },
    text: [
      'EXAMINATION: CT ABDOMEN AND PELVIS WITH CONTRAST',
      'DATE OF EXAMINATION: 3 March 2026',
      'INDICATION: Right sided abdominal pain.',
      '',
      'FINDINGS: A 1.4 cm low density lesion in segment 6 of the liver is too small to characterise.',
      'On the lowest images there is an incidental 2 cm nodule in the right lobe of the thyroid, and a',
      'dedicated thyroid ultrasound would be appropriate. The kidneys and adrenal glands are normal. The',
      'appendix is normal.',
      '',
      'IMPRESSION:',
      '1. Indeterminate 1.4 cm liver lesion. MRI of the liver in 6 months is suggested.',
      '2. Thyroid nodule, as above.',
    ].join('\n'),
    recommendations: [
      { quote: 'MRI of the liver in 6 months is suggested.', details: { action: 'imaging', modality: 'MRI', interval: { value: 6, unit: 'month' } }, due: '2026-09-03' },
      { quote: 'a\ndedicated thyroid ultrasound would be appropriate', details: { action: 'imaging', modality: 'ultrasound', interval: null }, due: null },
    ],
  },
  {
    id: 3,
    purpose: 'A report whose first date is a date of birth.',
    report_date: '2026-04-15',
    decoy_date: '1958-07-22',
    study: { modality_code: 'ultrasound', region: 'abdomen_pelvis' },
    text: [
      'PATIENT DATE OF BIRTH: 22/07/1958',
      'EXAMINATION: ULTRASOUND ABDOMEN',
      'DATE OF EXAMINATION: 15 April 2026',
      'INDICATION: Abnormal liver blood tests.',
      '',
      'FINDINGS: The liver is normal in size and echotexture. There is a 6 mm polyp in the gallbladder',
      'with no stones. The bile ducts are not dilated. Both kidneys are normal.',
      '',
      'IMPRESSION: 6 mm gallbladder polyp. Repeat ultrasound in 12 months.',
    ].join('\n'),
    recommendations: [
      { quote: 'Repeat ultrasound in 12 months.', details: { action: 'imaging', modality: 'ultrasound', interval: { value: 12, unit: 'month' } }, due: '2027-04-15' },
    ],
  },
  {
    id: 4,
    purpose: 'A conditional recommendation, and one that opens with "not needed" but does ask for something.',
    report_date: '2026-05-20',
    study: { modality_code: 'radiograph', region: 'chest' },
    text: [
      'EXAMINATION: CHEST RADIOGRAPH',
      'DATE OF EXAMINATION: 20 May 2026',
      'INDICATION: Fever and cough.',
      '',
      'FINDINGS: Patchy opacity in the right lower zone. No pleural effusion. Heart size normal.',
      '',
      'IMPRESSION: Right lower lobe pneumonia. If symptoms do not settle with treatment, a repeat chest',
      'radiograph is advised. No CT is required at this stage, but a follow-up chest radiograph in 8 weeks',
      'is recommended to confirm resolution.',
    ].join('\n'),
    recommendations: [
      { quote: 'If symptoms do not settle with treatment, a repeat chest\nradiograph is advised.', conditional: true, details: { action: 'imaging', modality: 'radiograph', interval: null }, due: null },
      { quote: 'a follow-up chest radiograph in 8 weeks\nis recommended to confirm resolution.', details: { action: 'imaging', modality: 'radiograph', interval: { value: 8, unit: 'week' } }, due: '2026-07-15' },
    ],
  },
  {
    id: 5,
    purpose: 'A later report that is the follow-up for report 1, and a scanned PDF.',
    report_date: '2026-05-12',
    study: { modality_code: 'ct', region: 'chest' },
    follow_up_of: 1,
    text: [
      'EXAMINATION: CT CHEST WITHOUT CONTRAST',
      'DATE OF EXAMINATION: 12 May 2026',
      'INDICATION: Follow-up of lung nodule.',
      'COMPARISON: CT chest 10 February 2026.',
      '',
      'FINDINGS: The 7 mm solid nodule in the left lower lobe is unchanged. No new nodules. No pleural',
      'effusion.',
      '',
      'IMPRESSION: Stable 7 mm left lower lobe nodule.',
    ].join('\n'),
    recommendations: [],
  },
];
