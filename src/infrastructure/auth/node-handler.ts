import type { IncomingMessage, ServerResponse } from 'http';

type AuthHandler = {
  handler: (request: Request) => Promise<Response>;
};

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

function buildRequestUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? 'localhost';
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto ?? 'https';

  return `${protocol}://${host}${req.url ?? '/'}`;
}

async function toFetchRequest(req: IncomingMessage): Promise<Request> {
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

  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

/** Adaptador Express/Node sin depender de `better-auth/node` (no siempre incluido en Vercel). */
export function toNodeHandler(auth: AuthHandler) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const request = await toFetchRequest(req);
    const response = await auth.handler(request);
    await sendFetchResponse(res, response);
  };
}
