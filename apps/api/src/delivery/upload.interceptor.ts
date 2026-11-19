import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import { ApiException } from '../common/api-exception.js';
import { FILE_LIMITS } from '../work/model.js';

/**
 * يقرأ حقل `files` (حتى 5 ملفات) في الذاكرة فقط: لا يُكتب شيء على القرص قبل اجتياز كل فحوصات
 * الصلاحية والحالة والمحتوى في الخدمة. يعمل بعد JwtAuthGuard (لا رفع بلا مصادقة).
 * سقف الذاكرة للطلب = 5 × 10MB. أخطاء multer تتحول إلى أخطاء عربية موحدة.
 */
@Injectable()
export class SubmitUploadInterceptor implements NestInterceptor {
  private readonly parse = multer({
    storage: multer.memoryStorage(),
    limits: { files: FILE_LIMITS.maxFiles, fileSize: FILE_LIMITS.maxBytes, fields: 4, fieldSize: 16 * 1024, parts: 12, headerPairs: 40 },
  }).array('files', FILE_LIMITS.maxFiles);

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    await new Promise<void>((resolve, reject) => {
      this.parse(req, res, (err: unknown) => (err ? reject(mapMulterError(err)) : resolve()));
    });
    return next.handle();
  }
}

export function mapMulterError(err: unknown): Error {
  if (err instanceof ApiException) return err;
  const e = err as { code?: string; field?: string; message?: string };
  switch (e.code) {
    case 'LIMIT_FILE_SIZE':
      return new ApiException(413, 'FILE_TOO_LARGE');
    case 'LIMIT_FILE_COUNT':
      return new ApiException(400, 'TOO_MANY_FILES', { fields: { files: 'عدد الملفات أكبر من المسموح (5).' } });
    case 'LIMIT_UNEXPECTED_FILE':
      return e.field === 'files'
        ? new ApiException(400, 'TOO_MANY_FILES', { fields: { files: 'عدد الملفات أكبر من المسموح (5).' } })
        : new ApiException(400, 'VALIDATION_FAILED', { fields: { [String(e.field ?? 'files')]: 'حقل ملفات غير متوقع؛ استخدم الحقل «files».' } });
    case 'LIMIT_PART_COUNT':
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_VALUE':
      return new ApiException(400, 'VALIDATION_FAILED', { message: 'الطلب يحوي حقولًا أكثر أو أكبر من المسموح.' });
    default:
      return new ApiException(400, 'VALIDATION_FAILED', { message: 'تعذّرت قراءة الملفات المرفوعة.', hint: 'أرسل الطلب بصيغة multipart/form-data صحيحة وأعد المحاولة.' });
  }
}
