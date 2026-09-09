import type { IncomingMessage } from 'http';
import { BETTER_AUTH_ROUTE_PREFIX } from './auth.constants';

type NodeRequest = IncomingMessage & { path?: string; originalUrl?: string };

export function isBetterAuthRoute(req: NodeRequest): boolean {
  const rawPath = req.path ?? req.originalUrl ?? req.url ?? '';
  const pathname = rawPath.split('?')[0];
  return pathname.startsWith(BETTER_AUTH_ROUTE_PREFIX);
}
