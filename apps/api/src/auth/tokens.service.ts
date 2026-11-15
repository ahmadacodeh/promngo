import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ENV_TOKEN, type AppEnv } from '../config/env.js';
import { ApiException } from '../common/api-exception.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AccessClaims {
  sub: string;
  iat: number;
}
export interface RefreshClaims {
  sub: string;
  jti: string;
  iat: number;
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** مقارنة ثابتة الزمن بين تجزئتين hex بالطول نفسه. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV_TOKEN) private readonly env: AppEnv,
  ) {}

  signAccess(userId: string): string {
    return this.jwt.sign({ typ: 'access' }, { subject: userId, secret: this.env.JWT_ACCESS_SECRET, expiresIn: ACCESS_TTL_SECONDS, algorithm: 'HS256' });
  }

  signRefresh(userId: string, sessionId: string): string {
    return this.jwt.sign({ typ: 'refresh' }, { subject: userId, jwtid: sessionId, secret: this.env.JWT_REFRESH_SECRET, expiresIn: REFRESH_TTL_SECONDS, algorithm: 'HS256' });
  }

  /** رمز الوصول فقط (typ=access). رمز التحديث لا يصلح للوصول. */
  verifyAccess(token: string): AccessClaims {
    try {
      const p = this.jwt.verify<{ sub?: string; typ?: string; iat?: number }>(token, { secret: this.env.JWT_ACCESS_SECRET, algorithms: ['HS256'] });
      if (p.typ !== 'access' || !p.sub || typeof p.iat !== 'number') throw new Error('bad claims');
      return { sub: p.sub, iat: p.iat };
    } catch {
      throw new ApiException(401, 'UNAUTHORIZED');
    }
  }

  verifyRefresh(token: string, opts: { ignoreExpiration?: boolean } = {}): RefreshClaims {
    try {
      const p = this.jwt.verify<{ sub?: string; typ?: string; jti?: string; iat?: number }>(token, {
        secret: this.env.JWT_REFRESH_SECRET,
        algorithms: ['HS256'],
        ignoreExpiration: opts.ignoreExpiration ?? false,
      });
      if (p.typ !== 'refresh' || !p.sub || !p.jti || typeof p.iat !== 'number') throw new Error('bad claims');
      return { sub: p.sub, jti: p.jti, iat: p.iat };
    } catch {
      throw new ApiException(401, 'INVALID_REFRESH_TOKEN');
    }
  }
}
