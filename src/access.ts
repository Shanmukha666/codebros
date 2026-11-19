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

// PostgreSQL's LIKE is case-sensitive, so it needs mode: 'insensitive'. SQLite's is already
// case-insensitive for ASCII and its Prisma client rejects the `mode` argument.
export function containsText(value: string, sqlite: boolean) {
  return sqlite ? { contains: value } : { contains: value, mode: 'insensitive' as const };
}
