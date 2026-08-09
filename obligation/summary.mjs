// The prepared summary. Section 9 of OBLIGATION_SPEC.md.
//
// The specification calls this "the single feature that converts knowing into done". It is the
// page a patient hands across a counter, so it is the only part of the system most people will
// ever read, and it is where the non-interpretive guarantee either holds or fails in public.
//
// Section 9 lists seven required contents and three prohibited ones. Both are enforced here.
//
// HOW THE PROHIBITION IS ENFORCED, AND WHY IT IS DONE THIS WAY
//
// The prohibited contents are "any statement of what the finding might mean, any risk estimate,
// and any urgency language not present in the source report". That last clause is the difficult
// one. A report that says "urgent" must be reproduced saying "urgent"; a summary that adds it is
// a safety defect. So a plain word blocklist over the finished page cannot work: it would either
// reject the clinician's own words or permit the system's.
//
// Instead the summary is built as parts, each marked with where its words came from. Text quoted
// from the report is never scanned, because the clinician's words are not ours to censor. Text the
// system produced is always scanned. A violation throws rather than warns, because a summary that
// interprets is not a degraded summary, it is the thing this system promises not to do.
//
// There is a third origin, and it was not in the first draft. A guideline citation is neither the
// report nor the system: it names an external published rule, which R6 requires. The check found
// this itself, by refusing to print the Fleischner rule "solid_nodule_6to8mm_low_risk" on the
// grounds that it contained the word risk. Naming a rule is not estimating one.
//
// This also makes locale packs safe to accept from contributors (section 10): translated copy is
// system text, so it goes through the same check as the English does.

const REQUIRED_PARTS = [
  'finding', 'recommendation', 'source', 'due', 'guideline', 'ask', 'verification',
];

// Scanned in generated text only. Grouped because the reason each is forbidden differs, and the
// error message should say which promise is being broken.
const FORBIDDEN_LEXICON = {
  'states what the finding might mean': [
    'cancer', 'malignant', 'benign', 'tumour', 'tumor', 'metastasis', 'metastatic',
    'suspicious', 'concerning', 'worrying', 'serious', 'severe', 'significant',
    'harmless', 'nothing to worry',
  ],
  'estimates risk': [
    'risk', 'chance', 'probability', 'likelihood', 'likely', 'unlikely', 'odds',
    'percent', 'per cent',
  ],
  'adds urgency not in the source': [
    'urgent', 'urgently', 'emergency', 'immediately', 'critical', 'as soon as possible',
    'right away', 'without delay',
  ],
  'implies an all-clear': [
    'all clear', 'all-clear', 'reassuring', 'no cause for concern', 'you are fine',
    'nothing found', 'everything is normal',
  ],
};

/** Default English copy. A locale pack (section 10) replaces this wholesale. */
export const EN = {
  locale: 'en',
  title: 'Follow-up that was recommended for me',
  finding_label: 'What my report says was found',
  recommendation_label: 'What my report says should happen next',
  source_label: 'Where this comes from',
  due_label: 'Date this was due',
  guideline_label: 'Guideline referenced',
  ask_label: 'What I am asking',
  // Section 9 item 6 requires the request be phrased as an ask. This exact sentence is the one
  // the specification gives.
  ask: 'I am asking whether this follow-up has been arranged.',
  verification_label: 'About this page',
  verified_yes: 'I have checked these details against my own report.',
  verified_no: 'I have not yet checked these details against my report.',
  language_validated_no:
    'The wording above was copied straight from my report. Automatic reading of reports has not '
    + 'been checked for this language.',
  overdue_suffix: 'days past that date',
  no_due_date:
    'My report did not say when this should happen, so there is no date here. The wording above '
    + 'is copied from the report.',
  no_guideline: 'None referenced',
  document_date_label: 'Report dated',
};

const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Whole days from `from` to `to`, both YYYY-MM-DD, in UTC. Negative when `to` is earlier. */
export function daysBetween(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error('daysBetween needs two YYYY-MM-DD dates');
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * Scan generated text for language the summary is not permitted to use.
 * Returns a list of violations; empty means clean.
 */
export function findForbiddenLanguage(text) {
  const hay = ` ${String(text).toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  const found = [];
  for (const [why, terms] of Object.entries(FORBIDDEN_LEXICON)) {
    for (const term of terms) {
      if (hay.includes(` ${term} `)) found.push({ term, why });
    }
  }
  return found;
}

/**
 * Build the prepared summary for an obligation.
 *
 * `now` is injected, like everywhere else in this layer, because "how many days overdue" is the
 * one number on the page that depends on the clock and it must be reproducible.
 */
export function preparedSummary(obligation, { now, copy = EN } = {}) {
  if (!isIsoDate(now)) throw new Error('now must be a YYYY-MM-DD date, injected by the caller');

  const parts = [];
  // `origin` decides whether the text is scanned, and the three values are not interchangeable.
  //
  //   report     the patient's own document. Never scanned: the clinician's words are not ours to
  //              censor, and section 9 forbids urgency the system ADDS, not urgency it reproduces.
  //   guideline  a citation to an external published standard. Never scanned either, for a reason
  //              found by this check firing on real data: the Fleischner rule identifier is
  //              "solid_nodule_6to8mm_low_risk", and R6 requires the rule be named. Naming a rule
  //              that has "risk" in its identifier is not estimating risk. Refusing to print it
  //              would break R6 to satisfy a word match.
  //   system     the system speaking, including every string from a locale pack. Always scanned.
  //
  // Labels are system copy in all three cases, so labels are always scanned.
  const add = (id, label, text, origin) => parts.push({ id, label, text, origin, verbatim: origin === 'report' });

  // 1 and 2. Quoted verbatim from the patient's own report. Never scanned, never reworded.
  add('finding', copy.finding_label, obligation.finding.text_verbatim, 'report');
  add('recommendation', copy.recommendation_label, obligation.recommendation.text_verbatim, 'report');

  // 3. The source: document date and locator.
  const locator = obligation.source.locator ? `, ${obligation.source.locator}` : '';
  add('source', copy.source_label, `${copy.document_date_label} ${obligation.source.document_date}${locator}`, 'system');

  // 4. The due date, and how many days overdue if applicable.
  if (obligation.due_date) {
    const overdueBy = daysBetween(obligation.due_date, now);
    const suffix = overdueBy > 0 ? ` (${overdueBy} ${copy.overdue_suffix})` : '';
    add('due', copy.due_label, `${obligation.due_date}${suffix}`, 'system');
  } else {
    // R6 and section 7: an obligation with no stated interval has no due date, and the summary
    // says so rather than inventing one or quietly omitting the line.
    add('due', copy.due_label, copy.no_due_date, 'system');
  }

  // 5. The guideline reference and version, where one applies.
  const g = obligation.recommendation.guideline;
  add('guideline', copy.guideline_label,
    g ? `${g.id} ${g.version}${g.rule ? ` (${g.rule})` : ''}` : copy.no_guideline, g ? 'guideline' : 'system');

  // 6. The specific request, phrased as an ask.
  add('ask', copy.ask_label, copy.ask, 'system');

  // 7. Verification status: patient-confirmed, and whether extraction is validated for the
  // language. Section 11.5 requires both be surfaced rather than hidden.
  const lines = [
    obligation.extraction.patient_verified ? copy.verified_yes : copy.verified_no,
  ];
  if (!obligation.extraction.language_validated) lines.push(copy.language_validated_no);
  add('verification', copy.verification_label, lines.join(' '), 'system');

  const missing = REQUIRED_PARTS.filter((id) => !parts.some((p) => p.id === id));
  if (missing.length) throw new Error(`prepared summary missing required contents: ${missing.join(', ')}`);

  // The check. Generated parts only; the report's own words are the patient's, not ours.
  const violations = [];
  for (const p of parts) {
    // The label is system copy whatever the text is, so it is always scanned.
    const scanned = p.origin === 'system' ? `${p.label} ${p.text}` : p.label;
    for (const v of findForbiddenLanguage(scanned)) {
      violations.push({ part: p.id, ...v });
    }
  }
  if (violations.length) {
    throw new Error(
      'prepared summary contains language section 9 prohibits:\n'
      + violations.map((v) => `  [${v.part}] "${v.term}" ${v.why}`).join('\n')
      + '\nThis is a safety defect, not a formatting problem. Verbatim quotes from the report are '
      + 'exempt; this text was generated by the system or came from a locale pack.',
    );
  }

  // Rendered with a blank line between sections. This is printed and handed to a receptionist or
  // a nurse who is reading it in a few seconds, standing up, with a queue behind. Dense text gets
  // skimmed and the ask gets missed.
  const text = [
    copy.title,
    ...parts.map((p) => `${p.label}:\n  ${p.text}`),
  ].join('\n\n');

  return { locale: copy.locale, parts, text };
}
