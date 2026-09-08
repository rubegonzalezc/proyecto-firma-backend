import type { Request, Response } from 'express';

type NestHandler = (req: Request, res: Response) => Promise<void>;

let nestHandler: NestHandler | undefined;

/**
 * Punto de entrada serverless de Vercel.
 * NestJS se compila a `dist/vercel.js` en el build step.
 */
export default async function handler(req: Request, res: Response) {
  if (!nestHandler) {
    const module = await import('../dist/vercel.js');
    nestHandler = module.default as NestHandler;
  }

  return nestHandler(req, res);
}
