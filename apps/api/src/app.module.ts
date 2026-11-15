import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthCoreModule } from './auth/auth-core.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ENV_TOKEN, validateEnv, type AppEnv } from './config/env.js';
import { CompaniesModule } from './companies/companies.module.js';
import { buildTypeOrmOptions } from './database/data-source.js';
import { HealthModule } from './health/health.controller.js';
import { SpecializationsModule } from './specializations/specializations.module.js';
import { UsersModule } from './users/users.module.js';

@Global()
@Module({
  providers: [{ provide: ENV_TOKEN, useFactory: (): AppEnv => validateEnv(process.env) }],
  exports: [ENV_TOKEN],
})
export class EnvModule {}

/**
 * جذر التطبيق. لإضافة وحدة جديدة (B1b/B2): أنشئ src/<name>/<name>.module.ts وأضفها هنا،
 * ثم أضف migration جديدًا في src/database/migrations وسجّله في MIGRATIONS (data-source.ts).
 */
@Module({
  imports: [
    EnvModule,
    TypeOrmModule.forRootAsync({
      inject: [ENV_TOKEN],
      useFactory: (env: AppEnv) => buildTypeOrmOptions(env),
    }),
    AuthCoreModule,
    AuthModule,
    HealthModule,
    UsersModule,
    CompaniesModule,
    SpecializationsModule,
  ],
})
export class AppModule {}
