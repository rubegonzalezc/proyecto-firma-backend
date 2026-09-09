import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createAuthCorsMiddleware } from './auth-cors';
import { BETTER_AUTH_ROUTE_PREFIX } from './auth.constants';
import type { AuthModule, BetterAuthInstance } from './auth.types';
import { importEsm } from './esm-import';
import { toNodeHandler } from './node-handler';

let authPromise: Promise<BetterAuthInstance> | null = null;

function authModuleUrl(): string {
  return pathToFileURL(join(__dirname, '../../../auth/auth.mjs')).href;
}

async function loadAuthModule(): Promise<AuthModule> {
  return importEsm<AuthModule>(authModuleUrl());
}

/** Carga Better Auth como ESM (NestJS CJS + Vercel serverless). */
export async function getAuth(): Promise<BetterAuthInstance> {
  if (!authPromise) {
    const module = await loadAuthModule();
    authPromise = module.getAuth();
  }
  return authPromise;
}

type MountBetterAuthOptions = {
  corsOrigins: string[];
};

export async function mountBetterAuth(
  expressApp: {
    use: (handler: unknown) => void;
  },
  options: MountBetterAuthOptions,
): Promise<void> {
  expressApp.use(createAuthCorsMiddleware(options.corsOrigins));

  const auth = await getAuth();
  const handler = toNodeHandler(auth);

  // Express 5 no admite wildcards tipo `/api/auth/*`.
  expressApp.use((req: IncomingMessage & { path?: string }, res: ServerResponse, next: () => void) => {
    if (!req.path?.startsWith(BETTER_AUTH_ROUTE_PREFIX)) {
      next();
      return;
    }

    void handler(req, res);
  });
}
