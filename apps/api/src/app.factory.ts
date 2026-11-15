import 'reflect-metadata';
import { ValidationPipe, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { requestId } from './common/request-id.middleware.js';
import { validationExceptionFactory } from './common/validation.js';
import { ENV_TOKEN, type AppEnv } from './config/env.js';

/** يُنشئ التطبيق ويضبطه (يُستخدم في main.ts وفي اختبارات E2E بالإعداد نفسه تمامًا). */
export async function createApp(rootModule: Type<unknown> = AppModule): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    logger: process.env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  const env = app.get<AppEnv>(ENV_TOKEN);

  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');
  app.use(requestId);
  // استجابات API تحمل بيانات مصادقة/شركة (وأحيانًا كلمة مؤقتة): لا تُخزَّن في أي مخبأ.
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet());
  app.enableCors({
    origin: env.WEB_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['Content-Disposition', 'X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: validationExceptionFactory }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(env.NODE_ENV === 'development'));
  app.enableShutdownHooks();
  return app;
}
