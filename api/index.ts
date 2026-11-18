import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../src/server.js';

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await app.ready();
  const url = request.url || '/';
  const payload = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : await readPayload(request);
  type InjectedResponse = {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    rawPayload: Buffer;
  };
  const inject = app.inject as unknown as (options: { method: string; url: string; headers: IncomingHttpHeaders; payload?: Buffer }) => Promise<InjectedResponse>;
  const result = await inject({
    method: request.method || 'GET',
    url,
    headers: request.headers as IncomingHttpHeaders,
    payload
  });

  response.statusCode = result.statusCode;
  for (const [name, value] of Object.entries(result.headers)) {
    if (value !== undefined) response.setHeader(name, String(value));
  }
  response.end(result.rawPayload);
}

async function readPayload(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
