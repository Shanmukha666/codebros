import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildPolicy, collectInlineCodeHashes, hardenPage, parseApiUrl } from '../scripts/csp.mjs';

const sha = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
const page = `<!doctype html><html><head><title>t</title></head><body>
<button onclick="toggle('a &amp; b')">x</button>
<script>let a = 1;</script><script src="../shared/codebros.js"></script></body></html>`;

test('hashes inline scripts and decoded handler attributes', () => {
  const { scripts, handlers } = collectInlineCodeHashes(page);
  assert.deepEqual(scripts, [sha('let a = 1;')]);
  assert.deepEqual(handlers, [sha("toggle('a & b')")]);
});

test('policy never allows blanket inline scripts', () => {
  const { scripts, handlers } = collectInlineCodeHashes(page);
  const policy = buildPolicy({ scripts, handlers, connectOrigin: 'https://api.example.com' });
  const scriptSrc = policy.split('; ').find((part) => part.startsWith('script-src'));
  assert.ok(!scriptSrc.includes("'unsafe-inline'"));
  assert.ok(scriptSrc.includes("'unsafe-hashes'"));
  assert.ok(policy.includes("connect-src 'self' https://api.example.com"));
});

test('puts the policy first in <head> and injects the API URL', () => {
  const output = hardenPage(page, 'https://api.example.com/api');
  assert.match(output, /<head><meta http-equiv="Content-Security-Policy"/);
  const injected = 'window.CODEBROS_API_URL="https://api.example.com/api";';
  assert.ok(output.includes(`<script>${injected}</script>`));
  assert.ok(output.includes(sha(injected)));
});

test('validates the API URL', () => {
  assert.equal(parseApiUrl(''), null);
  assert.deepEqual(parseApiUrl('https://api.example.com/api/'), { base: 'https://api.example.com/api', origin: 'https://api.example.com' });
  assert.ok(parseApiUrl('http://localhost:4000/api'));
  assert.throws(() => parseApiUrl('http://api.example.com/api'), /https/);
  assert.throws(() => parseApiUrl('https://api.example.com'), /\/api/);
  assert.throws(() => parseApiUrl('https://user:pw@api.example.com/api'), /credentials/);
});
