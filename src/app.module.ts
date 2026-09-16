import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import appConfig from './config/app.config';
import mailConfig from './config/mail.config';
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
import { LegalModule } from './modules/legal/legal.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      load: [appConfig, supabaseConfig, mailConfig],
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
    MailModule,
    AuthModule,
    DocumentsModule,
    AuditModule,
    SignerAccessModule,
    EnvelopesModule,
    SigningModule,
    SigningPortalModule,
    VerificationModule,
    NotificationsModule,
    LegalModule,
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
