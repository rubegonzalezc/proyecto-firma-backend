import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import express from 'express';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AUTH_CORS_ALLOWED_HEADERS } from './infrastructure/auth/auth-cors';
import { mountBetterAuth } from './infrastructure/auth/auth-runtime';

export async function configureApp(app: INestApplication): Promise<void> {
  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('app.apiPrefix', 'api/v1');
  const corsOrigins = config.get<string[]>('app.corsOrigins', []);

  const expressApp = app.getHttpAdapter().getInstance();
  if (typeof expressApp.set === 'function') {
    expressApp.set('trust proxy', 1);
  }

  await mountBetterAuth(expressApp, { corsOrigins });

  expressApp.use(express.json({ limit: '25mb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '25mb' }));

  app.setGlobalPrefix(apiPrefix);

  announceLinkTargets(config);
  mountWrongHostDiagnostics(expressApp, apiPrefix);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: AUTH_CORS_ALLOWED_HEADERS.split(', '),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SynchroSign API')
    .setDescription('API de gestión documental y verificación pública')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
}

/**
 * Las rutas `/sign/:token` y `/verify/:code` las sirve el **frontend**, no el
 * API. Cuando `APP_PORTAL_BASE_URL` apunta por error al backend, los enlaces de
 * los correos y los QR de la hoja de certificación acaban aquí, y lo único que
 * ve el firmante es un 404 sin explicación.
 *
 * Esto convierte ese 404 en un mensaje que dice exactamente qué está mal. Se
 * monta fuera del prefijo del API a propósito: las rutas reales viven bajo
 * `/api/v1/sign/...` y no se tocan.
 */
function mountWrongHostDiagnostics(expressApp: express.Express, apiPrefix: string): void {
  if (typeof expressApp.get !== 'function') return;

  for (const path of ['/sign/:token', '/verify/:code']) {
    expressApp.get(path, (_req, res) => {
      res.status(404).json({
        statusCode: 404,
        message:
          'Esta dirección es la del API, no la de la aplicación. El enlace de firma debe apuntar al frontend: revisa APP_PORTAL_BASE_URL y APP_VERIFY_BASE_URL en el servidor.',
        apiBase: `/${apiPrefix}`,
        timestamp: new Date().toISOString(),
      });
    });
  }
}

/**
 * Deja escrito al arrancar a dónde van a apuntar los enlaces que se envían por
 * correo y los QR de la hoja de certificación.
 *
 * Un enlace mal configurado solo se descubre cuando alguien lo recibe y no
 * puede firmar, y para entonces el correo ya salió con la dirección incorrecta
 * grabada dentro: corregir la configuración no arregla los correos ya enviados.
 * Verlo en el arranque cuesta una línea.
 */
function announceLinkTargets(config: ConfigService): void {
  const logger = new Logger('Enlaces');
  const portal = config.get<string>('app.portalBaseUrl') ?? '';
  const verify = config.get<string>('app.verifyBaseUrl') ?? '';

  logger.log(`Firma:        ${portal}/sign/:token`);
  logger.log(`Verificación: ${verify}/verify/:code`);

  const authUrl = config.get<string>('app.nodeEnv') === 'production' ? '' : process.env.BETTER_AUTH_URL;
  if (portal && authUrl && normalizeOrigin(portal) === normalizeOrigin(authUrl)) {
    logger.warn(
      `APP_PORTAL_BASE_URL (${portal}) apunta al mismo origen que el API. ` +
        'Los enlaces de firma darán 404: debe apuntar al frontend.',
    );
  }
}

function normalizeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/$/, '');
  }
}
