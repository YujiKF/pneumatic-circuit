/**
 * Pipeline API tests.
 *
 * The `generate` entrypoint is the ONLY thing the UI calls; it must be fully
 * runnable and testable headless (no React, no DOM). These tests assert the
 * end-to-end result for the golden sequence and the graceful failure paths.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../../src/pipeline.ts';

test('generate() returns SVGs, explanation, steps and verification for A+B+A-B-', () => {
  const res = generate({
    sequence: 'A+B+A-B-',
    type: 'electropneumatic',
    method: 'step-by-step',
    mode: 'single',
  });
  assert.ok(res.ok, res.error);
  assert.ok(res.pneumaticSvg?.includes('<svg'), 'pneumatic SVG present');
  assert.ok(res.ladderSvg?.includes('<svg'), 'ladder SVG present');
  assert.ok((res.funcionamento?.length ?? 0) > 0, 'has explanation lines');
  assert.equal(res.steps?.length, 4, 'four steps summarized');
  assert.ok((res.components?.length ?? 0) > 0, 'has components');
  assert.ok(res.verification?.ok, 'verification passed');
  assert.equal(res.steps?.[0]?.solenoidId, '1Y1');
});

test('generate() supports the cascade method (pneumatic only)', () => {
  const res = generate({
    sequence: 'A+B+A-B-',
    type: 'pneumatic',
    method: 'cascade',
    mode: 'single',
  });
  assert.ok(res.ok, res.error);
  assert.ok(res.pneumaticSvg?.includes('<svg'), 'pneumatic SVG present');
  // Cascade has no ladder.
  assert.equal(res.ladderSvg, undefined);
  // Funcionamento has chronological explanation
  assert.ok((res.funcionamento?.length ?? 0) > 0, 'has chronological explanation');
  assert.ok(res.funcionamento?.some((l) => l.includes('pressurizing line L1')));
  // Steps summarized
  assert.equal(res.steps?.length, 4, '4 steps summarized');
  assert.equal(res.steps?.[0]?.movement, 'A+');
  assert.equal(res.steps?.[0]?.relayId, 'L1');
  // Components present
  assert.ok((res.components?.length ?? 0) > 0, 'has components');
  // Verification passed
  assert.ok(res.verification?.ok, 'verification ok');
});

test('generate() returns full result for A+B+B-A-', () => {
  const res = generate({
    sequence: 'A+B+B-A-',
    type: 'electropneumatic',
    method: 'step-by-step',
    mode: 'single',
  });
  assert.ok(res.ok, res.error);
  assert.ok(res.pneumaticSvg?.includes('<svg'));
  assert.ok(res.ladderSvg?.includes('<svg'));
  assert.equal(res.steps?.length, 4);
  assert.ok(res.verification?.ok);
  assert.ok(res.funcionamento?.some((l) => l.includes('cycle for A+B+B-A- is complete')));
});

test('generate() returns full result for A+B+C+A-B-C- (3 cylinders, 6 steps)', () => {
  const res = generate({
    sequence: 'A+B+C+A-B-C-',
    type: 'electropneumatic',
    method: 'step-by-step',
    mode: 'single',
  });
  assert.ok(res.ok, res.error);
  assert.ok(res.pneumaticSvg?.includes('<svg'));
  assert.ok(res.ladderSvg?.includes('<svg'));
  assert.equal(res.steps?.length, 6);
  assert.ok(res.verification?.ok);
  assert.ok(res.funcionamento?.some((l) => l.includes('cycle for A+B+C+A-B-C- is complete')));
});

test('generate() returns full result for B-C+A+B+C-A- (initial extended cylinder)', () => {
  const res = generate({
    sequence: 'B-C+A+B+C-A-',
    type: 'electropneumatic',
    method: 'step-by-step',
    mode: 'single',
  });
  assert.ok(res.ok, res.error);
  assert.ok(res.pneumaticSvg?.includes('<svg'));
  assert.ok(res.ladderSvg?.includes('<svg'));
  assert.equal(res.steps?.length, 6);
  assert.ok(res.verification?.ok);
  assert.equal(res.steps?.[0]?.solenoidId, '2Y2');
  assert.ok(res.funcionamento?.some((l) => l.includes('cycle for B-C+A+B+C-A- is complete')));
});

test('generate() returns full result for A-B+B-B+B-TA+ (timer + paralleled solenoids)', () => {
  const res = generate({
    sequence: 'A-B+B-B+B-TA+',
    type: 'electropneumatic',
    method: 'step-by-step',
    mode: 'single',
  });
  assert.ok(res.ok, res.error);
  assert.ok(res.pneumaticSvg?.includes('<svg'));
  assert.ok(res.ladderSvg?.includes('<svg'));
  assert.equal(res.steps?.length, 6);
  assert.ok(res.verification?.ok);
  assert.equal(res.steps?.[5]?.hasTimer, true);
  assert.ok(res.funcionamento?.some((l) => l.includes('cycle for A-B+B-B+B-TA+ is complete')));
});

test('generate() fails gracefully on an invalid sequence', () => {
  const res = generate({
    sequence: 'A++',
    type: 'electropneumatic',
    method: 'step-by-step',
    mode: 'single',
  });
  assert.equal(res.ok, false);
  assert.ok(res.error && res.error.includes('invalida'), 'reports a parse error');
});
