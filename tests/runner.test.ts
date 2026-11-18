import assert from 'node:assert/strict';
import test from 'node:test';
import { runDeterministicChallenge } from '../src/runner.js';

test('passes when every expected value is present', () => {
    assert.deepEqual(runDeterministicChallenge('console.log(3, 5)', [
      { label: 'three', expected: '3' },
      { label: 'five', expected: '5' }
    ]), { status: 'PASSED', passed: 2, total: 2, output: '2/2 checks passed. This prototype uses deterministic feedback; secure sandbox execution is the next runner adapter.' });
});

test('returns actionable feedback for empty code', () => {
    assert.deepEqual(runDeterministicChallenge('  ', [{ label: 'value', expected: '3' }]), {
      status: 'FAILED',
      passed: 0,
      total: 1,
      output: 'Write some code before running the challenge.'
    });
});
