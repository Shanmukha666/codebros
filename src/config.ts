import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().min(1).default('file:./prisma/dev.db'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  REFRESH_TOKEN_SECRET: z.string().min(32).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default(process.env.VERCEL ? 'production' : 'development')
});

const parsed = configSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
  NODE_ENV: process.env.NODE_ENV
});

const developmentAccessSecret = 'codebros-local-access-secret-change-in-production-2026';
const developmentRefreshSecret = 'codebros-local-refresh-secret-change-in-production-2026';

if (parsed.NODE_ENV === 'production') {
  if (!process.env.WEB_ORIGIN) {
    throw new Error('WEB_ORIGIN must be set in production.');
  }
  if (!parsed.ACCESS_TOKEN_SECRET || parsed.ACCESS_TOKEN_SECRET === developmentAccessSecret) {
    throw new Error('ACCESS_TOKEN_SECRET must be set to a strong value in production.');
  }
  if (!parsed.REFRESH_TOKEN_SECRET || parsed.REFRESH_TOKEN_SECRET === developmentRefreshSecret) {
    throw new Error('REFRESH_TOKEN_SECRET must be set to a strong value in production.');
  }
  if (parsed.ACCESS_TOKEN_SECRET === parsed.REFRESH_TOKEN_SECRET) {
    throw new Error('ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be different in production.');
  }
}

export const config = {
  ...parsed,
  ACCESS_TOKEN_SECRET: parsed.ACCESS_TOKEN_SECRET ?? developmentAccessSecret,
  REFRESH_TOKEN_SECRET: parsed.REFRESH_TOKEN_SECRET ?? developmentRefreshSecret
};
