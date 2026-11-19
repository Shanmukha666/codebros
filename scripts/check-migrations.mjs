import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const schemaProvider = schema.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/)?.[1];
const lockUrl = new URL('../prisma/migrations/migration_lock.toml', import.meta.url);

if (!existsSync(lockUrl)) {
  console.log('No committed migrations; skipping provider check.');
  process.exit(0);
}

const lockProvider = (await readFile(lockUrl, 'utf8')).match(/provider\s*=\s*"(\w+)"/)?.[1];
if (lockProvider !== schemaProvider) {
  console.error(`prisma/migrations targets "${lockProvider}" but schema.prisma uses "${schemaProvider}". Regenerate the migrations.`);
  process.exit(1);
}
console.log(`Migrations match the ${schemaProvider} schema.`);
