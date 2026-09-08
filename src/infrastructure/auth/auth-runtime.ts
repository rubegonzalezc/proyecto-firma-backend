let authPromise: Promise<Awaited<ReturnType<typeof import('../../../auth/auth.mjs').getAuth>>> | null =
  null;

type AuthModule = typeof import('../../../auth/auth.mjs');

/**
 * Carga Better Auth como ESM desde NestJS (CommonJS) sin usar require().
 * Evita ERR_REQUIRE_ESM con @thallesp/nestjs-better-auth.
 */
export async function getAuth() {
  if (!authPromise) {
    authPromise = import('../../../auth/auth.mjs').then(
      (module: AuthModule) => module.getAuth(),
    );
  }
  return authPromise;
}

export async function mountBetterAuth(expressApp: {
  all: (path: string, handler: unknown) => void;
}): Promise<void> {
  const [{ getAuth: loadAuth }, { toNodeHandler }] = await Promise.all([
    import('../../../auth/auth.mjs') as Promise<AuthModule>,
    import('better-auth/node'),
  ]);

  const auth = await loadAuth();
  expressApp.all('/api/auth/*', toNodeHandler(auth));
}
