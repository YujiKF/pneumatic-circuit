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
