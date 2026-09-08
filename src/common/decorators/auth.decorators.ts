import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser } from '../types/database.types';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca una ruta como pública (sin sesión Better Auth). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{
      session?: { user?: { id: string; email: string; role?: string } };
      user?: { id: string; email: string; role?: string };
    }>();
    const user = request.session?.user ?? request.user;
    if (!user?.id || !user?.email) {
      throw new Error('Usuario no autenticado');
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role ?? 'user',
    };
  },
);
