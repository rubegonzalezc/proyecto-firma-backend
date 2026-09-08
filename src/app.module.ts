import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import appConfig from './config/app.config';
import betterAuthConfig from './config/better-auth.config';
import supabaseConfig from './config/supabase.config';
import { envValidationSchema } from './config/env.validation';
import { SupabaseModule } from './infrastructure/supabase/supabase.module';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AuditModule } from './modules/audit/audit.module';
import { EnvelopesModule } from './modules/envelopes/envelopes.module';
import { SignerAccessModule } from './modules/signer-access/signer-access.module';
import { SigningModule } from './modules/signing/signing.module';
import { SigningPortalModule } from './modules/signing-portal/signing-portal.module';
import { VerificationModule } from './modules/verification/verification.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, supabaseConfig, betterAuthConfig],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: true, convert: true },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    SupabaseModule,
    AuthModule,
    DocumentsModule,
    AuditModule,
    SignerAccessModule,
    EnvelopesModule,
    SigningModule,
    SigningPortalModule,
    VerificationModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
