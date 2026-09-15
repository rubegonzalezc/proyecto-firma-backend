import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LegalModule } from '../legal/legal.module';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [AuditModule, LegalModule],
  controllers: [VerificationController],
  providers: [VerificationService],
})
export class VerificationModule {}
