// Tests for sentence segmentation.
//
//   node --test extraction/sentences.test.mjs
//
// The tiling property is the one that matters. Everything downstream locates quotes by offset, so a
// splitter that drops or duplicates a character produces spans that point at the wrong text while
// still looking well-formed. That is the failure the verification screen exists to prevent, and it
// would arrive here rather than in the model.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { splitSentences, sectionCannotRecommend, SECTIONS_WITHOUT_RECOMMENDATIONS } from './sentences.mjs';

const tiles = (text) => {
  const segs = splitSentences(text);
  let pos = 0;
  for (const s of segs) {
    assert.equal(s.span[0], pos, `gap or overlap before span ${JSON.stringify(s.span)}`);
    assert.equal(text.slice(...s.span), s.text, 'segment text must equal its own slice');
    pos = s.span[1];
  }
  assert.equal(pos, text.length, 'segments must reach the end of the text');
  assert.equal(segs.map((s) => text.slice(...s.span)).join(''), text, 'must reconstruct exactly');
  return segs;
};

describe('the spans tile the source exactly', () => {
  test('a plain report', () => {
    tiles('FINDINGS:  No acute process.\n\nIMPRESSION:  Normal chest.\n');
  });

  test('trailing and leading whitespace, and an empty tail', () => {
    tiles('\n\n  IMPRESSION:  Normal.  \n\n\n');
  });

  test('text with no terminator at all', () => {
    tiles('BONES: unremarkable');
  });

  test('the empty string produces no segments', () => {
    assert.deepEqual(splitSentences(''), []);
  });

  test('a report that is only whitespace', () => {
    tiles('   \n\n  \n');
  });
});

describe('what must not be split', () => {
  const oneSegment = (text, needle) => {
    const segs = splitSentences(text);
    const holder = segs.filter((s) => s.text.includes(needle));
    assert.equal(holder.length, 1, `${JSON.stringify(needle)} was split across segments`);
  };

  test('decimal measurements', () => {
    oneSegment('FINDINGS:  A 4.9 x 3.0 x 4.4 cm mass is seen.\n', '4.9 x 3.0 x 4.4');
  });

  test('unit abbreviations', () => {
    oneSegment('FINDINGS:  Nodule measuring 8 mm. in the right upper lobe.\n', '8 mm. in the right');
  });

  test('titles', () => {
    oneSegment('NOTIFICATION:  Entered by Dr. ___ at 14:23.\n', 'Dr. ___ at');
  });

  test('initialisms written with periods', () => {
    oneSegment('EXAMINATION:  RENAL TRANSPLANT U.S. RIGHT\n', 'U.S. RIGHT');
  });

  test('a numbered impression list keeps its marker with its item', () => {
    const text = 'IMPRESSION:\n\n1. Stranding in the sigmoid colon.\n2. A filling defect.\n';
    const segs = splitSentences(text);
    const first = segs.find((s) => s.text.includes('Stranding'));
    assert.match(first.text, /1\. Stranding/, 'the marker belongs with the item it introduces');
  });
});

describe('what must be split', () => {
  test('two sentences on one line', () => {
    const segs = splitSentences('IMPRESSION:  No fracture.  Recommend follow-up.\n');
    assert.equal(segs.filter((s) => s.text.trim()).length, 2);
  });

  test('a section with no terminator, ended by the next header', () => {
    const segs = tiles('BONES: unremarkable\nSOFT TISSUES: normal\n');
    assert.ok(segs.length >= 2, 'a new header ends the previous segment');
  });
});

describe('section headings', () => {
  test('a header sharing a line with its first sentence still labels it', () => {
    const segs = splitSentences('IMPRESSION:  No acute fracture.\n');
    assert.equal(segs[0].section, 'IMPRESSION');
  });

  test('later sentences inherit the heading until the next one', () => {
    const text = 'FINDINGS:  Lungs are clear.  No effusion.\n\nIMPRESSION:  Normal.\n';
    const segs = splitSentences(text);
    assert.equal(segs.find((s) => s.text.includes('No effusion')).section, 'FINDINGS');
    assert.equal(segs.find((s) => s.text.includes('Normal')).section, 'IMPRESSION');
  });

  test('text before any heading has a null section', () => {
    const segs = splitSentences('CT-GUIDED BIOPSY OF THE RIGHT TIBIA\n\nFINDINGS:  Normal.\n');
    assert.equal(segs[0].section, null);
  });
});

describe('sections that cannot hold a recommendation', () => {
  // LABELLING.md 7.4 and 7.8, as a rule rather than an instruction a model may ignore.
  test('the indication and history headings', () => {
    for (const s of ['INDICATION', 'CLINICAL HISTORY', 'HISTORY', 'REASON FOR EXAM']) {
      assert.ok(sectionCannotRecommend(s), `${s} should be suppressed`);
    }
  });

  test('a heading with trailing detail still matches', () => {
    assert.ok(sectionCannotRecommend('INDICATION AND HISTORY'));
  });

  test('the sections recommendations actually come from are not suppressed', () => {
    for (const s of ['IMPRESSION', 'FINDINGS', 'RECOMMENDATION', 'RECOMMENDATION(S)']) {
      assert.equal(sectionCannotRecommend(s), false, `${s} must not be suppressed`);
    }
  });

  test('a null section is not suppressed, because a report may have no headings at all', () => {
    assert.equal(sectionCannotRecommend(null), false);
    assert.equal(sectionCannotRecommend(undefined), false);
  });

  test('the list is not empty, which would silently disable the filter', () => {
    assert.ok(SECTIONS_WITHOUT_RECOMMENDATIONS.length > 0);
  });
});
