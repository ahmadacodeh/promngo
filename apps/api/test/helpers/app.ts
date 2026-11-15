import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp } from '../../src/app.factory.js';

export interface TestApp {
  app: NestExpressApplication;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** يبني التطبيق نفسه المستخدم في الإنتاج (helmet/CORS/pipes/filter) فوق قاعدة الاختبار. */
export async function createTestApp(opts: { trustProxy?: boolean; rootModule?: Type<unknown> } = {}): Promise<TestApp> {
  const prev = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = opts.trustProxy ? '1' : '0';
  const app = await createApp(opts.rootModule);
  await app.init();
  if (prev === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = prev;
  return { app, http: () => request(app.getHttpServer()), close: () => app.close() };
}
