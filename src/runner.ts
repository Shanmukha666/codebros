export type SupportedLanguage = 'javascript' | 'python' | 'html-css' | 'java' | 'cpp';

export type RunnerResult = {
  status: 'PASSED' | 'FAILED';
  passed: number;
  total: number;
  output: string;
};

type TestCase = { label: string; expected: string };

export function runDeterministicChallenge(source: string, tests: TestCase[]): RunnerResult {
  const normalized = source.trim();
  const total = tests.length;
  if (!normalized) {
    return { status: 'FAILED', passed: 0, total, output: 'Write some code before running the challenge.' };
  }
  const passed = tests.filter((test) => normalized.includes(test.expected)).length;
  const status = passed === total ? 'PASSED' : 'FAILED';
  return {
    status,
    passed,
    total,
    output: `${passed}/${total} checks passed. This prototype uses deterministic feedback; secure sandbox execution is the next runner adapter.`
  };
}
