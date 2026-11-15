import { describe, expect, it } from 'vitest';
import { computeRetryAfterSeconds, THROTTLE_WINDOW_MS } from './login-throttle.js';

const now = new Date('2026-01-01T12:00:00Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000);

describe('computeRetryAfterSeconds', () => {
  it('0 دون بلوغ الحد', () => expect(computeRetryAfterSeconds([ago(10), ago(20)], 5, now)).toBe(0));
  it('عند بلوغ الحد ينتظر حتى تخرج أقدم فاشلة مؤثرة من النافذة', () => {
    const fails = [ago(600), ago(500), ago(400), ago(300), ago(200)];
    expect(computeRetryAfterSeconds(fails, 5, now)).toBe(THROTTLE_WINDOW_MS / 1000 - 600);
  });
  it('مع تجاوز الحد يحسب الفاشلة رقم (n - limit + 1)', () => {
    const fails = [ago(800), ago(700), ago(600), ago(500), ago(400), ago(300)]; // 6 فاشلات، الحد 5
    expect(computeRetryAfterSeconds(fails, 5, now)).toBe(900 - 700);
  });
  it('تتجاهل الأقدم من النافذة', () => expect(computeRetryAfterSeconds([ago(1000), ago(1100), ago(1200), ago(1300), ago(1400)], 5, now)).toBe(0));
  it('لا تقل عن ثانية واحدة عند الحجب', () => {
    const fails = [ago(899.9), ago(5), ago(4), ago(3), ago(2)];
    expect(computeRetryAfterSeconds(fails, 5, now)).toBeGreaterThanOrEqual(1);
  });
});
