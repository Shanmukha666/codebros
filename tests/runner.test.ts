import { describe, expect, it } from 'vitest';
import { runDeterministicChallenge } from '../src/runner.js';

describe('deterministic challenge runner', () => {
  it('passes when every expected value is present', () => {
    expect(runDeterministicChallenge('console.log(3, 5)', [
      { label: 'three', expected: '3' },
      { label: 'five', expected: '5' }
    ])).toMatchObject({ status: 'PASSED', passed: 2, total: 2 });
  });

  it('returns actionable feedback for empty code', () => {
    expect(runDeterministicChallenge('  ', [{ label: 'value', expected: '3' }])).toMatchObject({
      status: 'FAILED',
      passed: 0,
      output: 'Write some code before running the challenge.'
    });
  });
});
