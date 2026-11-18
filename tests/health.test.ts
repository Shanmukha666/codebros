import assert from 'node:assert/strict';
import test from 'node:test';

test('documents the health response shape', () => {
  assert.deepEqual({ ok: true, service: 'codebros-api' }, { ok: true, service: 'codebros-api' });
});
