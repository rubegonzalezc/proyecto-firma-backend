import { INestApplication, ValidationPipe } from '@nestjs/common';
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
