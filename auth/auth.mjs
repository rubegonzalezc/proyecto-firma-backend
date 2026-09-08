import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

let pool = null;
let authInstance = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL es obligatorio para BetterAuth');
    }
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export async function getAuth() {
  if (authInstance) return authInstance;

  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET es obligatorio para BetterAuth');
  }

  const trustedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  authInstance = betterAuth({
    database: getPool(),
    secret,
    baseURL,
    trustedOrigins: [baseURL, ...trustedOrigins],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
    },
    user: {
      additionalFields: {
        fullName: {
          type: 'string',
          required: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const db = getPool();
            await db.query(
              `INSERT INTO public.profiles (id, email, full_name)
               VALUES ($1, $2, $3)
               ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
              [
                user.id,
                user.email,
                user.fullName ?? user.name ?? user.email.split('@')[0],
              ],
            );
          },
        },
      },
    },
  });

  return authInstance;
}
