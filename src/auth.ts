import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';
import { prisma } from './db.js';
import { sendError } from './errors.js';

const accessSecret = new TextEncoder().encode(config.ACCESS_TOKEN_SECRET);
const refreshSecret = new TextEncoder().encode(config.REFRESH_TOKEN_SECRET);
const tokenIssuer = 'codebros-api';
const tokenAudience = 'codebros-web';
const dummyPasswordHashPromise = argon2.hash('CodeBros-invalid-password-only-for-timing');

export type AuthUser = { id: string; email: string; name: string; role: 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' };

export async function hashPassword(password: string) {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export async function verifyPasswordWithTiming(hash: string | null, password: string) {
  return argon2.verify(hash ?? await dummyPasswordHashPromise, password);
}

async function signToken(user: AuthUser, secret: Uint8Array, expiration: string) {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(secret);
}

export async function issueTokens(user: AuthUser) {
  const accessToken = await signToken(user, accessSecret, '15m');
  const refreshToken = await signToken(user, refreshSecret, '30d');
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });
  return { accessToken, refreshToken };
}

export async function verifyRefreshToken(token: string) {
  const verified = await jwtVerify(token, refreshSecret, { issuer: tokenIssuer, audience: tokenAudience });
  const tokenRecord = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });
  if (!tokenRecord || tokenRecord.expiresAt <= new Date() || tokenRecord.user.id !== verified.payload.sub) {
    return null;
  }
  return tokenRecord.user;
}

export async function authenticate(request: FastifyRequest, reply: any) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    sendError(reply, 401, 'AUTH_REQUIRED', 'A bearer access token is required.');
    return null;
  }
  try {
    const verified = await jwtVerify(header.slice(7), accessSecret, { issuer: tokenIssuer, audience: tokenAudience });
    const user = await prisma.user.findUnique({ where: { id: verified.payload.sub } });
    if (!user) {
      sendError(reply, 401, 'AUTH_INVALID', 'The access token does not belong to an active user.');
      return null;
    }
    return { id: user.id, email: user.email, name: user.name, role: user.role as 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' };
  } catch {
    sendError(reply, 401, 'AUTH_INVALID', 'The access token is invalid or expired.');
    return null;
  }
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function generateDevelopmentToken() {
  return randomBytes(32).toString('hex');
}
