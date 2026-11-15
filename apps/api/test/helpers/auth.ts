import type { TestApp } from './app.js';
import type { TestUser } from './factories.js';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export async function loginAs(t: TestApp, user: Pick<TestUser, 'email' | 'password'>): Promise<Tokens & { body: any }> {
  const res = await t.http().post('/auth/login').send({ email: user.email, password: user.password });
  if (res.status !== 200) throw new Error(`loginAs فشل (${res.status}): ${JSON.stringify(res.body)}`);
  return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken, body: res.body };
}

export const bearer = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
