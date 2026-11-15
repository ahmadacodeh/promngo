import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { TokensService } from './tokens.service.js';

/** عام: الحراس العامة (JWT ثم الأدوار) وخدمة الرموز. تُستهلك من كل الوحدات دون استيراد. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [TokensService, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }],
  exports: [TokensService],
})
export class AuthCoreModule {}
