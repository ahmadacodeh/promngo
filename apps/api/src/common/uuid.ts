import { Injectable, type PipeTransform } from '@nestjs/common';
import { notFound } from './api-exception.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** معرّف مسار غير صالح = 404 (لا نكشف الفرق بين «غير موجود» و«صيغة خاطئة»، ولا نمرّر نصًا لـ PostgreSQL). */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUuid(value)) throw notFound();
    return value;
  }
}
