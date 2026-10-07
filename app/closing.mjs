// Closing a follow-up: a later report that may be it, or the patient saying it was done. Phase 2,
// stage 4.
//
// Closure is the dangerous direction (specification section 4.5): a wrong closure discharges a real
// duty silently. So in this app nothing closes on its own, not even a later report that matches on
// every condition section 4.5 checks. A match is a question the patient answers, and only their yes
// closes anything.
//
// A later report becomes a study: its date, its modality code (section 7.1) and the body region it
// covers. The patient supplies the code and the region, the code prefilled from the report's own
// opening words, because the app has no imaging system to read DICOM from. closureProposal then
// judges every saved study against every open follow-up, one question per follow-up however many
// studies there are, and never offers a study the patient has already said is not it.
//
// A report never answers for the follow-ups it created. Same-day studies would only be proposed
// anyway, but a report cannot be its own follow-up and the patient should not be asked.

import { transition, closureProposal, TERMINAL_STATES } from '../obligation/obligation.mjs';
import { modalityCode, MODALITIES } from '../obligation/modality.mjs';

// The body regions a patient chooses from, and the anatomy each covers. The same grouping the MIMIC
// retrospective run used to read exam names, now offered to the patient to choose from.
export const REGIONS = {
  head: ['brain', 'skull', 'orbit', 'sinus'],
  neck: ['thyroid', 'neck_soft_tissue', 'salivary_gland'],
  chest: ['lung', 'pleura', 'mediastinum', 'heart', 'rib', 'chest_wall', 'aorta_thoracic', 'oesophagus'],
  breast: ['breast'],
  abdomen_pelvis: ['liver', 'gallbladder', 'biliary_tract', 'pancreas', 'spleen', 'kidney', 'adrenal', 'bladder',
    'ureter', 'prostate', 'uterus', 'ovary', 'stomach', 'small_bowel', 'colon', 'rectum', 'appendix',
    'aorta_abdominal', 'peritoneum', 'retroperitoneum', 'pelvis'],
  spine: ['spine_cervical', 'spine_thoracic', 'spine_lumbar', 'spine_sacral'],
  arms_legs: ['shoulder', 'hip', 'knee', 'long_bone', 'extremity'],
};

/** A modality code read from the first words of a report, where the examination is usually named. */
export function guessKind(text) {
  const code = modalityCode(String(text ?? '').slice(0, 300));
  return code === 'other' ? null : code;
}

/** A saved study, from what the patient said about a report. No report text is kept. */
export function studyRecord({ id, date, modality_code = null, region = null }) {
  if (modality_code !== null && !MODALITIES.includes(modality_code)) throw new Error('unknown kind of test');
  if (region !== null && !REGIONS[region]) throw new Error('unknown body region');
  return { id, date, modality_code, region };
}

const asStudy = (s) => ({
  id: s.id,
  date: s.date,
  modality_codes: s.modality_code ? [s.modality_code] : [],
  anatomy_covered: s.region ? REGIONS[s.region] : null,
});

/**
 * One question per open follow-up that a saved study may answer. `store` holds obligations, studies,
 * origins (obligation id to the study id of the report it came from) and rejections (obligation id
 * to the study ids the patient said were not it).
 */
export function pendingClosures(store) {
  const out = [];
  for (const ob of store.obligations) {
    if (TERMINAL_STATES.includes(ob.state)) continue;
    const own = store.origins?.[ob.id];
    const studies = (store.studies ?? []).filter((s) => s.id !== own).map(asStudy);
    const d = closureProposal(ob, studies, { rejected: store.rejections?.[ob.id] ?? [] });
    if (d.decision === 'none') continue;
    // A full match is still a question here; only how it is put changes.
    const candidates = d.decision === 'close'
      ? [{ study: d.study, reasons: [] }]
      : d.studies;
    out.push({
      obligation_id: ob.id,
      quote: ob.recommendation.text_verbatim,
      document_date: ob.source.document_date,
      every_condition_holds: d.decision === 'close',
      candidates: candidates.map((c) => {
        const saved = store.studies.find((s) => s.id === c.study.id);
        return { study_id: c.study.id, date: c.study.date, modality_code: saved.modality_code, region: saved.region, reasons: c.reasons };
      }),
    });
  }
  return out;
}

// Walk the permitted path (section 3): acknowledged, scheduled, completed, resolved. Steps the patient
// did not report separately are recorded together, and marked so, rather than skipped.
function walkToResolved(ob, { actor, at, evidence }) {
  let o = ob;
  if (o.state === 'acknowledged') o = transition(o, { to: 'scheduled', actor, at, detail: { recorded_together: true } });
  if (o.state === 'scheduled') o = transition(o, { to: 'completed', actor, at, detail: { recorded_together: true } });
  return transition(o, { to: 'resolved', actor, at, evidence });
}

/** The patient confirms that a saved later report is the follow-up. */
export function closeByReport(ob, study, { actor, at }) {
  return walkToResolved(ob, {
    actor, at,
    evidence: {
      type: 'matching_study',
      study_id: study.id,
      study_date: study.date,
      modality_code: study.modality_code,
      source: 'patient_upload',
      confirmed_by_patient: true,
    },
  });
}

/** The patient says the follow-up was done, with no report of it. The lowest tier, and marked so. */
export function closeByWord(ob, { actor, at, date_done = null }) {
  if (date_done !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date_done)) throw new Error('the date it was done must be a date');
  return walkToResolved(ob, { actor, at, evidence: { type: 'patient_attestation', date_done } });
}

/** The patient says it has been booked. */
export function markBooked(ob, { actor, at }) {
  return transition(ob, { to: 'scheduled', actor, at });
}

// Written out in full, as everywhere else the patient reads a date.
const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** How a closed follow-up was closed, in words for the patient. */
export function closedHow(ob) {
  const e = ob.closure?.evidence;
  if (!e) return ob.closure?.reason ? 'Closed.' : null;
  if (e.type === 'matching_study') return `Closed: you confirmed a later report, dated ${longDate(e.study_date)}, was this follow-up.`;
  if (e.type === 'patient_attestation') return `Closed: you said this was done${e.date_done ? ` on ${longDate(e.date_done)}` : ''}. Recorded as your own word, with no report of it.`;
  return 'Closed.';
}
