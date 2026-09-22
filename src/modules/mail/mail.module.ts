import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Global porque el correo lo necesitan el portal, los sobres y la firma, y
 * enhebrar el módulo por cada uno solo añade ruido: no tiene estado ni
 * dependencias propias más allá de la configuración.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
