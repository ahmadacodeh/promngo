import { describe, expect, it } from 'vitest';
import { auditPeriodRange, inclusiveDayBounds } from './audit-period.js';

describe('auditPeriodRange', () => {
  it('daily: اليوم كاملًا بتوقيت UTC', () => {
    const r = auditPeriodRange('daily', '2026-11-16');
    expect(r.from.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });
  it('weekly: سبعة أيام تنتهي باليوم المحدد شاملًا', () => {
    const r = auditPeriodRange('weekly', '2026-11-16');
    expect(r.from.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-17T00:00:00.000Z');
    expect((r.to.getTime() - r.from.getTime()) / 86_400_000).toBe(7);
  });
  it('الافتراضي اليوم (UTC) لا اليوم المحلي', () => {
    const r = auditPeriodRange('daily', undefined, new Date('2026-11-16T23:30:00.000Z'));
    expect(r.from.toISOString()).toBe('2026-11-16T00:00:00.000Z');
  });
  it('يعبر حدود الشهر والسنة', () => {
    expect(auditPeriodRange('weekly', '2027-01-03').from.toISOString()).toBe('2026-12-28T00:00:00.000Z');
    expect(auditPeriodRange('daily', '2026-02-28').to.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('inclusiveDayBounds', () => {
  it('to شامل لليوم كله', () => {
    const b = inclusiveDayBounds('2026-11-01', '2026-11-01');
    expect(b.gte!.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(b.lt!.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
  it('الحدود اختيارية', () => {
    expect(inclusiveDayBounds()).toEqual({});
    expect(inclusiveDayBounds(undefined, '2026-11-01').gte).toBeUndefined();
  });
});
