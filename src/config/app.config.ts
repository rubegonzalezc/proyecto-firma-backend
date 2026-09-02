import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  verifyBaseUrl: process.env.APP_VERIFY_BASE_URL ?? 'http://localhost:5173',
  portalBaseUrl:
    process.env.APP_PORTAL_BASE_URL ?? process.env.APP_VERIFY_BASE_URL ?? 'http://localhost:5173',
  // Secretos del portal de firma. Se exigen en producción por validación de
  // entorno; en desarrollo caen a un valor fijo para no bloquear el arranque.
  signerJwtSecret: process.env.SIGNER_JWT_SECRET ?? 'dev-signer-jwt-secret',
  otpPepper: process.env.OTP_PEPPER ?? 'dev-otp-pepper',
  tokenPepper: process.env.TOKEN_PEPPER ?? 'dev-token-pepper',
}));
