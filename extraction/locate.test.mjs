// Tests for locate.mjs.
//
//   node --test extraction/locate.test.mjs
//
// Every sentence here is invented. The rule is measured on labelled reports separately, in
// RESULTS.md, and is not fitted to them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { locate } from './locate.mjs';

const at = (s) => { const r = locate(s); return `${r.anatomy}/${r.laterality}`; };

test('one structure named gives that structure, and its side if stated', () => {
  assert.equal(at('8 mm nodule in the right upper lobe.'), 'lung/right');
  assert.equal(at('A 1.2 cm hypoechoic nodule in the left lobe of the thyroid.'), 'thyroid/left');
  assert.equal(at('Focal asymmetry in the right breast at 10 o\'clock.'), 'breast/right');
  assert.equal(at('Hypodense lesion in the liver, too small to characterize.'), 'liver/null');
  assert.equal(at('Bilateral adrenal nodules.'), 'adrenal/bilateral');
  assert.equal(at('Filling defect along the right posterolateral bladder wall.'), 'bladder/right');
  assert.equal(at('Disc protrusion at L4-L5 with mild canal narrowing.'), 'spine_lumbar/null');
  assert.equal(at('Annular fissure at L5-S1.'), 'spine_lumbar/null', 'L5-S1 is a lumbar level, not the sacrum');
});

test('more than one structure named gives no anatomy (LABELLING.md 7.13)', () => {
  assert.equal(at('Lesion in the liver abutting the right kidney.'), 'null/null');
  assert.equal(at('Hilar lymphadenopathy and a right pleural effusion.'), 'null/null');
});

test('a phrase belonging to another structure does not name the first', () => {
  assert.equal(at('Filling defect in the right pulmonary artery.'), 'artery/right');
  assert.equal(at('Thickening at the hepatic flexure.'), 'colon/null');
  assert.equal(at('Sludge in the gall bladder.'), 'gallbladder/null');
  assert.equal(at('Soft tissue swelling of the neck soft tissues.'), 'neck_soft_tissue/null');
  assert.equal(at('Ectasia of the ascending aorta to 4.3 cm.'), 'aorta_thoracic/null');
});

test('a group of findings gets no side unless it says bilateral (LABELLING.md 7.12)', () => {
  assert.equal(at('Multiple pulmonary nodules, the largest 6 mm in the left lower lobe.'), 'lung/null');
  assert.equal(at('Several nodules in both lungs.'), 'lung/bilateral');
});

test('both sides named, or none, gives no side', () => {
  assert.equal(at('Opacity at the right base and the left mid lung.'), 'lung/null');
  assert.equal(at('Small pericardial effusion.'), 'heart/null');
});

test('nothing named, or nothing at all, is null', () => {
  assert.equal(at('Findings as above.'), 'null/null');
  assert.equal(at(null), 'null/null');
  assert.equal(at(''), 'null/null');
});
