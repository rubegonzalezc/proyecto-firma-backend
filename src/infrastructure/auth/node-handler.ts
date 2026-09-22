import type { IncomingMessage, ServerResponse } from 'http';
import type { BetterAuthInstance } from './auth.types';

type NodeRequest = IncomingMessage & { originalUrl?: string };

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (!req.method || req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function buildRequestUrl(req: NodeRequest): string {
  const host = req.headers.host ?? 'localhost';
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto ?? 'https';
  const path = req.originalUrl ?? req.url ?? '/';

  return `${protocol}://${host}${path}`;
}

async function toFetchRequest(req: NodeRequest): Promise<Request> {
  const body = await readRequestBody(req);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
    } else {
      headers.set(key, value);
    }
  }

  return new Request(buildRequestUrl(req), {
    method: req.method ?? 'GET',
    headers,
    body: body && body.length > 0 ? new Uint8Array(body) : undefined,
  });
}

async function sendFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Adaptador Express/Node sin depender de `better-auth/node`. */
export function toNodeHandler(auth: BetterAuthInstance) {
  return async (req: NodeRequest, res: ServerResponse) => {
    const response = await auth.handler(await toFetchRequest(req));
    await sendFetchResponse(res, response);
  };
}
