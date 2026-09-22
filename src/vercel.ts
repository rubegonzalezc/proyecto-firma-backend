import type { Express, Request, Response } from 'express';
import express from 'express';
import { createNestApplication } from './bootstrap/nest-app';

const expressApp = express();
let isInitialized = false;

async function bootstrapServer(): Promise<Express> {
  if (isInitialized) return expressApp;

  const app = await createNestApplication({
    expressInstance: expressApp,
    logger: ['error', 'warn'],
  });

  await app.init();
  isInitialized = true;

  return expressApp;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  const server = await bootstrapServer();
  server(req, res);
}
