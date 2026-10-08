// Tests for the section 7 modality vocabulary, specification v0.6.
//
//   node --test obligation/modality.test.mjs
//
// The reading of words into codes is a fixed rule, so it is tested as a table. Every row is a way a
// recommendation names its test in practice, and several are the exact shapes that the v0.5 word
// match got wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODALITIES, DICOM_MODALITY, modalityCode, modalityWords, protocolNamed, studyModalityCodes,
} from './modality.mjs';

test('words are read into codes by a fixed rule', () => {
  const table = [
    ['CT', 'ct'], ['CT chest', 'ct'], ['chest CT', 'ct'], ['CTA', 'ct'], ['CT angiography', 'ct'],
    ['multi phasic CT', 'ct'], ['CT-guided biopsy', 'ct'], ['CT colonography', 'ct'],
    ['MRI', 'mr'], ['MR', 'mr'], ['MRA', 'mr'], ['MRCP', 'mr'], ['MR arthrogram', 'mr'],
    ['ultrasound', 'ultrasound'], ['US', 'ultrasound'], ['renal sonogram', 'ultrasound'],
    ['venous duplex', 'ultrasound'], ['echocardiogram', 'ultrasound'],
    ['chest radiograph', 'radiograph'], ['chest x-ray', 'radiograph'], ['repeat film', 'radiograph'],
    ['CXR', 'radiograph'],
    ['mammography', 'mammography'], ['diagnostic mammogram', 'mammography'], ['tomosynthesis', 'mammography'],
    ['PET-CT', 'pet'], ['PET/CT', 'pet'], ['PET', 'pet'],
    ['bone scan', 'nuclear_medicine'], ['HIDA', 'nuclear_medicine'], ['V/Q scan', 'nuclear_medicine'],
    ['barium swallow', 'fluoroscopy'], ['esophagram', 'fluoroscopy'],
    ['angiogram', 'angiography'], ['DEXA', 'bone_densitometry'], ['bone density', 'bone_densitometry'],
    ['colonoscopy', 'endoscopy'], ['bronchoscopy', 'endoscopy'],
    ['CT or MRI', 'ct'], ['MRI or CT', 'mr'],
  ];
  for (const [words, code] of table) assert.equal(modalityCode(words), code, words);
});

test('no test named is null; a test outside the list is other, never the nearest guess', () => {
  for (const empty of [null, undefined, '', '  ', 'none', 'None']) assert.equal(modalityCode(empty), null);
  for (const outside of ['sputum culture', 'PSA', 'stool test']) assert.equal(modalityCode(outside), 'other', outside);
});

test('every code the rule can produce is in the vocabulary', () => {
  for (const code of Object.values(DICOM_MODALITY)) assert.ok(MODALITIES.includes(code), code);
  assert.ok(MODALITIES.includes(modalityCode('anything at all')));
});

test('DICOM modalities are read into codes, and unknown ones become other', () => {
  assert.deepEqual(studyModalityCodes(['CT']), ['ct']);
  assert.deepEqual(studyModalityCodes(['CR']), ['radiograph']);
  assert.deepEqual(studyModalityCodes(['DX', 'CR']), ['radiograph'], 'two radiography codes are one modality');
  assert.deepEqual(studyModalityCodes(['PT', 'CT']), ['pet', 'ct'], 'a PET-CT is both, and section 4.5 sees that');
  assert.deepEqual(studyModalityCodes(['us ']), ['ultrasound']);
  assert.deepEqual(studyModalityCodes(['SM']), ['other']);
  assert.deepEqual(studyModalityCodes(null), []);
});

test('a named protocol is recognised, and a bare modality is not', () => {
  for (const named of ['CTA', 'MRA', 'multi phasic CT', 'CT with contrast', 'diagnostic mammogram',
    'MRCP', 'ultrasound-guided biopsy', 'echo', 'venous duplex', 'spot compression views']) {
    assert.equal(protocolNamed(named), true, named);
  }
  for (const bare of ['CT', 'CT chest', 'MRI', 'mammography', 'chest radiograph', null]) {
    assert.equal(protocolNamed(bare), false, String(bare));
  }
});

test('the words naming the test are copied whole from the sentence', () => {
  const table = [
    ['If symptoms persist, repeat chest radiograph.', 'radiograph'],
    ['Recommend MRI lumbar spine in 3 months.', 'MRI'],
    ['Annual screening mammography is advised.', 'mammography'],
    ['Consider PET-CT for staging.', 'PET-CT'],
    ['Follow-up x-ray in 6 weeks.', 'x-ray'],
    ['Correlate clinically.', null],
    [null, null],
  ];
  for (const [text, words] of table) assert.equal(modalityWords(text), words, String(text));
  for (const [text, words] of table) if (words) assert.ok(text.includes(words), 'always the sentence\'s own words');
});
