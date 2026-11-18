import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
let sqlite = source
  .replace('provider = "postgresql"', 'provider = "sqlite"')
  .replace('url      = env("DATABASE_URL")', 'url      = "file:./dev.db"');

sqlite = sqlite
  .replace(/enum\s+(Role|CourseStatus|AttemptStatus)\s*\{[^}]*\}\s*/g, '')
  .replace(/\bRole\b/g, 'String')
  .replace(/\bCourseStatus\b/g, 'String')
  .replace(/\bAttemptStatus\b/g, 'String')
  .replace(/\bJson\b/g, 'String')
  .replace('@default(STUDENT)', '@default("STUDENT")')
  .replace('@default(DRAFT)', '@default("DRAFT")');

await writeFile(new URL('../prisma/schema.sqlite.prisma', import.meta.url), sqlite);
