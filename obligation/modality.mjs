// Specification v0.6, section 7. The modality vocabulary.
//
// Until v0.6 a recommended modality was free text, and section 4.5 compared it with a study's
// modality by matching words. That fails both ways. "MRI" and "MR" share no word, so a real
// follow-up MR was judged not evidence and never offered to anyone. "CT" is a word of "PET-CT", so a
// plain CT could count as the PET-CT that was asked for. Run against the MIMIC retrospective records
// with studies named the way imaging systems name them, the word match lost four of six automatic
// closures and accepted studies of the wrong modality (section 12.1 I).
//
// So the obligation carries a code from a closed list beside the report's own words, the way a
// finding carries a category beside its quote, and an automatic match compares codes only. The list
// follows the DICOM acquisition modalities (CID 29) because that is what an imaging system or a FHIR
// ImagingStudy reports for a study, and a crosswalk is only worth having if one side of it is
// already standard.
//
// Everything here is deterministic. A code that cannot be read from the words is null, or `other`
// when a test is named but is outside the list, and both mean "cannot be compared", which section
// 4.5 turns into a person deciding. Nothing here is ever a reason to close.

export const MODALITIES = [
  'radiograph', 'ct', 'mr', 'ultrasound', 'mammography', 'pet', 'nuclear_medicine', 'fluoroscopy',
  'angiography', 'bone_densitometry', 'endoscopy', 'other',
];
export const OTHER_MODALITY = 'other';

// DICOM PS3.16 CID 29 codes, to the vocabulary. CR and DX are both plain radiography.
export const DICOM_MODALITY = Object.freeze({
  CR: 'radiograph', DX: 'radiograph', CT: 'ct', MR: 'mr', US: 'ultrasound', MG: 'mammography',
  PT: 'pet', NM: 'nuclear_medicine', RF: 'fluoroscopy', XA: 'angiography', BMD: 'bone_densitometry',
  ES: 'endoscopy',
});

// Read against lower-cased text. Where the words name more than one, the one named first wins, which
// is the rule LABELLING.md 7.24 already applies to alternatives and which also reads composite names
// correctly: "PET-CT" asks for a PET, "CT angiography" for a CT, "MR arthrogram" for an MR.
const PATTERNS = [
  ['pet', /\bpet\b/],
  ['mammography', /mammo|tomosynth/],
  ['ct', /\bct[au]?\b|computed tomograph|\bcat scan/],
  ['mr', /\bmr[ia]?\b|\bmrcp\b|magnetic resonance/],
  ['ultrasound', /ultraso|sonogra|\bus\b|\bu\/s\b|doppler|duplex|\becho/],
  ['radiograph', /radiograph|x-?ray|\bfilms?\b|\bcxr\b|\bkub\b/],
  ['nuclear_medicine', /nuclear|scintigra|bone scan|\bhida\b|\bmag-?3\b|\bv\/?q\b|sestamibi|\bspect\b/],
  ['fluoroscopy', /fluoro|barium|swallow|o?esophagra|\bugi\b|upper gi|enema|cystogra|myelogra|arthrogra/],
  ['angiography', /angiogra|\bangio\b|venogra|arteriogra/],
  ['bone_densitometry', /\bdexa\b|\bdxa\b|densitometr|bone density/],
  ['endoscopy', /endoscop|colonoscop|bronchoscop|gastroscop|cystoscop|sigmoidoscop|\begd\b/],
];

const EMPTY = /^\s*(none|n\/a|null)?\s*$/i;

/**
 * The code for a modality written in words, or null when no test is named. A test named but outside
 * the list is `other`, never a guess at the nearest code.
 */
export function modalityCode(text) {
  if (text == null || EMPTY.test(String(text))) return null;
  const t = String(text).toLowerCase();
  let best = null;
  for (const [code, re] of PATTERNS) {
    const m = re.exec(t);
    if (m && (best === null || m.index < best.index)) best = { code, index: m.index };
  }
  return best ? best.code : OTHER_MODALITY;
}

// Words that ask for something finer than a modality code can confirm: a contrast phase, a vessel
// study, a guided procedure, a diagnostic rather than a screening mammogram, a cardiac echo. A study of
// the right modality may still not be what was asked for, so section 4.5 never closes on it.
const PROTOCOL = /angi|\bcta\b|\bmra\b|mrcp|phas|contrast|enhanc|perfusion|dynamic|doppler|duplex|guided|elastogra|spectroscop|diffusion|cholangio|urogra|\bctu\b|enterogra|colonogra|arthrogra|diagnostic|spot|magnif|\becho/;

/** True when the recommended modality names a protocol that a modality code cannot confirm. */
export function protocolNamed(text) {
  return text != null && PROTOCOL.test(String(text).toLowerCase());
}

/**
 * A study's codes, from the DICOM modalities an imaging system reports for it. A code outside the
 * crosswalk becomes `other`, so the study can still be proposed but never matched automatically.
 */
export function studyModalityCodes(dicomModalities) {
  if (!Array.isArray(dicomModalities)) return [];
  return [...new Set(dicomModalities.map((m) => DICOM_MODALITY[String(m).trim().toUpperCase()] ?? OTHER_MODALITY))];
}
