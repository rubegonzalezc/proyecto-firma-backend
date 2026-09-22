import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LegalModule } from '../legal/legal.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SignerAccessModule } from '../signer-access/signer-access.module';
import { EnvelopesController } from './envelopes.controller';
import { EnvelopesService } from './envelopes.service';

@Module({
  imports: [AuditModule, SignerAccessModule, NotificationsModule, LegalModule],
  controllers: [EnvelopesController],
  providers: [EnvelopesService],
  exports: [EnvelopesService],
})
export class EnvelopesModule {}
