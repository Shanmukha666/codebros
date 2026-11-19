export type PlatformRole = 'STUDENT' | 'INSTRUCTOR' | 'ADMIN';

export function canManageCourse(role: PlatformRole, userId: string, ownerId: string | null) {
  return role === 'ADMIN' || (role === 'INSTRUCTOR' && ownerId === userId);
}

export function canAccessPublishedCourse(enrolled: boolean, status: string) {
  return enrolled && status === 'PUBLISHED';
}

export function isTrustedOrigin(origin: string | undefined, allowedOrigin: string, production: boolean) {
  if (!production) return true;
  return origin === allowedOrigin;
}
