import { join } from 'path';
import { pathToFileURL } from 'url';
import { importEsm } from './esm-import';
import { toNodeHandler } from './node-handler';

type AuthModule = {
  getAuth: () => Promise<{
    api: {
      getSession: (input: { headers: HeadersInit }) => Promise<{
        user?: { id: string; email: string };
      } | null>;
    };
    handler: (request: Request) => Promise<Response>;
  }>;
};

let authPromise: ReturnType<AuthModule['getAuth']> | null = null;

function authModuleUrl(): string {
  return pathToFileURL(join(__dirname, '../../../auth/auth.mjs')).href;
}

/**
 * Carga Better Auth como ESM desde NestJS (CommonJS) sin usar require().
 */
export async function getAuth() {
  if (!authPromise) {
    const module = await importEsm<AuthModule>(authModuleUrl());
    authPromise = module.getAuth();
  }
  return authPromise;
}

export async function mountBetterAuth(expressApp: {
  all: (path: string, handler: unknown) => void;
}): Promise<void> {
  const authModule = await importEsm<AuthModule>(authModuleUrl());
  const auth = await authModule.getAuth();
  expressApp.all('/api/auth/*', toNodeHandler(auth));
}
