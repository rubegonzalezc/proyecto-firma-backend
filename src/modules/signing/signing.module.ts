import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EnvelopesModule } from '../envelopes/envelopes.module';
import { CertificateService } from './pdf/certificate.service';
import { PdfStampService } from './pdf/pdf-stamp.service';
import { SigningService } from './signing.service';

@Module({
  imports: [AuditModule, EnvelopesModule],
  providers: [PdfStampService, CertificateService, SigningService],
  exports: [SigningService, PdfStampService, CertificateService],
})
export class SigningModule {}
