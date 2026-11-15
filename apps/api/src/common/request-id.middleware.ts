import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** يمنح كل طلب معرّفًا (يقبل X-Request-Id آمنًا من العميل) ويعيده في الرأس. */
export function requestId(req: Request & { id?: string }, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const safe = typeof incoming === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID();
  req.id = safe;
  res.setHeader('X-Request-Id', safe);
  next();
}
