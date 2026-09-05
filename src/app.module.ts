import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import appConfig from './config/app.config';
import supabaseConfig from './config/supabase.config';
import { envValidationSchema } from './config/env.validation';
import { auth } from './auth/auth';
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
      load: [appConfig, supabaseConfig],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: true },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    BetterAuthModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => ({
        auth,
        bodyParser: {
          json: { limit: '25mb' },
          urlencoded: { limit: '25mb', extended: true },
        },
      }),
    }),
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
