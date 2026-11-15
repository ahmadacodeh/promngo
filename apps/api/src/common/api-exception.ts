import { HttpException } from '@nestjs/common';
import { MESSAGES, type MessageCode } from './messages.js';

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  hint?: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  requestId?: string;
}

export interface ApiExceptionOptions {
  message?: string;
  hint?: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
}

/**
 * الاستثناء الموحد لكل أخطاء الأعمال. يحمل رمزًا آليًا ورسالة عربية.
 * مثال: throw new ApiException(409, 'EMAIL_TAKEN');
 */
export class ApiException extends HttpException {
  constructor(
    status: number,
    public readonly code: MessageCode | (string & {}),
    opts: ApiExceptionOptions = {},
  ) {
    const entry = (MESSAGES as Record<string, { message: string; hint?: string }>)[code];
    const body: ApiErrorBody = {
      statusCode: status,
      code,
      message: opts.message ?? entry?.message ?? 'حدث خطأ.',
      ...((opts.hint ?? entry?.hint) ? { hint: opts.hint ?? entry?.hint } : {}),
      ...(opts.fields ? { fields: opts.fields } : {}),
      ...(opts.details ? { details: opts.details } : {}),
    };
    super(body, status);
  }
}

export const notFound = (opts?: ApiExceptionOptions) => new ApiException(404, 'NOT_FOUND', opts);
export const forbidden = (opts?: ApiExceptionOptions) => new ApiException(403, 'FORBIDDEN', opts);
