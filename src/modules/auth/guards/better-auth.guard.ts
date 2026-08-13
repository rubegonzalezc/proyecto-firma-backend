import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/auth.decorators';

/**
 * Placeholder hasta integrar BetterAuth.
 * Las rutas protegidas responden 503; las marcadas con @Public() siguen disponibles.
 */
@Injectable()
export class BetterAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    throw new ServiceUnavailableException(
      'Autenticación pendiente: BetterAuth será integrado próximamente',
    );
  }
}
