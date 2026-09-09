import type { IncomingMessage, ServerResponse } from 'http';
import { isBetterAuthRoute } from './auth-route';

type NodeRequest = IncomingMessage & { path?: string; method?: string };

export const AUTH_CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Accept',
  'Origin',
  'X-Requested-With',
].join(', ');

export const AUTH_CORS_ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

export function createAuthCorsMiddleware(allowedOrigins: string[]) {
  const origins = new Set(allowedOrigins);

  return (req: NodeRequest, res: ServerResponse, next: () => void) => {
    if (!isBetterAuthRoute(req)) {
      next();
      return;
    }

    const origin = req.headers.origin;
    const isAllowedOrigin = Boolean(origin && origins.has(origin));

    if (isAllowedOrigin && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      if (isAllowedOrigin) {
        res.setHeader('Access-Control-Allow-Methods', AUTH_CORS_ALLOWED_METHODS);
        res.setHeader('Access-Control-Allow-Headers', AUTH_CORS_ALLOWED_HEADERS);
        res.setHeader('Access-Control-Max-Age', '86400');
      }
      res.statusCode = isAllowedOrigin ? 204 : 403;
      res.end();
      return;
    }

    next();
  };
}
