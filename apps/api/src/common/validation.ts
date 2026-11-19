import type { ValidationError } from 'class-validator';
import { ApiException } from './api-exception.js';
import { FIELD_LABELS } from './messages.js';

const label = (field: string): string => FIELD_LABELS[field.split('.').pop() ?? field] ?? field;

/** رسالة عربية لكل قيد من قيود class-validator (مع إرشاد للإصلاح حيث أمكن). */
function constraintMessage(constraint: string, field: string): string {
  const l = label(field);
  switch (constraint) {
    case 'isNotEmpty':
    case 'isDefined':
      return `حقل «${l}» مطلوب.`;
    case 'isEmail':
      return 'صيغة البريد الإلكتروني غير صحيحة. مثال: name@company.com';
    case 'maxLength':
      return `«${l}» أطول من المسموح؛ اختصره.`;
    case 'minLength':
      return `«${l}» أقصر من المسموح.`;
    case 'isUUID':
      return `معرّف «${l}» غير صالح.`;
    case 'isEnum':
    case 'isIn':
      return `قيمة «${l}» غير مقبولة؛ اختر من القيم المتاحة.`;
    case 'isInt':
    case 'isNumber':
    case 'min':
    case 'max':
      return `قيمة «${l}» غير صالحة (رقم ضمن الحدود المسموحة).`;
    case 'isCalendarDate':
      return `«${l}» ليس تاريخًا صحيحًا؛ استخدم الصيغة YYYY-MM-DD (مثال: 2026-12-31).`;
    case 'isBoolean':
      return `«${l}» يجب أن تكون نعم أو لا.`;
    case 'whitelistValidation':
      return `الحقل «${l}» غير مسموح في هذا الطلب.`;
    default:
      return `قيمة «${l}» غير صالحة.`;
  }
}

function flatten(errors: ValidationError[], prefix: string, out: Record<string, string>): void {
  for (const e of errors) {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    if (e.constraints) {
      const first = Object.keys(e.constraints)[0]!;
      out[path] ??= constraintMessage(first, e.property);
    }
    if (e.children?.length) flatten(e.children, path, out);
  }
}

export function validationExceptionFactory(errors: ValidationError[]): ApiException {
  const fields: Record<string, string> = {};
  flatten(errors, '', fields);
  return new ApiException(400, 'VALIDATION_FAILED', { fields });
}
