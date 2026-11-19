import { createHash } from 'node:crypto';
import { parse } from 'parse5';

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

export function collectInlineCodeHashes(html) {
  const scripts = new Set();
  const handlers = new Set();
  walk(parse(html), (node) => {
    if (node.nodeName === 'script' && !node.attrs.some((attr) => attr.name === 'src')) {
      const body = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
      if (body.trim()) scripts.add(sha256(body));
    }
    for (const attr of node.attrs ?? []) {
      if (/^on[a-z]+$/i.test(attr.name) && attr.value.trim()) handlers.add(sha256(attr.value));
    }
  });
  return { scripts: [...scripts].sort(), handlers: [...handlers].sort() };
}

export function parseApiUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('CODEBROS_API_URL must use https (http is only allowed for localhost).');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('CODEBROS_API_URL must not contain credentials, a query string or a fragment.');
  }
  if (url.pathname.replace(/\/$/, '') !== '/api') {
    throw new Error('CODEBROS_API_URL must end with /api, for example https://codebros-api.vercel.app/api.');
  }
  return { base: `${url.origin}/api`, origin: url.origin };
}

export function buildPolicy({ scripts, handlers, connectOrigin }) {
  const scriptSrc = ["'self'", ...scripts];
  if (handlers.length) scriptSrc.push("'unsafe-hashes'", ...handlers);
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `script-src ${scriptSrc.join(' ')}`,
    `connect-src 'self' ${connectOrigin}`
  ].join('; ');
}

export function hardenPage(html, apiUrl) {
  const api = parseApiUrl(apiUrl);
  const { scripts, handlers } = collectInlineCodeHashes(html);
  if (!/<head[^>]*>/i.test(html)) {
    if (scripts.length || handlers.length || /<script/i.test(html)) {
      throw new Error('Page has scripts but no <head> element to attach the CSP to.');
    }
    return html;
  }
  const apiScript = api ? `window.CODEBROS_API_URL=${JSON.stringify(api.base)};` : '';
  if (apiScript) scripts.push(sha256(apiScript));
  const csp = buildPolicy({ scripts, handlers, connectOrigin: api ? api.origin : 'http://localhost:4000' });
  const injected = `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    (apiScript ? `<script>${apiScript}</script>` : '');
  return html.replace(/<head[^>]*>/i, (head) => head + injected);
}
