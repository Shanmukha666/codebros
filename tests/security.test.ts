import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessPublishedCourse, canManageCourse, containsText, isAllowedCorsOrigin, isTrustedOrigin } from '../src/access.js';
import { passwordSchema } from '../src/validation.js';

test('requires a strong registration password', () => {
  assert.equal(passwordSchema.safeParse('short').success, false);
  assert.equal(passwordSchema.safeParse('Strong-password-2026').success, true);
});

test('restricts instructor course management to owners', () => {
  assert.equal(canManageCourse('INSTRUCTOR', 'owner-1', 'owner-1'), true);
  assert.equal(canManageCourse('INSTRUCTOR', 'owner-1', 'owner-2'), false);
  assert.equal(canManageCourse('ADMIN', 'admin-1', null), true);
});

test('requires enrollment in a published course', () => {
  assert.equal(canAccessPublishedCourse(true, 'PUBLISHED'), true);
  assert.equal(canAccessPublishedCourse(false, 'PUBLISHED'), false);
  assert.equal(canAccessPublishedCourse(true, 'DRAFT'), false);
});

test('requires the configured frontend origin for cookie endpoints in production', () => {
  const allowed = 'https://app.example.com';
  assert.equal(isTrustedOrigin(allowed, allowed, true), true);
  assert.equal(isTrustedOrigin('https://evil.example.com', allowed, true), false);
  assert.equal(isTrustedOrigin(undefined, allowed, true), false);
  assert.equal(isTrustedOrigin(undefined, allowed, false), true);
});

test('searches case-insensitively on PostgreSQL without breaking SQLite', () => {
  assert.deepEqual(containsText('java', false), { contains: 'java', mode: 'insensitive' });
  assert.deepEqual(containsText('java', true), { contains: 'java' });
});

test('CORS allows localhost only outside production', () => {
  const allowed = 'https://app.example.com';
  assert.equal(isAllowedCorsOrigin(allowed, allowed, true), true);
  assert.equal(isAllowedCorsOrigin('http://localhost:3000', allowed, true), false);
  assert.equal(isAllowedCorsOrigin('http://localhost:3000', allowed, false), true);
  assert.equal(isAllowedCorsOrigin('https://evil.example.com', allowed, false), false);
  assert.equal(isAllowedCorsOrigin(undefined, allowed, true), true);
});
