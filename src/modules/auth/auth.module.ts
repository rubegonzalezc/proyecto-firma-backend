import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BetterAuthGuard } from './guards/better-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: BetterAuthGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
