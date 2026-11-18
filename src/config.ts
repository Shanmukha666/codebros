import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().min(1).default('file:./prisma/dev.db'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  ACCESS_TOKEN_SECRET: z.string().min(32).default('codebros-local-access-secret-change-in-production-2026'),
  REFRESH_TOKEN_SECRET: z.string().min(32).default('codebros-local-refresh-secret-change-in-production-2026'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development')
});

export const config = configSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
  NODE_ENV: process.env.NODE_ENV
});
