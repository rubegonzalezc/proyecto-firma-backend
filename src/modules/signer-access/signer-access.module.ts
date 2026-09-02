import { Module } from '@nestjs/common';
import { OtpService } from './otp.service';
import { SignerSessionService } from './signer-session.service';
import { SignerTokenService } from './signer-token.service';

/**
 * Credenciales del firmante externo: enlace único, código de un solo uso y
 * sesión. Se mantiene aparte de los sobres para que no haya dependencia
 * circular entre emitir enlaces y firmar.
 */
@Module({
  providers: [SignerTokenService, OtpService, SignerSessionService],
  exports: [SignerTokenService, OtpService, SignerSessionService],
})
export class SignerAccessModule {}
