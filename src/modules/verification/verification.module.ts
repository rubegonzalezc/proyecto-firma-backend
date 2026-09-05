import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [AuditModule],
  controllers: [VerificationController],
  providers: [VerificationService],
})
export class VerificationModule {}
