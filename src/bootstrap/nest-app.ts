import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';
import { AppModule } from '../app.module';
import { configureApp } from '../configure-app';

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

type CreateNestAppOptions = {
  expressInstance?: Express;
  logger?: LogLevel[];
};

export async function createNestApplication(
  options: CreateNestAppOptions = {},
): Promise<NestExpressApplication> {
  const logger = options.logger ?? ['error', 'warn', 'log'];

  const app = options.expressInstance
    ? await NestFactory.create<NestExpressApplication>(
        AppModule,
        new ExpressAdapter(options.expressInstance),
        { logger, bodyParser: false },
      )
    : await NestFactory.create<NestExpressApplication>(AppModule, {
        logger,
        bodyParser: false,
      });

  await configureApp(app);
  return app;
}
