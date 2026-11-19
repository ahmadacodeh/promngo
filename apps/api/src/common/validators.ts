import { registerDecorator, type ValidationOptions } from 'class-validator';

/** تاريخ تقويمي فعلي بصيغة YYYY-MM-DD (يرفض 2026-02-31). */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

export function IsCalendarDate(options?: ValidationOptions) {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName,
      ...(options ? { options } : {}),
      validator: { validate: isCalendarDate },
    });
  };
}
