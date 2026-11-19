import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { InjectOptions } from 'fastify';
import { SignJWT } from 'jose';

const WEB_ORIGIN = 'https://app.example.com';
const accessSecret = 'a'.repeat(40);

Object.assign(process.env, {
  NODE_ENV: 'production',
  WEB_ORIGIN,
  TRUST_PROXY: 'true',
  ACCESS_TOKEN_SECRET: accessSecret,
  REFRESH_TOKEN_SECRET: 'b'.repeat(40),
  DATABASE_URL: 'postgresql://nobody:nobody@127.0.0.1:1/none'
});

const { app } = await import('../src/server.js');
const send = (options: InjectOptions) => app.inject(options);

before(() => app.ready());
after(() => app.close());

test('refresh and logout reject missing or foreign origins', async () => {
  for (const url of ['/api/auth/refresh', '/api/auth/logout']) {
    for (const headers of [{}, { origin: 'https://evil.example.com' }]) {
      const response = await send({ method: 'POST', url, headers });
      assert.equal(response.statusCode, 403, `${url} ${JSON.stringify(headers)}`);
      assert.equal(response.json().error.code, 'ORIGIN_NOT_ALLOWED');
    }
  }
});

test('refresh from the right origin still needs a refresh cookie', async () => {
  const response = await send({ method: 'POST', url: '/api/auth/refresh', headers: { origin: WEB_ORIGIN } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'AUTH_REQUIRED');
});

test('protected routes require a bearer token', async () => {
  const routes: [string, string][] = [
    ['GET', '/api/me'], ['PATCH', '/api/me'], ['GET', '/api/dashboard'], ['GET', '/api/progress'],
    ['POST', '/api/courses/c1/enroll'], ['GET', '/api/courses/c1/lessons/l1'], ['POST', '/api/lessons/l1/complete'],
    ['GET', '/api/quizzes/q1'], ['POST', '/api/quizzes/q1/attempts'], ['POST', '/api/challenges/ch1/runs'],
    ['GET', '/api/admin/overview'], ['GET', '/api/admin/students'], ['POST', '/api/admin/courses'], ['PATCH', '/api/admin/courses/c1']
  ];
  for (const [method, url] of routes) {
    const response = await send({ method: method as 'GET' | 'POST' | 'PATCH', url });
    assert.equal(response.statusCode, 401, `${method} ${url}`);
  }
});

test('rejects tokens signed with another secret or without issuer and audience', async () => {
  const forge = async (secret: string, claims: { iss?: string; aud?: string }) => {
    const token = new SignJWT({ role: 'ADMIN' }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1').setExpirationTime('5m');
    if (claims.iss) token.setIssuer(claims.iss);
    if (claims.aud) token.setAudience(claims.aud);
    return token.sign(new TextEncoder().encode(secret));
  };
  const cases = [
    await forge('c'.repeat(40), { iss: 'codebros-api', aud: 'codebros-web' }),
    await forge(accessSecret, {}),
    await forge(accessSecret, { iss: 'someone-else', aud: 'codebros-web' })
  ];
  for (const token of cases) {
    const response = await send({ method: 'GET', url: '/api/admin/overview', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 401);
  }
});

test('weak passwords and malformed JSON are client errors', async () => {
  const weak = await send({ method: 'POST', url: '/api/auth/register', payload: { name: 'Test User', email: 'a@b.co', password: 'short' } });
  assert.equal(weak.statusCode, 400);
  assert.equal(weak.json().error.code, 'VALIDATION_ERROR');
  const malformed = await send({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{bad' });
  assert.equal(malformed.statusCode, 400);
});

test('unknown routes return a JSON 404', async () => {
  const response = await send({ method: 'GET', url: '/api/nope' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'NOT_FOUND');
});

test('CORS allows only the configured frontend origin', async () => {
  const allowed = await send({ method: 'OPTIONS', url: '/api/courses', headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'GET' } });
  assert.equal(allowed.headers['access-control-allow-origin'], WEB_ORIGIN);
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  const denied = await send({ method: 'OPTIONS', url: '/api/courses', headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' } });
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  assert.ok(denied.statusCode < 500);
});

test('login is rate limited per client IP behind a trusted proxy', async () => {
  const attempt = (ip: string) => send({
    method: 'POST', url: '/api/auth/login', headers: { 'x-forwarded-for': ip }, payload: { email: 'not-an-email', password: 'x' }
  });
  for (let index = 0; index < 10; index += 1) assert.equal((await attempt('203.0.113.7')).statusCode, 400);
  const limited = await attempt('203.0.113.7');
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
  assert.equal((await attempt('203.0.113.8')).statusCode, 400);
});
