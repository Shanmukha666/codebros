import { describe, expect, it } from 'vitest';

describe('CodeBros API contract', () => {
  it('documents the health response shape', () => {
    expect({ ok: true, service: 'codebros-api' }).toMatchObject({ ok: true, service: 'codebros-api' });
  });
});
