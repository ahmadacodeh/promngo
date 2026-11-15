import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ApiException } from '../common/api-exception.js';
import { REFRESH_TTL_SECONDS, TokensService, safeEqualHex, sha256Hex } from './tokens.service.js';

export interface SessionMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}
// oxlint-disable-next-line typescript/no-explicit-any -- نتائج pg غير مصنّفة النوع
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

export interface RotatedSession {
  userId: string;
  companyId: string;
  refreshToken: string;
}

/**
 * جلسات التحديث: رمز التحديث JWT (jti = معرّف الجلسة) ويُخزَّن SHA-256 فقط.
 * استخدام واحد (تدوير). إعادة استخدام رمز مُدوَّر = سرقة محتملة ← إبطال كل جلسات المستخدم.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly ds: DataSource,
    private readonly tokens: TokensService,
  ) {}

  async create(db: Queryable, userId: string, companyId: string, meta: SessionMeta): Promise<string> {
    const id = randomUUID();
    const token = this.tokens.signRefresh(userId, id);
    await this.insert(db, id, userId, companyId, token, meta);
    return token;
  }

  private async insert(db: Queryable, id: string, userId: string, companyId: string, token: string, meta: SessionMeta) {
    await db.query(
      `INSERT INTO refresh_sessions (id, user_id, company_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, $4, NOW() + ($5 || ' seconds')::interval, $6, $7)`,
      [id, userId, companyId, sha256Hex(token), String(REFRESH_TTL_SECONDS), meta.ip ?? null, meta.userAgent?.slice(0, 255) ?? null],
    );
  }

  /** يُبطل كل جلسات المستخدم وكل رموز الوصول الصادرة قبل الآن (بالثواني الكاملة). */
  async revokeAll(userId: string, db: Queryable = this.ds): Promise<void> {
    await db.query(`UPDATE refresh_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await db.query(`UPDATE users SET tokens_invalid_before = NOW() WHERE id = $1`, [userId]);
  }

  /** logout: يُبطل جلسة واحدة. يقبل رمزًا منتهيًا؛ لا يرمي لرمز غير صالح (idempotent). */
  async revokeByToken(token: string): Promise<void> {
    let jti: string;
    try {
      jti = this.tokens.verifyRefresh(token, { ignoreExpiration: true }).jti;
    } catch {
      return;
    }
    await this.ds.query(`UPDATE refresh_sessions SET revoked_at = NOW() WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL`, [jti, sha256Hex(token)]);
  }

  async rotate(token: string, meta: SessionMeta): Promise<RotatedSession> {
    const claims = this.tokens.verifyRefresh(token);
    const rows = await this.ds.query(
      `SELECT s.id, s.user_id, s.company_id, s.token_hash, s.revoked_at, (s.expires_at < NOW()) AS expired,
              u.is_active, u.tokens_invalid_before, c.status AS company_status
         FROM refresh_sessions s
         JOIN users u ON u.id = s.user_id
         JOIN companies c ON c.id = s.company_id
        WHERE s.id = $1`,
      [claims.jti],
    );
    const s = rows[0];
    if (!s || s.user_id !== claims.sub || !safeEqualHex(s.token_hash.trim(), sha256Hex(token))) {
      throw new ApiException(401, 'INVALID_REFRESH_TOKEN');
    }
    if (s.revoked_at) {
      await this.revokeAll(s.user_id); // إعادة استخدام رمز مُدوَّر
      throw new ApiException(401, 'INVALID_REFRESH_TOKEN');
    }
    if (s.expired || !s.is_active) throw new ApiException(401, 'INVALID_REFRESH_TOKEN');
    if (s.company_status !== 'ACTIVE') throw new ApiException(403, 'COMPANY_NOT_ACTIVE');
    if (s.tokens_invalid_before && claims.iat < Math.floor(new Date(s.tokens_invalid_before).getTime() / 1000)) {
      throw new ApiException(401, 'INVALID_REFRESH_TOKEN');
    }

    const newId = randomUUID();
    const newToken = this.tokens.signRefresh(s.user_id, newId);
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    try {
      await qr.startTransaction();
      // شرط revoked_at IS NULL يجعل التدوير ذريًا: طلبان متزامنان بالرمز نفسه ينجح واحد فقط.
      const upd = await qr.query(
        `UPDATE refresh_sessions SET revoked_at = NOW(), replaced_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
        [s.id, newId],
      );
      const updated = Array.isArray(upd[0]) ? upd[0] : upd; // pg يعيد [rows, count] في UPDATE ... RETURNING عبر TypeORM
      if (updated.length === 0) {
        await qr.rollbackTransaction();
        await this.revokeAll(s.user_id);
        throw new ApiException(401, 'INVALID_REFRESH_TOKEN');
      }
      await this.insert(qr, newId, s.user_id, s.company_id, newToken, meta);
      await qr.commitTransaction();
    } catch (e) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
    return { userId: s.user_id, companyId: s.company_id, refreshToken: newToken };
  }
}
