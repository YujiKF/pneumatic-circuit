/**
 * Spec task 1.1 / REQ-VALID-OVERLAP: direct/indirect classification (RULES §3
 * worked examples) and signal-overlap detection for the intuitive wiring.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../src/parser/index.ts';
import { analyzeSequence, classifySequence, detectSignalOverlap } from '../../src/engine/index.ts';

function seq(raw: string) {
  const r = parseSequence(raw);
  assert.ok(r.ok, `"${raw}" parses`);
  return r.value;
}

test('RULES §3 worked classification examples', () => {
  assert.equal(classifySequence(seq('A+B+A-B-')), 'direct');
  assert.equal(classifySequence(seq('A+B+B-A-')), 'indirect');
  assert.equal(classifySequence(seq('A+C+B-A-C-B+')), 'direct');
  assert.equal(classifySequence(seq('A+B+C+A-D+B-D-C-')), 'indirect');
});

test('direct sequences have no intuitive overlap; indirect ones do', () => {
  for (const s of ['A+B+A-B-', 'A+C+B-A-C-B+', 'A+B+C+A-B-C-', 'B-C+A+B+C-A-']) {
    assert.deepEqual(detectSignalOverlap(seq(s)), [], s);
    assert.equal(analyzeSequence(seq(s)).intuitiveApplicable, true);
  }
  for (const s of ['A+B+B-A-', 'A+B+C+A-D+B-D-C-']) {
    assert.ok(detectSignalOverlap(seq(s)).length > 0, s);
    assert.equal(analyzeSequence(seq(s)).intuitiveApplicable, false);
  }
});

test('A+B+B-A-: 1S2 (commands B+) is still active when B- must be commanded', () => {
  const overlaps = detectSignalOverlap(seq('A+B+B-A-'));
  assert.ok(overlaps.some((o) => o.sensorId === '1S2' && o.commanded === 'B+' && o.blocked === 'B-'));
});
