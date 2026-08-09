// The extractor to registry seam, and locale packs. Sections 10, plus C2, C3 and C6.
//
//   node --test obligation/integration.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  proposalsFromExtraction, acceptProposal, NOTHING_FOUND_NOTICE,
} from './from-extraction.mjs';
import { validatePack, resolvePack, signpostFor } from './locale.mjs';
import { preparedSummary } from './summary.mjs';
import { escalationLevel } from './escalation.mjs';

const PATIENT = { kind: 'patient', ref: 'local-1' };
const makeId = (i) => `ob-${i}`;

/** A realistic extract.mjs result. */
const extraction = (over = {}) => ({
  document: { date_found: '2026-03-14', date_span: [40, 50], language: 'en', modality_of_document: null },
  recommendations: [{
    finding_verbatim: '8 mm right upper lobe nodule',
    finding_span: [120, 148],
    recommendation_verbatim: 'Recommend CT follow-up in 6 months.',
    recommendation_span: [150, 185],
    finding: 'pulmonary_nodule',
    anatomy: null,
    laterality: null,
    measurement: null,
    action: 'imaging',
    modality: 'CT',
    interval: { value: 6, unit: 'month' },
    interval_verbatim: 'in 6 months',
    urgency_verbatim: null,
    confidence: 0.93,
    conditional: false,
    condition_verbatim: null,
    already_scheduled: false,
    negated: false,
  }],
  extraction: {
    model: 'qwen2.5:7b', prompt_version: '0.1', language_validated: false,
    no_recommendation_found: false, unparseable: false,
  },
  rejected: [],
  ...over,
});

const run = (result, over = {}) => proposalsFromExtraction(result, {
  subject_ref: 'opaque-local-1', threshold: 0.7, makeId, locator: 'page 2, impression', ...over,
});

describe('C6  nothing is silently accepted or silently dropped', () => {
  test('everything the extractor returned is accounted for', () => {
    const r = run(extraction({
      recommendations: [
        { ...extraction().recommendations[0], confidence: 0.93 },
        { ...extraction().recommendations[0], confidence: 0.20 },
        { ...extraction().recommendations[0], negated: true },
        { ...extraction().recommendations[0], conditional: true },
      ],
    }));
    const total = r.proposals.length + r.review_queue.length + r.blocked.length + r.not_indicated_evidence.length;
    assert.equal(total, 4, 'every recommendation lands in exactly one bucket');
    assert.equal(r.proposals.length, 2, 'the confident one and the conditional one, the latter flagged');
    assert.equal(r.review_queue.length, 1);
    assert.equal(r.not_indicated_evidence.length, 1);
  });

  test('below threshold goes to review, with the reason attached', () => {
    const r = run(extraction({ recommendations: [{ ...extraction().recommendations[0], confidence: 0.4 }] }));
    assert.equal(r.proposals.length, 0);
    assert.equal(r.review_queue.length, 1);
    assert.match(r.review_queue[0].why, /below the threshold/);
  });

  test('a threshold must be supplied, because none would be honest', () => {
    assert.throws(
      () => proposalsFromExtraction(extraction(), { subject_ref: 's', makeId }),
      /threshold is required/,
    );
    assert.doesNotThrow(
      () => proposalsFromExtraction(extraction(), { subject_ref: 's', makeId, threshold: 0.7 }),
    );
  });
});

describe('C2  an empty result is never an all-clear', () => {
  test('the notice is the concept note wording, not the caller\'s', () => {
    const r = run(extraction({ recommendations: [], extraction: { no_recommendation_found: true } }));
    assert.equal(r.notice, NOTHING_FOUND_NOTICE);
    assert.match(r.notice, /does not mean there is not one/);
  });

  test('an unreadable document is a failure, not a clean result', () => {
    const r = run(extraction({ recommendations: [], extraction: { unparseable: true } }));
    assert.match(r.notice, /could not be read/);
    assert.match(r.notice, /rather than a finding that there is nothing in it/);
  });
});

describe('C3  the patient validates before anything becomes an obligation', () => {
  test('a proposal carries the span so the source sentence can be highlighted', () => {
    const [p] = run(extraction()).proposals;
    assert.deepEqual(p.source_span, [150, 185]);
    assert.equal(p.recommendation.text_verbatim, 'Recommend CT follow-up in 6 months.');
  });

  test('accepting a proposal records who confirmed it', () => {
    const [p] = run(extraction()).proposals;
    const o = acceptProposal(p, {
      subject_ref: 'opaque-local-1',
      owner: { kind: 'patient', ref: 'local-1' },
      actor: PATIENT,
      at: '2026-03-20T10:00:00Z',
      extraction: { model: 'qwen2.5:7b' },
    });
    assert.equal(o.state, 'acknowledged');
    assert.equal(o.extraction.patient_verified, true);
    assert.equal(o.due_date, '2026-09-14');
    assert.equal(o.history[0].event, 'created');
    assert.equal(o.history[1].event, 'verified');
  });

  test('the whole path runs: extraction, proposal, obligation, summary, ladder', () => {
    const [p] = run(extraction()).proposals;
    const o = acceptProposal(p, {
      subject_ref: 'opaque-local-1',
      owner: { kind: 'patient', ref: 'local-1' },
      actor: PATIENT,
      at: '2026-03-20T10:00:00Z',
      extraction: { model: 'qwen2.5:7b' },
    });
    const s = preparedSummary(o, { now: '2026-10-02' });
    assert.match(s.text, /Recommend CT follow-up in 6 months\./);
    assert.match(s.text, /18 days past that date/);
    assert.equal(escalationLevel(o, { now: '2026-10-02' }).level, 'L2');
  });
});

describe('recommendations that must not become obligations as they stand', () => {
  test('a negated statement is kept as evidence, not turned into a duty', () => {
    const r = run(extraction({ recommendations: [{ ...extraction().recommendations[0], negated: true }] }));
    assert.equal(r.proposals.length, 0);
    assert.equal(r.not_indicated_evidence.length, 1);
    assert.match(r.not_indicated_evidence[0].why, /not an obligation/);
  });

  test('a conditional one is flagged and cannot be accepted as-is', () => {
    const r = run(extraction({ recommendations: [{ ...extraction().recommendations[0], conditional: true }] }));
    const [p] = r.proposals;
    assert.ok(p.flags.includes('conditional'));
    assert.throws(() => acceptProposal(p, {
      subject_ref: 's', owner: { kind: 'patient', ref: 'l' }, actor: PATIENT, at: '2026-03-20T10:00:00Z',
    }), /condition has to be resolved by a person/);
  });

  test('already scheduled is flagged so a duplicate is not created blindly', () => {
    const r = run(extraction({ recommendations: [{ ...extraction().recommendations[0], already_scheduled: true }] }));
    assert.ok(r.proposals[0].flags.includes('already_scheduled'));
  });

  test('no document date blocks rather than discards, because every due date derives from it', () => {
    const r = run(extraction({ document: { date_found: null, language: 'en' } }));
    assert.equal(r.proposals.length, 0);
    assert.equal(r.blocked.length, 1);
    assert.match(r.blocked[0].why, /patient has to supply the date/);
  });
});

describe('10  locale packs', () => {
  const good = {
    locale: 'en-NG', language: 'en', version: '0.3.0', extraction_validated: false,
    guideline_overrides: { pulmonary_nodule: 'bts_2015' },
    date_format: 'DD/MM/YYYY',
    escalation_intervals: { L1: -30, L2: 0, L3: 30, L4: 90 },
    channels: ['sms', 'push'],
    copy: { title: 'Follow-up that was recommended for me', ask_label: 'What I am asking' },
    signposting: { tb_confirmed: 'Nearest DOTS centre, see the national TB programme directory' },
  };

  test('a well-formed pack validates', () => {
    const v = validatePack(good);
    assert.ok(v.ok, v.errors.join('; '));
  });

  test('a pack cannot smuggle in interpretation, risk or urgency through translation', () => {
    const bad = { ...good, copy: { ...good.copy, title: 'Your result is serious, attend urgently' } };
    const v = validatePack(bad);
    assert.ok(!v.ok);
    assert.ok(v.errors.some((e) => /states what the finding might mean/.test(e)));
    assert.ok(v.errors.some((e) => /adds urgency not in the source/.test(e)));
  });

  test('signposting is checked too, since it is user-facing', () => {
    const bad = { ...good, signposting: { tb_confirmed: 'Go immediately, this is critical' } };
    assert.ok(!validatePack(bad).ok);
  });

  test('the ladder structure is not configurable, only its intervals', () => {
    assert.ok(!validatePack({ ...good, escalation_intervals: { L1: -30, L2: 0 } }).ok);
    assert.ok(!validatePack({ ...good, escalation_intervals: { L1: 30, L2: 0, L3: 30, L4: 90 } }).ok,
      'intervals that go backwards cannot escalate');
    assert.ok(validatePack({ ...good, escalation_intervals: { L1: -60, L2: 0, L3: 45, L4: 120 } }).ok);
  });

  test('claiming validated extraction is warned about, because no language has measured recall', () => {
    const v = validatePack({ ...good, extraction_validated: true });
    assert.ok(v.warnings.some((w) => /needs a published measurement/.test(w)));
  });

  test('a partly translated pack is accepted with a warning, not rejected', () => {
    const v = validatePack({ ...good, copy: { title: 'Follow-up that was recommended for me' } });
    assert.ok(v.ok);
    assert.ok(v.warnings.some((w) => /fall back to English/.test(w)));
  });
});

describe('10  graceful degradation is mandatory', () => {
  const packs = [{
    locale: 'en-NG', language: 'en', version: '0.3.0',
    copy: { title: 'Follow-up that was recommended for me' },
    signposting: { tb_confirmed: 'Nearest DOTS centre' },
  }];

  test('an exact match keeps its signposting', () => {
    const r = resolvePack('en-NG', packs);
    assert.equal(r.match, 'exact');
    assert.equal(signpostFor(r, 'tb_confirmed'), 'Nearest DOTS centre');
    assert.equal(r.signposting_omitted, false);
  });

  test('an unknown country falls back to the language and omits signposting rather than guessing', () => {
    const r = resolvePack('en-KE', packs);
    assert.equal(r.match, 'language');
    assert.equal(signpostFor(r, 'tb_confirmed'), null, 'a wrong clinic address is worse than none');
    assert.ok(r.signposting_omitted);
    assert.ok(r.notes.some((n) => /nearest language pack/.test(n)));
  });

  test('an unsupported language still returns a usable pack, and says so', () => {
    const r = resolvePack('ha-NG', packs);
    assert.equal(r.match, 'fallback');
    assert.equal(r.copy.ask, 'I am asking whether this follow-up has been arranged.');
    assert.ok(r.notes.some((n) => /still work/.test(n)));
    assert.equal(r.extraction_validated, false, 'C3: unvalidated, and the interface must say so');
  });

  test('nobody is ever blocked: the summary renders under full fallback', () => {
    const r = resolvePack('ha-NG', packs);
    const [p] = run(extraction()).proposals;
    const o = acceptProposal(p, {
      subject_ref: 'opaque-local-1', owner: { kind: 'patient', ref: 'local-1' },
      actor: PATIENT, at: '2026-03-20T10:00:00Z',
    });
    const s = preparedSummary(o, { now: '2026-10-02', copy: r.copy });
    assert.match(s.text, /Recommend CT follow-up in 6 months\./, 'the report\'s own words still print');
    assert.match(s.text, /has not been checked for this language/);
  });

  test('an invalid pack is never served, it degrades instead', () => {
    const poisoned = [{ locale: 'xx-XX', language: 'xx', version: '1', copy: { title: 'urgent, this is critical' } }];
    const r = resolvePack('xx-XX', poisoned);
    assert.equal(r.match, 'fallback', 'a pack that fails validation must not reach a patient');
  });
});
