import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EnvelopesModule } from '../envelopes/envelopes.module';
import { SignerAccessModule } from '../signer-access/signer-access.module';
import { SigningModule } from '../signing/signing.module';
import { SigningPortalController } from './signing-portal.controller';

@Module({
  imports: [SignerAccessModule, EnvelopesModule, SigningModule, AuditModule],
  controllers: [SigningPortalController],
})
export class SigningPortalModule {}
