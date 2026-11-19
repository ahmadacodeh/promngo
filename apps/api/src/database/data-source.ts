import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { buildDbSslOptions, type AppEnv } from '../config/env.js';
import { InitialSchema1794100000000 } from './migrations/1794100000000-InitialSchema.js';
import { AuthAndSecurity1794100000100 } from './migrations/1794100000100-AuthAndSecurity.js';
import { WorkModules1794100000200 } from './migrations/1794100000200-WorkModules.js';

/**
 * قائمة الـ migrations صريحة (فئات مستوردة) لا glob: تعمل مع ESM ومع vitest بلا اعتماد على dist.
 * عند إضافة migration جديد: استورده وأضفه هنا بالترتيب الزمني.
 */
export const MIGRATIONS = [InitialSchema1794100000000, AuthAndSecurity1794100000100, WorkModules1794100000200];

export function buildTypeOrmOptions(env: Pick<AppEnv, 'DATABASE_URL' | 'DATABASE_SSL' | 'DATABASE_SSL_CA' | 'NODE_ENV'>): DataSourceOptions {
  return {
    type: 'postgres',
    url: env.DATABASE_URL,
    ssl: buildDbSslOptions(env.DATABASE_SSL, env.DATABASE_SSL_CA),
    synchronize: false,
    migrationsRun: false,
    migrations: MIGRATIONS,
    entities: [],
    logging: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    extra: { max: 10, application_name: 'promango-api' },
  };
}

export function createDataSource(env: Parameters<typeof buildTypeOrmOptions>[0]): DataSource {
  return new DataSource(buildTypeOrmOptions(env));
}
