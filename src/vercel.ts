import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

const expressApp = express();
let isInitialized = false;

async function bootstrapServer(): Promise<express.Express> {
  if (isInitialized) return expressApp;

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressApp),
    {
      logger: ['error', 'warn'],
      bodyParser: false,
    },
  );

  await configureApp(app);
  await app.init();
  isInitialized = true;

  return expressApp;
}

export default async function handler(
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const server = await bootstrapServer();
  server(req, res);
}
