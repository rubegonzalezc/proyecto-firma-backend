import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SignerSessionService, type SignerSessionClaims } from '../signer-session.service';

export interface RequestWithSigner extends Request {
  signer: SignerSessionClaims;
}

/**
 * Protege las rutas de sesión del portal. Es independiente del guard de la
 * aplicación: el firmante no tiene cuenta, su credencial es el JWT que se
 * emite tras superar el código de un solo uso.
 */
@Injectable()
export class SignerSessionGuard implements CanActivate {
  constructor(private readonly sessions: SignerSessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithSigner>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta la sesión de firma');
    }

    request.signer = this.sessions.verify(header.slice(7));
    return true;
  }
}
