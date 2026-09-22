import type { AuthModule } from '../src/infrastructure/auth/auth.types';

export function getAuth(): ReturnType<AuthModule['getAuth']>;
