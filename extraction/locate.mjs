// Location read from the finding sentence by a fixed rule, without a model.
//
// Location is the weakest field the extractor fills: about a quarter correct on the test split and a
// third on development, on the 7B and the 14B, under two prompts (RESULTS.md). It matters more than
// any other field, because anatomy and laterality are two of the four parts of the identity key. A
// larger model and a corrected instruction both failed to move it, so this tries the other direction
// the paper names: read it deterministically from the finding's own words against the vocabulary.
//
// The rule follows LABELLING.md rather than trying to be clever.
//
//   7.13  Anatomy locates the finding. It is null where the finding spans more than one structure in
//         the list. So: one structure named, that structure; more than one, null.
//   7.12  A side given for the largest of several findings is not the side of the group. So a
//         sentence about multiple findings gets no laterality unless it says bilateral.
//   R5    Absent, never invented. Every doubt returns null, which section 6 rule 3 then sends to a
//         person instead of merging on it.
//
// The terms below were written from the anatomy vocabulary and ordinary radiology usage, not from
// reading the corpus, so that measuring the rule on labelled reports is not measuring the reports it
// was fitted to.

import { ANATOMY } from './extract.mjs';

// [anatomy, pattern]. Read against lower-cased text. Lookaheads keep a structure from being named by
// a phrase that belongs to a different one: "pulmonary artery" is an artery, "hepatic flexure" is
// colon, "gall bladder" is not the urinary bladder.
const TERMS = [
  ['brain', /\bbrain\b|\bcerebr|\bcerebell|intracranial|white matter|basal ganglia|\bpons\b|midbrain|pituitary/],
  ['skull', /\bskull\b|calvari|\bcranium\b/],
  ['orbit', /\borbit/],
  ['sinus', /\bsinus(es)?\b/],
  ['thyroid', /thyroid/],
  ['salivary_gland', /parotid|submandibular gland|salivary/],
  ['neck_soft_tissue', /soft tissues? of the neck|neck soft tissue/],
  ['lung', /\blungs?\b|pulmonary (?!arter|vein|vascul|embol|valve|trunk|edema|oedema)|\b(upper|middle|lower) lobe|lingula|perihilar/],
  ['pleura', /pleura/],
  ['mediastinum', /mediastin/],
  ['heart', /\bheart\b|\bcardiac\b|pericardi|myocard|ventricle|\batri(um|al)\b|cardiomegaly/],
  ['aorta_thoracic', /thoracic aort|ascending aort|aortic arch|descending thoracic/],
  ['breast', /\bbreasts?\b|subareolar|retroareolar|mammar/],
  ['chest_wall', /chest wall/],
  ['rib', /\bribs?\b/],
  ['oesophagus', /esophag|oesophag/],
  ['liver', /\bliver\b|\bhepatic\b(?! flexure| arter| vein| duct)/],
  ['gallbladder', /gallbladder|gall bladder|cholecyst/],
  ['biliary_tract', /biliary|bile duct|\bcbd\b|choledoch|common duct/],
  ['pancreas', /pancrea/],
  ['spleen', /\bspleen\b|\bsplenic\b(?! flexure| arter| vein)/],
  ['kidney', /\bkidneys?\b|\brenal\b(?! arter| vein)/],
  ['adrenal', /adrenal/],
  ['bladder', /(?<!gall )\bbladder\b/],
  ['ureter', /\bureter/],
  ['prostate', /prostat/],
  ['uterus', /\buter(us|ine)\b|endometri|myometri|\bcervix\b|fibroid|gestational sac/],
  ['ovary', /\bovar|adnex/],
  ['stomach', /stomach|\bgastric\b/],
  ['small_bowel', /small bowel|small intestin|duoden|jejun|\bile(um|al)\b/],
  ['colon', /\bcolon|\bcolonic\b|\bc(a)?ecum\b|\bc(a)?ecal\b|sigmoid|hepatic flexure|splenic flexure/],
  ['rectum', /\brect(um|al)\b/],
  ['appendix', /append(ix|iceal)/],
  ['aorta_abdominal', /abdominal aort|infrarenal aort|suprarenal aort|\baaa\b/],
  ['peritoneum', /\bperitone|\bascites\b|\bomentum\b|\bomental\b/],
  ['retroperitoneum', /retroperitone/],
  ['spine_cervical', /cervical spine|c-spine|\bc[1-7]\b/],
  ['spine_thoracic', /thoracic spine|t-spine|\bt(1[0-2]|[1-9])\b/],
  ['spine_lumbar', /lumbar|l-spine|\bl[1-5]\b/],
  ['spine_sacral', /\bsacrum\b|\bsacral\b|(?<!l5[- /]?)\bs[1-5]\b/],
  ['pelvis', /\bpelvis\b|pelvic (bone|ring)|acetabul|\bpubic\b|ischi/],
  ['shoulder', /shoulder|glenohumeral|rotator cuff|humeral head/],
  ['hip', /\bhips?\b|femoral (head|neck)/],
  ['knee', /\bknees?\b|patell|menisc/],
  ['long_bone', /\bfemur\b|\bfemoral shaft|\btibia|\bfibula|\bhumerus\b|humeral shaft|\bradius\b|\bulna/],
  ['extremity', /\b(hand|foot|feet|ankle|wrist|elbow|finger|toe|forearm|leg)s?\b/],
  ['lymph_node', /\blymph|\bnodes?\b|adenopath/],
  ['artery', /\barter|carotid|pulmonary embol/],
  ['vein', /\bveins?\b|\bvenous\b|deep vein|\bdvt\b/],
  ['soft_tissue', /soft tissue/],
  ['skin', /\bskin\b|cutaneous/],
];

// Where one term is a specific case of another, keep the specific one. Without this, "soft tissues
// of the neck" names two structures and returns null, and so does every thoracic aortic aneurysm.
const SUBSUMES = {
  neck_soft_tissue: ['soft_tissue'],
  aorta_thoracic: ['artery'],
  aorta_abdominal: ['artery'],
};

const GROUP = /\b(multiple|several|numerous|scattered|innumerable|few)\b/;

/**
 * Anatomy and laterality for a finding, read from its sentence. Returns {anatomy, laterality}, each
 * null where the words do not settle it.
 */
export function locate(sentence) {
  if (sentence == null) return { anatomy: null, laterality: null };
  const t = String(sentence).toLowerCase();
  const found = new Set(TERMS.filter(([, re]) => re.test(t)).map(([code]) => code));
  for (const [specific, general] of Object.entries(SUBSUMES)) {
    if (found.has(specific)) for (const g of general) found.delete(g);
  }
  if (found.size !== 1) return { anatomy: null, laterality: null };
  const [anatomy] = found;
  return { anatomy, laterality: lateralityOf(t) };
}

function lateralityOf(t) {
  if (/\bbilateral|\bboth\b/.test(t)) return 'bilateral';
  const right = /\bright\b/.test(t);
  const left = /\bleft\b/.test(t);
  if (right && left) return null;
  if (GROUP.test(t)) return null;
  if (right) return 'right';
  if (left) return 'left';
  if (/\bmidline\b/.test(t)) return 'midline';
  return null;
}

// Every code the rule can return must be one the schema accepts.
for (const [code] of TERMS) {
  if (!ANATOMY.includes(code)) throw new Error(`locate.mjs names ${code}, which is not in ANATOMY`);
}
