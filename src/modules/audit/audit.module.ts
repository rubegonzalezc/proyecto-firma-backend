import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { DocumentAuditService } from './document-audit.service';

@Module({
  providers: [AuditService, DocumentAuditService],
  exports: [AuditService, DocumentAuditService],
})
export class AuditModule {}
