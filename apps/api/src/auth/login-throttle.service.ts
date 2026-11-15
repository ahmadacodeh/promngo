import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiException } from '../common/api-exception.js';
import { MAX_FAILURES_PER_EMAIL, MAX_FAILURES_PER_IP, THROTTLE_WINDOW_MS, computeRetryAfterSeconds } from './login-throttle.js';

/** حد محاولات الدخول مخزّن في القاعدة (يصمد أمام إعادة التشغيل ويصح مع أكثر من نسخة). */
@Injectable()
export class LoginThrottleService {
  constructor(private readonly ds: DataSource) {}

  async assertAllowed(emailKey: string, ip: string | undefined): Promise<void> {
    const windowSec = String(THROTTLE_WINDOW_MS / 1000);
    const byEmail: Array<{ created_at: Date; db_now: Date }> = await this.ds.query(
      `SELECT created_at, NOW() AS db_now FROM login_attempts
        WHERE email_key = $1 AND NOT succeeded AND created_at > NOW() - ($2 || ' seconds')::interval`,
      [emailKey, windowSec],
    );
    const byIp: Array<{ created_at: Date; db_now: Date }> = ip
      ? await this.ds.query(
          `SELECT created_at, NOW() AS db_now FROM login_attempts
            WHERE ip = $1 AND NOT succeeded AND created_at > NOW() - ($2 || ' seconds')::interval`,
          [ip, windowSec],
        )
      : [];
    const now = byEmail[0]?.db_now ?? byIp[0]?.db_now ?? new Date();
    const retry = Math.max(
      computeRetryAfterSeconds(byEmail.map((r) => r.created_at), MAX_FAILURES_PER_EMAIL, now),
      computeRetryAfterSeconds(byIp.map((r) => r.created_at), MAX_FAILURES_PER_IP, now),
    );
    if (retry > 0) throw new ApiException(429, 'TOO_MANY_ATTEMPTS', { details: { retryAfterSeconds: retry } });
  }

  async recordFailure(emailKey: string, ip: string | undefined): Promise<void> {
    await this.ds.query(`INSERT INTO login_attempts (email_key, ip, succeeded) VALUES ($1, $2, FALSE)`, [emailKey, ip ?? null]);
    await this.cleanup();
  }

  /** نجاح الدخول يصفّر عدّاد البريد (لا عدّاد IP: لا يُمنح مهاجم موزّع فرصة تصفير). */
  async recordSuccess(emailKey: string, ip: string | undefined): Promise<void> {
    await this.ds.query(`DELETE FROM login_attempts WHERE email_key = $1 AND NOT succeeded`, [emailKey]);
    await this.ds.query(`INSERT INTO login_attempts (email_key, ip, succeeded) VALUES ($1, $2, TRUE)`, [emailKey, ip ?? null]);
  }

  private async cleanup(): Promise<void> {
    await this.ds.query(`DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '2 days'`);
  }
}
