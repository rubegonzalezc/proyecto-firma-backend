import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EnvelopesModule } from '../envelopes/envelopes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CertificateService } from './pdf/certificate.service';
import { DocumentStampService } from './pdf/document-stamp.service';
import { PdfStampService } from './pdf/pdf-stamp.service';
import { SigningService } from './signing.service';

@Module({
  imports: [AuditModule, EnvelopesModule, NotificationsModule],
  providers: [PdfStampService, CertificateService, DocumentStampService, SigningService],
  exports: [SigningService, PdfStampService, CertificateService, DocumentStampService],
})
export class SigningModule {}
