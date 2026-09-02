import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

/** Sesión corta: solo cubre lo que dura leer y firmar el documento. */
const SESSION_TTL = '30m';
const AUDIENCE = 'signer-portal';

export interface SignerSessionClaims {
  signerId: string;
  envelopeId: string;
  tokenId: string;
}

@Injectable()
export class SignerSessionService {
  constructor(private readonly config: ConfigService) {}

  private get secret(): string {
    return this.config.getOrThrow<string>('app.signerJwtSecret');
  }

  issue(claims: SignerSessionClaims): { token: string; expiresIn: string } {
    const token = jwt.sign(claims, this.secret, {
      expiresIn: SESSION_TTL,
      audience: AUDIENCE,
    });
    return { token, expiresIn: SESSION_TTL };
  }

  verify(token: string): SignerSessionClaims {
    try {
      const payload = jwt.verify(token, this.secret, { audience: AUDIENCE });
      const claims = payload as jwt.JwtPayload & Partial<SignerSessionClaims>;

      if (!claims.signerId || !claims.envelopeId || !claims.tokenId) {
        throw new Error('Claims incompletos');
      }

      return {
        signerId: claims.signerId,
        envelopeId: claims.envelopeId,
        tokenId: claims.tokenId,
      };
    } catch {
      throw new UnauthorizedException('Sesión de firma inválida o expirada');
    }
  }
}
