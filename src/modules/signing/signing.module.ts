import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EnvelopesModule } from '../envelopes/envelopes.module';
import { LegalModule } from '../legal/legal.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CertificateService } from './pdf/certificate.service';
import { PdfStampService } from './pdf/pdf-stamp.service';
import { SigningService } from './signing.service';

@Module({
  imports: [AuditModule, EnvelopesModule, NotificationsModule, LegalModule],
  providers: [PdfStampService, CertificateService, SigningService],
  exports: [SigningService, PdfStampService, CertificateService],
})
export class SigningModule {}
