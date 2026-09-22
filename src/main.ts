import { ConfigService } from '@nestjs/config';
export { NestFactory } from '@nestjs/core';
import { createNestApplication } from './bootstrap/nest-app';
import { BETTER_AUTH_ROUTE_PREFIX } from './infrastructure/auth/auth.constants';

async function bootstrap() {
  const app = await createNestApplication();

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const apiPrefix = config.get<string>('app.apiPrefix', 'api/v1');

  await app.listen(port);
  console.log(`SynchroSign API running on http://localhost:${port}/${apiPrefix}`);
  console.log(`Swagger docs: http://localhost:${port}/docs`);
  console.log(`BetterAuth: http://localhost:${port}${BETTER_AUTH_ROUTE_PREFIX}`);
}

bootstrap();
