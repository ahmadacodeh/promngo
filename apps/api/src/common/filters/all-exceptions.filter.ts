import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiException, type ApiErrorBody } from '../api-exception.js';
import { MESSAGES } from '../messages.js';

const STATUS_CODE_MAP: Record<number, { code: string; entry: { message: string; hint?: string } }> = {
  400: { code: 'VALIDATION_FAILED', entry: MESSAGES.VALIDATION_FAILED },
  401: { code: 'UNAUTHORIZED', entry: MESSAGES.UNAUTHORIZED },
  403: { code: 'FORBIDDEN', entry: MESSAGES.FORBIDDEN },
  404: { code: 'NOT_FOUND', entry: { message: 'المسار أو العنصر المطلوب غير موجود.' } },
  409: { code: 'STATE_CONFLICT', entry: MESSAGES.STATE_CONFLICT },
  413: { code: 'PAYLOAD_TOO_LARGE', entry: MESSAGES.PAYLOAD_TOO_LARGE },
  429: { code: 'RATE_LIMITED', entry: MESSAGES.RATE_LIMITED },
};

/**
 * يحوّل كل خطأ إلى الشكل الموحد ApiError. لا يُرسل stack في أي بيئة غير development،
 * ولا يُسجَّل جسم الطلب (قد يحوي كلمات مرور) أبدًا.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(private readonly isDev: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string }>();
    const requestId = req.id ?? (req.headers['x-request-id'] as string | undefined);

    let body: ApiErrorBody;

    if (exception instanceof ApiException) {
      body = { ...(exception.getResponse() as ApiErrorBody) };
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const mapped = STATUS_CODE_MAP[status];
      const raw = exception.getResponse();
      body = {
        statusCode: status,
        code: mapped?.code ?? 'INTERNAL_ERROR',
        message: mapped?.entry.message ?? MESSAGES.INTERNAL_ERROR.message,
        ...(mapped?.entry.hint ? { hint: mapped.entry.hint } : {}),
      };
      // أخطاء Nest الأصلية بالإنجليزية: لا نمررها للمستخدم، لكن نبقيها للمطوّر في dev فقط.
      if (this.isDev && raw && typeof raw === 'object') {
        body.details = { nest: (raw as Record<string, unknown>).message };
      }
    } else if (isBodyParserError(exception)) {
      const status = (exception as { status?: number }).status ?? 400;
      const mapped = STATUS_CODE_MAP[status] ?? STATUS_CODE_MAP[400]!;
      body = {
        statusCode: status,
        code: mapped.code,
        message: status === 413 ? MESSAGES.PAYLOAD_TOO_LARGE.message : 'تعذّرت قراءة الطلب: JSON غير صالح.',
        hint: 'تأكد من صيغة البيانات المرسلة.',
      };
    } else {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      // نسجّل الرسالة فقط (لا parameters ولا body). Stack للمطوّر في dev.
      this.logger.error(`[${requestId ?? '-'}] ${err.name}: ${err.message}`, this.isDev ? err.stack : undefined);
      body = {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: MESSAGES.INTERNAL_ERROR.message,
        hint: MESSAGES.INTERNAL_ERROR.hint,
      };
      if (this.isDev) body.details = { error: err.message };
    }

    if (requestId) body.requestId = requestId;
    if (body.statusCode === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    const retryAfter = body.details?.retryAfterSeconds;
    if (body.statusCode === 429 && typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
    }
    res.status(body.statusCode).json(body);
  }
}

function isBodyParserError(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'type' in e && typeof (e as { type: unknown }).type === 'string' &&
    ['entity.parse.failed', 'entity.too.large', 'encoding.unsupported', 'charset.unsupported'].includes((e as { type: string }).type);
}
