import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * أمن المصادقة داخل القاعدة:
 *  - pgcrypto (تجزئة bcrypt والتحقق يجريان داخل PostgreSQL؛ التطبيق لا يجزّئ ولا يقرأ password_hash).
 *  - أعمدة المستخدم الإضافية، جداول الجلسات ومحاولات الدخول، trigger لـ updated_at.
 *  - تخصصات عالمية مرجعية (بيانات مرجعية لا بيانات تجريبية).
 */
export class AuthAndSecurity1794100000100 implements MigrationInterface {
  name = 'AuthAndSecurity1794100000100';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await q.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END $$;

      CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await q.query(`
      ALTER TABLE users
        ADD COLUMN password_hash TEXT,
        ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN tokens_invalid_before TIMESTAMPTZ,
        ADD COLUMN specialization_id UUID REFERENCES specializations(id) ON DELETE RESTRICT;
      CREATE INDEX idx_users_specialization ON users(specialization_id);
      -- البريد غير حساس لحالة الأحرف: فهرس فريد على lower(email) يكمّل UNIQUE(email) الأصلي.
      CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
      ALTER TABLE users ADD CONSTRAINT users_password_hash_format
        CHECK (password_hash IS NULL OR password_hash ~ '^\\$2[aby]\\$[0-9]{2}\\$.{53}$');
    `);

    await q.query(`
      CREATE TABLE login_attempts (
        id BIGSERIAL PRIMARY KEY,
        email_key TEXT NOT NULL,
        ip TEXT,
        succeeded BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX idx_login_attempts_email ON login_attempts (email_key, created_at DESC) WHERE NOT succeeded;
      CREATE INDEX idx_login_attempts_ip ON login_attempts (ip, created_at DESC) WHERE NOT succeeded;
      CREATE INDEX idx_login_attempts_created ON login_attempts (created_at);

      CREATE TABLE refresh_sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        company_id UUID NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        replaced_by UUID,
        ip TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE
      );
      CREATE INDEX idx_refresh_sessions_user ON refresh_sessions (user_id) WHERE revoked_at IS NULL;
    `);

    // تخصصات مرجعية عالمية (قرار المتطلبات: التخصصات مشتركة عالميًا)
    await q.query(`
      INSERT INTO specializations (name, description) VALUES
        ('تقنية المعلومات', 'البنية التقنية والدعم والأنظمة'),
        ('الواجهات الأمامية', 'تطوير واجهات المستخدم'),
        ('الواجهات الخلفية', 'الخدمات وواجهات البرمجة وقواعد المنطق'),
        ('ضمان الجودة', 'الاختبار والتحقق'),
        ('تصميم تجربة المستخدم', 'البحث والتصميم وتجربة الاستخدام'),
        ('قواعد البيانات', 'نمذجة البيانات والأداء'),
        ('DevOps', 'النشر والتشغيل والمراقبة')
      ON CONFLICT (name) DO NOTHING;
    `);

    // دوال المصادقة داخل القاعدة. SECURITY DEFINER مع search_path مثبّت.
    await q.query(`
      CREATE FUNCTION auth_hash_password(p_plain text) RETURNS text
      LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$
        SELECT crypt(p_plain, gen_salt('bf', 12))
      $$;

      CREATE FUNCTION auth_set_password(p_user uuid, p_plain text, p_must_change boolean DEFAULT false) RETURNS void
      LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        UPDATE users
           SET password_hash = crypt(p_plain, gen_salt('bf', 12)),
               must_change_password = p_must_change
         WHERE id = p_user
      $$;

      CREATE FUNCTION auth_verify_login(p_email text, p_plain text) RETURNS uuid
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        v_id uuid; v_hash text; v_active boolean;
      BEGIN
        SELECT id, password_hash, is_active INTO v_id, v_hash, v_active
          FROM users WHERE lower(email) = lower(p_email);
        IF v_id IS NULL OR v_hash IS NULL THEN
          PERFORM crypt(p_plain, gen_salt('bf', 12));   -- مساواة زمن الاستجابة للبريد المجهول
          RETURN NULL;
        END IF;
        IF crypt(p_plain, v_hash) = v_hash AND v_active THEN
          RETURN v_id;
        END IF;
        RETURN NULL;
      END $$;

      CREATE FUNCTION auth_verify_user_password(p_user uuid, p_plain text) RETURNS boolean
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        v_hash text;
      BEGIN
        SELECT password_hash INTO v_hash FROM users WHERE id = p_user;
        IF v_hash IS NULL THEN
          PERFORM crypt(p_plain, gen_salt('bf', 12));
          RETURN false;
        END IF;
        RETURN crypt(p_plain, v_hash) = v_hash;
      END $$;

      REVOKE ALL ON FUNCTION auth_hash_password(text), auth_set_password(uuid, text, boolean),
        auth_verify_login(text, text), auth_verify_user_password(uuid, text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION auth_hash_password(text), auth_set_password(uuid, text, boolean),
        auth_verify_login(text, text), auth_verify_user_password(uuid, text) TO CURRENT_USER;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP FUNCTION IF EXISTS auth_verify_user_password(uuid, text);
      DROP FUNCTION IF EXISTS auth_verify_login(text, text);
      DROP FUNCTION IF EXISTS auth_set_password(uuid, text, boolean);
      DROP FUNCTION IF EXISTS auth_hash_password(text);
      DELETE FROM specializations WHERE name IN
        ('تقنية المعلومات','الواجهات الأمامية','الواجهات الخلفية','ضمان الجودة','تصميم تجربة المستخدم','قواعد البيانات','DevOps');
      DROP TABLE IF EXISTS refresh_sessions;
      DROP TABLE IF EXISTS login_attempts;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_password_hash_format;
      DROP INDEX IF EXISTS users_email_lower_key;
      DROP INDEX IF EXISTS idx_users_specialization;
      ALTER TABLE users
        DROP COLUMN IF EXISTS specialization_id,
        DROP COLUMN IF EXISTS tokens_invalid_before,
        DROP COLUMN IF EXISTS must_change_password,
        DROP COLUMN IF EXISTS password_hash;
      DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
      DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
      DROP FUNCTION IF EXISTS set_updated_at();
    `);
    // لا نُسقط pgcrypto: قد تعتمد عليه أجزاء أخرى (الفوترة).
  }
}
