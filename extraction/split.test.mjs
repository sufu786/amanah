// Tests for the development and test split.
//
//   node --test extraction/split.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { splitByPosition, DEV_POSITIONS } from './split.mjs';

const corpus = {
  corpus: 'fixture',
  frame: 'kept',
  reports: ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => ({ id, text: `report ${id}` })),
};
const labels = {
  corpus: 'fixture',
  labeller: 'A',
  protocol_version: '0.1',
  labels: corpus.reports.map((r) => ({ report_id: r.id, recommendations: [] })),
};
const decl = { labellers: 1, agreement: 'not_measured' };

describe('splitByPosition', () => {
  test('partitions in draw order with nothing lost or shared', () => {
    const { dev, test: t } = splitByPosition(corpus, labels, 2, decl);
    assert.deepEqual(dev.reports.reports.map((r) => r.id), ['r1', 'r2']);
    assert.deepEqual(t.reports.reports.map((r) => r.id), ['r3', 'r4', 'r5']);
    assert.deepEqual(dev.labels.labels.map((e) => e.report_id), ['r1', 'r2']);
    assert.deepEqual(t.labels.labels.map((e) => e.report_id), ['r3', 'r4', 'r5']);
  });

  test('each part is its own corpus, and its labels name it', () => {
    const { dev, test: t } = splitByPosition(corpus, labels, 2, decl);
    assert.equal(dev.reports.corpus, 'fixture-dev');
    assert.equal(dev.labels.corpus, 'fixture-dev');
    assert.equal(t.labels.corpus, 'fixture-test');
    assert.equal(dev.reports.frame, 'kept');
  });

  test('both parts are declared resolved with how they were made', () => {
    const { dev } = splitByPosition(corpus, labels, 2, decl);
    assert.equal(dev.labels.resolved, true);
    assert.deepEqual(dev.labels.labelling, decl);
  });

  test('refuses labels in a different order from the corpus', () => {
    const shuffled = { ...labels, labels: [...labels.labels].reverse() };
    assert.throws(() => splitByPosition(corpus, shuffled, 2, decl), /draw order/);
  });

  test('refuses a cut that leaves either part empty', () => {
    assert.throws(() => splitByPosition(corpus, labels, 0, decl));
    assert.throws(() => splitByPosition(corpus, labels, 5, decl));
  });

  test('the cut points are the ones CORPUS.md 6.1 records', () => {
    assert.deepEqual(DEV_POSITIONS, { 'mimic-radiology-A': 105, 'mimic-radiology-B': 45 });
  });
});
