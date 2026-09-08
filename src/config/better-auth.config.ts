import { registerAs } from '@nestjs/config';

export default registerAs('betterAuth', () => ({
  secret: process.env.BETTER_AUTH_SECRET ?? '',
  url: process.env.BETTER_AUTH_URL ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
}));
