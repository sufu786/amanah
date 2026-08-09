// Locale packs. Section 10 of OBLIGATION_SPEC.md.
//
// The README calls these the most valuable contribution anyone can make, which means they arrive
// from people this project has never met, in languages nobody here reads. That single fact decides
// the design: a pack is untrusted input, and the checks have to be mechanical, because no reviewer
// can eyeball Hausa safety copy and know it does not interpret a finding.
//
// GRACEFUL DEGRADATION IS MANDATORY
//
// Section 10: with no matching pack the system falls back to the nearest language, marks
// extraction_validated false, omits signposting, and continues to provide extraction,
// verification, tracking, reminders and the prepared summary. No user is ever blocked pending
// support for their country.
//
// So resolve() never fails to return a usable pack. The worst case is English with a flag set, and
// the flag changes the interface rather than switching anything off. A person in a country with no
// pack still gets a printable page in a language they may not read perfectly, next to verbatim
// quotes from their own report which they do read. That is the C3 bargain, and it is why partial
// support is worth shipping.

import { EN, findForbiddenLanguage } from './summary.mjs';
import { DEFAULT_INTERVALS, LEVELS } from './escalation.mjs';

const REQUIRED_COPY_KEYS = Object.keys(EN).filter((k) => k !== 'locale');

/**
 * Validate a pack. Returns {ok, errors, warnings}.
 *
 * Errors block registration. Warnings do not, because section 10 is explicit that partial support
 * is better than none, and a pack missing signposting is still worth having.
 */
export function validatePack(pack) {
  const errors = [];
  const warnings = [];

  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['pack must be an object'], warnings };
  if (!pack.locale || !/^[a-z]{2}(-[A-Z]{2})?$/.test(pack.locale)) {
    errors.push(`locale must look like "en" or "en-NG", got ${JSON.stringify(pack.locale)}`);
  }
  if (!pack.language || !/^[a-z]{2}$/.test(pack.language)) {
    errors.push(`language must be a two-letter code, got ${JSON.stringify(pack.language)}`);
  }
  if (!pack.version) errors.push('version is required; copy changes and packs need to be pinnable');

  // Missing copy is a warning, not an error. The gaps fall back to English, which is degradation
  // rather than failure, and a half-translated pack still helps the people it covers.
  const copy = pack.copy ?? {};
  const missing = REQUIRED_COPY_KEYS.filter((k) => !copy[k]);
  if (missing.length === REQUIRED_COPY_KEYS.length) errors.push('copy is empty; the pack translates nothing');
  else if (missing.length) warnings.push(`${missing.length} copy strings fall back to English: ${missing.join(', ')}`);

  // The check that matters. Every user-facing string in a pack is the system speaking, so it is
  // held to the same standard as the English, and a contributor cannot introduce interpretation,
  // risk language or added urgency through a translation.
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value !== 'string') continue;
    for (const v of findForbiddenLanguage(value)) {
      errors.push(`copy.${key} ${v.why}: "${v.term}"`);
    }
  }
  for (const [key, value] of Object.entries(pack.signposting ?? {})) {
    for (const v of findForbiddenLanguage(String(value))) {
      errors.push(`signposting.${key} ${v.why}: "${v.term}"`);
    }
  }

  // Section 8: intervals are configurable, the ladder structure is not.
  const intervals = pack.escalation_intervals;
  if (intervals) {
    const keys = Object.keys(intervals);
    const expected = LEVELS.filter((l) => l !== 'L0');
    if (keys.length !== expected.length || !expected.every((k) => k in intervals)) {
      errors.push(`escalation_intervals must define exactly ${expected.join(', ')}. `
        + 'The ladder structure is not configurable (section 8).');
    } else {
      const ordered = expected.map((k) => intervals[k]);
      if (!ordered.every((v, i) => i === 0 || v > ordered[i - 1])) {
        errors.push('escalation_intervals must increase; a ladder that goes backwards cannot escalate');
      }
    }
  }

  if (pack.extraction_validated === true) {
    // Nothing in this repository has measured extraction for any language, English included.
    // A pack asserting otherwise is claiming evidence that does not exist.
    warnings.push('extraction_validated is true. No language has measured recall in this repository '
      + 'yet, so this claim needs a published measurement behind it or it should be false.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Resolve the pack to use for a requested locale.
 *
 * Never fails. Falls back by language, then to English, and always reports what happened so the
 * interface can say so rather than pretend it had full support.
 */
export function resolvePack(requested, packs = []) {
  const usable = packs.filter((p) => validatePack(p).ok);
  const notes = [];

  let chosen = usable.find((p) => p.locale === requested);
  let match = 'exact';

  if (!chosen && typeof requested === 'string') {
    const lang = requested.split('-')[0];
    chosen = usable.find((p) => p.language === lang);
    if (chosen) {
      match = 'language';
      notes.push(`no pack for ${requested}; using the nearest language pack ${chosen.locale}`);
    }
  }

  if (!chosen) {
    match = 'fallback';
    notes.push(`no pack for ${requested}; falling back to English. Extraction, verification, `
      + 'tracking, reminders and the prepared summary all still work.');
    chosen = { locale: 'en', language: 'en', version: '0', copy: {}, extraction_validated: false };
  }

  // Missing strings fall through to English rather than rendering blank.
  const copy = { ...EN, ...chosen.copy, locale: chosen.locale };

  return {
    locale: chosen.locale,
    language: chosen.language,
    version: chosen.version,
    match,
    copy,
    // Section 10: signposting is omitted rather than guessed when there is no pack for the country.
    signposting: match === 'exact' ? (chosen.signposting ?? {}) : {},
    signposting_omitted: match !== 'exact',
    escalation_intervals: chosen.escalation_intervals ?? DEFAULT_INTERVALS,
    guideline_overrides: chosen.guideline_overrides ?? {},
    date_format: chosen.date_format ?? 'YYYY-MM-DD',
    channels: chosen.channels ?? ['sms'],
    // C3. False here does not block anything. It changes what the interface says.
    extraction_validated: chosen.extraction_validated === true,
    notes,
  };
}

/**
 * Signposting for a finding category, where the pack has it.
 *
 * Returns null rather than a guess. Section 10 omits signposting when there is no pack, and a
 * wrong address for a TB clinic is worse than no address: it sends someone on a journey they may
 * not be able to afford twice.
 */
export function signpostFor(resolved, category) {
  return resolved.signposting?.[category] ?? null;
}
