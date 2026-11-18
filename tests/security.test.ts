import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessPublishedCourse, canManageCourse } from '../src/access.js';
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
