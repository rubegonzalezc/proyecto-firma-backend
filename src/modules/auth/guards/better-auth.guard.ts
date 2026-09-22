import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/auth.decorators';
import type { AuthUser } from '../../../common/types/database.types';
import { getAuth } from '../../../infrastructure/auth/auth-runtime';

@Injectable()
export class BetterAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    try {
      const auth = await getAuth();
      const session = await auth.api.getSession({
        headers: request.headers as HeadersInit,
      });

      if (!session?.user?.id || !session.user.email) {
        throw new UnauthorizedException('Sesión inválida o expirada');
      }

      request.user = {
        id: session.user.id,
        email: session.user.email,
        role: 'authenticated',
      };

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;

      const message = error instanceof Error ? error.message : 'Error de autenticación';
      if (message.includes('Better Auth no configurado')) {
        throw new ServiceUnavailableException(
          'Autenticación no configurada. Revisa DATABASE_URL, BETTER_AUTH_SECRET y BETTER_AUTH_URL.',
        );
      }

      throw new UnauthorizedException('No autorizado');
    }
  }
}
