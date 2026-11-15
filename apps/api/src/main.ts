import 'reflect-metadata';
import { createApp } from './app.factory.js';
import { loadEnvFile } from './config/load-env.js';
import { EnvValidationError, validateEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  loadEnvFile();
  let port: number;
  try {
    port = validateEnv(process.env).PORT; // فشل مبكر وواضح عند غياب الأسرار
  } catch (e) {
    if (e instanceof EnvValidationError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  const app = await createApp();
  await app.listen(port);
  console.log(`PROMANGO API يعمل على المنفذ ${port}`);
}

bootstrap().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
