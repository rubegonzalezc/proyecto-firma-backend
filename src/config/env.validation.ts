import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().empty('').default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGINS: Joi.string().required(),
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),
  DATABASE_URL: Joi.string().required(),
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  BETTER_AUTH_URL: Joi.string().uri().default('http://localhost:3000'),
  APP_VERIFY_BASE_URL: Joi.string().uri().optional(),
  APP_PORTAL_BASE_URL: Joi.string().uri().optional(),

  // Sin clave el portal no puede entregar el código de un solo uso, así que en
  // producción el firmante externo se queda fuera: se exige.
  RESEND_API_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  MAIL_FROM: Joi.string().optional().allow(''),
  MAIL_REPLY_TO: Joi.string().optional().allow(''),

  SIGNER_JWT_SECRET: Joi.string().min(32).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OTP_PEPPER: Joi.string().min(16).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  TOKEN_PEPPER: Joi.string().min(16).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
});
