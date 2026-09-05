import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGINS: Joi.string().required(),
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),
  DATABASE_URL: Joi.string().required(),
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  BETTER_AUTH_URL: Joi.string().uri().default('http://localhost:3000'),
  APP_VERIFY_BASE_URL: Joi.string().uri().optional(),
  APP_PORTAL_BASE_URL: Joi.string().uri().optional(),

  // El portal de firma emite sesiones y guarda hashes con pepper. Con valores
  // por defecto en producción, cualquiera podría falsificar una sesión de
  // firmante o romper los códigos por fuerza bruta, así que ahí son
  // obligatorios y de longitud mínima.
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
