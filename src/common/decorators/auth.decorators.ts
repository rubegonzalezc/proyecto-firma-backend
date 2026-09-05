import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../types/database.types';

/** Alias de `@AllowAnonymous()` del módulo BetterAuth. */
export const Public = AllowAnonymous;

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
