import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { closeTestPool, q, resetDb } from '../helpers/db.js';
import { createCompany, createUser } from '../helpers/factories.js';
import { apiAs, auditTypes, workFixture, type Api, type WorkFixture } from '../helpers/work.js';

let t: TestApp;
let f: WorkFixture;
let projectId: string;
const uploadDir = (): string => process.env.UPLOAD_DIR!;

const pdf = (tag = 'x'): Buffer => Buffer.from(`%PDF-1.4\n%نص ${tag}\n%%EOF`);
const png = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
interface Att { name: string; data: Buffer; type?: string }
const att = (name = 'تقرير.pdf', data: Buffer = pdf()): Att => ({ name, data });

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
  await closeTestPool();
});
beforeEach(async () => {
  await resetDb();
  await rm(uploadDir(), { recursive: true, force: true });
  f = await workFixture(t);
  projectId = (await f.project()).id;
});

const submit = (api: Api, taskId: string, files: Att[], note?: string) => {
  let req = t.http().post(`/tasks/${taskId}/submit`).set(api.raw());
  if (note !== undefined) req = req.field('note', note);
  for (const a of files) req = req.attach('files', a.data, { filename: a.name, contentType: a.type ?? 'application/octet-stream' });
  return req;
};
/** كل ما كُتب تحت UPLOAD_DIR (مسارات نسبية). */
const filesOnDisk = async (): Promise<string[]> => (await readdir(uploadDir(), { recursive: true, withFileTypes: true }).catch(() => [])).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name));
const rowsCount = async (table: string, taskId: string): Promise<number> => (await q(`SELECT COUNT(*)::int AS n FROM ${table} WHERE task_id = $1`, [taskId]))[0].n;
const statusOf = async (id: string): Promise<string> => (await q(`SELECT status FROM tasks WHERE id = $1`, [id]))[0].status;

/** مهمة جاهزة للمراجعة: بدأها e1 وسلّمها. */
async function underReview(over: Record<string, unknown> = {}) {
  const task = await f.startedTask(projectId, over);
  const res = await submit(f.api.e1, task.id, [att()]);
  if (res.status !== 201) throw new Error(`التسليم فشل (${res.status}): ${JSON.stringify(res.body)}`);
  return { task, submission: res.body.submission as { id: string; attachments: Array<{ id: string }> } };
}
const review = (api: Api, taskId: string, body: object) => api.post(`/tasks/${taskId}/reviews`, body);

/** يعطّل كتابة أحداث التدقيق من نوع معيّن لإثبات الذرية (فشل السجل يلغي كل العملية). */
async function withFailingAudit(type: string, fn: () => Promise<void>): Promise<void> {
  await q(`CREATE OR REPLACE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'تعطيل اختباري'; END $$`);
  await q(`CREATE TRIGGER test_fail_audit_trg BEFORE INSERT ON audit_events FOR EACH ROW WHEN (NEW.type = '${type}') EXECUTE FUNCTION test_fail_audit()`);
  try {
    await fn();
  } finally {
    await q(`DROP TRIGGER IF EXISTS test_fail_audit_trg ON audit_events`);
    await q(`DROP FUNCTION IF EXISTS test_fail_audit()`);
  }
}

describe('POST /tasks/:id/submit — النجاح', () => {
  it('يحفظ التسليم والمرفقات ويحوّل المهمة إلى UNDER_REVIEW بحدثين مرتّبين، والملف على القرص بمسار الشركة/المهمة/uuid', async () => {
    const task = await f.startedTask(projectId);
    const res = await submit(f.api.e1, task.id, [att('تقرير نهائي.pdf', pdf('a')), att('صورة.png', png())], '  ملاحظة التسليم  ');
    expect(res.status).toBe(201);
    expect(res.body.task.status).toBe('UNDER_REVIEW');
    expect(res.body.submission).toMatchObject({ taskId: task.id, round: 1, note: 'ملاحظة التسليم', submittedBy: { id: f.users.e1.id } });
    expect(res.body.submission.attachments.map((a: any) => [a.fileName, a.mimeType])).toEqual([['تقرير نهائي.pdf', 'application/pdf'], ['صورة.png', 'image/png']]);
    expect(res.body.submission.attachments[0].sizeBytes).toBe(pdf('a').length);

    const events = (await f.api.pm.get(`/tasks/${task.id}/events`)).body.filter((e: any) => e.type === 'TASK_STATUS_CHANGED').map((e: any) => [e.fromStatus, e.toStatus]);
    expect(events).toEqual([['PLANNED', 'ASSIGNED'], ['ASSIGNED', 'IN_PROGRESS'], ['IN_PROGRESS', 'SUBMITTED'], ['SUBMITTED', 'UNDER_REVIEW']]);

    const rows = await q<{ storage_path: string }>(`SELECT storage_path FROM task_attachments WHERE task_id = $1 ORDER BY created_at`, [task.id]);
    for (const r of rows) expect(r.storage_path).toMatch(new RegExp(`^${f.company.id}/${task.id}/[0-9a-f-]{36}\\.(pdf|png)$`));
    expect(await readFile(join(uploadDir(), rows[0]!.storage_path))).toEqual(pdf('a'));
    expect(await filesOnDisk()).toHaveLength(2);
  });

  it('يقبل حتى 5 ملفات وبلا ملاحظة', async () => {
    const task = await f.startedTask(projectId);
    const res = await submit(f.api.e1, task.id, Array.from({ length: 5 }, (_, i) => att(`f${i}.pdf`, pdf(String(i)))));
    expect(res.status).toBe(201);
    expect(res.body.submission.attachments).toHaveLength(5);
    expect(res.body.submission.note).toBeNull();
  });

  it('المرفقات تحفظ ترتيب الرفع: طوابع created_at متمايزة (clock_timestamp لا NOW) والعرض بترتيب الرفع', async () => {
    const task = await f.startedTask(projectId);
    const names = ['أ.pdf', 'ب.pdf', 'ج.pdf', 'د.pdf', 'هـ.pdf'];
    const res = await submit(f.api.e1, task.id, names.map((n, i) => att(n, pdf(String(i)))));
    expect(res.status).toBe(201);
    expect(res.body.submission.attachments.map((a: { fileName: string }) => a.fileName)).toEqual(names);
    // ::text يحفظ دقة الميكروثانية؛ NOW() كان سيعطي طابعًا واحدًا لكل الملفات (والترتيب يُحسم عندها بـ uuid عشوائي).
    const stamps = (await q<{ c: string }>(`SELECT created_at::text AS c FROM task_attachments WHERE task_id = $1`, [task.id])).map((r) => r.c);
    expect(new Set(stamps).size).toBe(names.length);
  });

  it('اسم الملف: العربية تبقى سليمة، والمسارات تُجرَّد (../../x.pdf ← x.pdf)', async () => {
    const task = await f.startedTask(projectId);
    const res = await submit(f.api.e1, task.id, [att('../../etc/خطة العمل.pdf')]);
    expect(res.status).toBe(201);
    expect(res.body.submission.attachments[0].fileName).toBe('خطة العمل.pdf');
  });

  it('الدورة الثانية بعد طلب تعديل: round=2 والقائمة الأحدث أولًا', async () => {
    const { task } = await underReview();
    expect((await review(f.api.sm1, task.id, { decision: 'CHANGES_REQUESTED', comments: 'عدّل الخلاصة' })).status).toBe(201);
    expect((await f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(200);
    const second = await submit(f.api.e1, task.id, [att('v2.pdf', pdf('v2'))], 'نسخة معدّلة');
    expect(second.status).toBe(201);
    expect(second.body.submission.round).toBe(2);
    const list = (await f.api.pm.get(`/tasks/${task.id}/submissions`)).body;
    expect(list.map((s: any) => s.round)).toEqual([2, 1]);
    expect(list[0].attachments[0].fileName).toBe('v2.pdf');
    expect(list[1].attachments[0].fileName).toBe('تقرير.pdf');
  });
});

describe('POST /tasks/:id/submit — الرفض وعدم ترك أثر', () => {
  const expectClean = async (taskId: string, status = 'IN_PROGRESS') => {
    expect(await statusOf(taskId)).toBe(status);
    expect(await rowsCount('task_submissions', taskId)).toBe(0);
    expect(await rowsCount('task_attachments', taskId)).toBe(0);
    expect(await filesOnDisk()).toEqual([]);
  };

  it('بلا ملفات (مع ملاحظة فقط، أو جسم JSON) ← 400 FILES_REQUIRED', async () => {
    const task = await f.startedTask(projectId);
    const noFiles = await submit(f.api.e1, task.id, [], 'فقط ملاحظة');
    expect(noFiles.status).toBe(400);
    expect(noFiles.body.code).toBe('FILES_REQUIRED');
    const json = await f.api.e1.post(`/tasks/${task.id}/submit`, { note: 'x' });
    expect(json.status).toBe(400);
    expect(json.body.code).toBe('FILES_REQUIRED');
    await expectClean(task.id);
  });

  it('أكثر من 5 ملفات ← 400 TOO_MANY_FILES', async () => {
    const task = await f.startedTask(projectId);
    const res = await submit(f.api.e1, task.id, Array.from({ length: 6 }, (_, i) => att(`f${i}.pdf`)));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_MANY_FILES');
    await expectClean(task.id);
  });

  it.each([
    ['امتداد غير مسموح', att('run.exe', pdf())],
    ['امتداد مزدوج', att('a.pdf.exe', pdf())],
    ['محتوى PDF باسم png', att('a.png', pdf())],
    ['محتوى png باسم pdf', att('a.pdf', png())],
    ['html بـ UTF-8 غير سليم', att('a.html', Buffer.from([0x3c, 0xff, 0xfe, 0x3e]))],
    ['ملف فارغ', att('a.pdf', Buffer.alloc(0))],
  ])('%s ← 400 FILE_TYPE_NOT_ALLOWED ولا أثر (حتى لو كان معه ملف سليم)', async (_label, bad) => {
    const task = await f.startedTask(projectId);
    const res = await submit(f.api.e1, task.id, [att('good.pdf'), bad]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(res.body.fields.files).toMatch(/[؀-ۿ]/);
    await expectClean(task.id);
  });

  it('أكبر من 10MB ← 413 FILE_TOO_LARGE، والحد نفسه مقبول', async () => {
    const task = await f.startedTask(projectId);
    const header = Buffer.from('%PDF-1.4\n');
    const tooBig = await submit(f.api.e1, task.id, [att('big.pdf', Buffer.concat([header, Buffer.alloc(10 * 1024 * 1024)]))]);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.code).toBe('FILE_TOO_LARGE');
    await expectClean(task.id);
    const exact = await submit(f.api.e1, task.id, [att('ok.pdf', Buffer.concat([header, Buffer.alloc(10 * 1024 * 1024 - header.length)]))]);
    expect(exact.status).toBe(201);
  });

  it('ملاحظة أطول من 2000 حرف ← 400 على الحقل note', async () => {
    const task = await f.startedTask(projectId);
    const res = await submit(f.api.e1, task.id, [att()], 'ن'.repeat(2001));
    expect(res.status).toBe(400);
    expect(res.body.fields.note).toBeTruthy();
    await expectClean(task.id);
  });

  it('حقل ملفات باسم غير files ← 400 ولا أثر', async () => {
    const task = await f.startedTask(projectId);
    const res = await t.http().post(`/tasks/${task.id}/submit`).set(f.api.e1.raw()).attach('document', pdf(), { filename: 'a.pdf' });
    expect(res.status).toBe(400);
    await expectClean(task.id);
  });

  it('بلا مصادقة ← 401', async () => {
    const task = await f.startedTask(projectId);
    const res = await t.http().post(`/tasks/${task.id}/submit`).attach('files', pdf(), { filename: 'a.pdf' });
    expect(res.status).toBe(401);
  });
});

describe('POST /tasks/:id/submit — الصلاحيات والحالة', () => {
  it('المكلّف فقط: المدير والمراجع والمدير المختص ← 403، وغير المرتبط ← 404', async () => {
    const task = await f.startedTask(projectId);
    for (const k of ['pm', 'exec', 'sm1', 'sm2'] as const) expect((await submit(f.api[k], task.id, [att()])).status, k).toBe(403);
    for (const k of ['e2', 'e3'] as const) expect((await submit(f.api[k], task.id, [att()])).status, k).toBe(404);
    expect(await rowsCount('task_submissions', task.id)).toBe(0);
    expect(await filesOnDisk()).toEqual([]);
  });

  it('خارج IN_PROGRESS ← 409 INVALID_TRANSITION (ASSIGNED وUNDER_REVIEW وCOMPLETED)', async () => {
    const assigned = await f.assignedTask(projectId);
    const r1 = await submit(f.api.e1, assigned.id, [att()]);
    expect(r1.status).toBe(409);
    expect(r1.body.code).toBe('INVALID_TRANSITION');
    expect(r1.body.details).toEqual({ from: 'ASSIGNED', to: 'SUBMITTED' });
    const { task } = await underReview();
    expect((await submit(f.api.e1, task.id, [att()])).body.code).toBe('INVALID_TRANSITION');
    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [task.id]);
    expect((await submit(f.api.e1, task.id, [att()])).status).toBe(409);
  });

  it('مشروع مغلق ← PROJECT_CLOSED، ومهمة مؤرشفة ← 409', async () => {
    const task = await f.startedTask(projectId);
    await q(`UPDATE projects SET status = 'CANCELLED' WHERE id = $1`, [projectId]);
    expect((await submit(f.api.e1, task.id, [att()])).body.code).toBe('PROJECT_CLOSED');
    await q(`UPDATE projects SET status = 'ACTIVE' WHERE id = $1`, [projectId]);
    await q(`UPDATE tasks SET archived_at = NOW() WHERE id = $1`, [task.id]);
    expect((await submit(f.api.e1, task.id, [att()])).status).toBe(409);
  });

  it('معرّف مجهول أو غير صالح ← 404', async () => {
    expect((await submit(f.api.e1, '00000000-0000-4000-8000-000000000000', [att()])).status).toBe(404);
    expect((await submit(f.api.e1, 'not-a-uuid', [att()])).status).toBe(404);
  });
});

describe('POST /tasks/:id/submit — الذرية والتزامن', () => {
  it('فشل كتابة سجل التدقيق يلغي كل شيء: لا تسليم ولا مرفقات ولا ملفات والحالة كما هي', async () => {
    const task = await f.startedTask(projectId);
    await withFailingAudit('TASK_STATUS_CHANGED', async () => {
      const res = await submit(f.api.e1, task.id, [att('a.pdf', pdf('1')), att('b.pdf', pdf('2'))], 'x');
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
    });
    expect(await statusOf(task.id)).toBe('IN_PROGRESS');
    expect(await rowsCount('task_submissions', task.id)).toBe(0);
    expect(await rowsCount('task_attachments', task.id)).toBe(0);
    expect(await filesOnDisk()).toEqual([]);
    expect((await submit(f.api.e1, task.id, [att()])).status).toBe(201); // يعمل بعد زوال العطل
  });

  it('تسليمان متزامنان ← ينجح أحدهما فقط ولا تتكرر الدورة', async () => {
    const task = await f.startedTask(projectId);
    const [a, b] = await Promise.all([submit(f.api.e1, task.id, [att('a.pdf', pdf('a'))]), submit(f.api.e1, task.id, [att('b.pdf', pdf('b'))])]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await rowsCount('task_submissions', task.id)).toBe(1);
    expect(await rowsCount('task_attachments', task.id)).toBe(1);
    expect(await filesOnDisk()).toHaveLength(1); // ملف الخاسر حُذف
  });
});

describe('GET /attachments/:id/download', () => {
  it('يقدّم الملف كمرفق بترويسات الأمان ويحفظ الاسم العربي ومحتوى البايتات', async () => {
    const task = await f.startedTask(projectId);
    const res0 = await submit(f.api.e1, task.id, [att('تقرير نهائي.pdf', pdf('bytes'))]);
    const id = res0.body.submission.attachments[0].id;
    for (const k of ['e1', 'sm1', 'sm2', 'pm', 'exec'] as const) {
      const res = await f.api[k].get(`/attachments/${id}/download`).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status, k).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe('sandbox');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[\w.-]+"; filename\*=UTF-8''/);
      expect(decodeURIComponent(res.headers['content-disposition']!.split("UTF-8''")[1]!)).toBe('تقرير نهائي.pdf');
      expect(res.headers['content-length']).toBe(String(pdf('bytes').length));
      expect(res.body).toEqual(pdf('bytes'));
    }
  });

  it('HTML المرفوع لا يُنفَّذ: يُقدَّم attachment مع sandbox وnosniff', async () => {
    const task = await f.startedTask(projectId);
    const res0 = await submit(f.api.e1, task.id, [att('page.html', Buffer.from('<script>alert(1)</script>'))]);
    const res = await f.api.pm.get(`/attachments/${res0.body.submission.attachments[0].id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('من لا يرى المهمة ← 404، وبلا مصادقة ← 401، ومعرّف غير صالح ← 404', async () => {
    const { submission } = await underReview();
    const id = submission.attachments[0]!.id;
    expect((await f.api.e2.get(`/attachments/${id}/download`)).status).toBe(404);
    expect((await t.http().get(`/attachments/${id}/download`)).status).toBe(401);
    expect((await f.api.pm.get('/attachments/xyz/download')).status).toBe(404);
  });

  it('مرفق شركة أخرى ← 404', async () => {
    const { submission } = await underReview();
    const co = await createCompany();
    const foreign = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
    await q(`UPDATE users SET must_change_password = FALSE WHERE id = $1`, [foreign.id]);
    expect((await (await apiAs(t, foreign)).get(`/attachments/${submission.attachments[0]!.id}/download`)).status).toBe(404);
  });

  it('الملف مفقود من القرص ← 404 برسالة واضحة (لا 500)', async () => {
    const { submission } = await underReview();
    await rm(uploadDir(), { recursive: true, force: true });
    const res = await f.api.pm.get(`/attachments/${submission.attachments[0]!.id}/download`);
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('المرفق');
  });

  it('مسار تخزين عابر للمجلد في القاعدة لا يُقرأ أبدًا (حماية path traversal)', async () => {
    const { submission } = await underReview();
    await q(`UPDATE task_attachments SET storage_path = '../../../../etc/passwd' WHERE id = $1`, [submission.attachments[0]!.id]);
    const res = await f.api.pm.get(`/attachments/${submission.attachments[0]!.id}/download`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('root:');
  });
});

describe('POST /tasks/:id/reviews', () => {
  it('الموافقة: COMPLETED + سجل مراجعة بالدورة + حدثان مرتّبان', async () => {
    const { task } = await underReview();
    const res = await review(f.api.sm1, task.id, { decision: 'APPROVED', comments: '  ممتاز  ' });
    expect(res.status).toBe(201);
    expect(res.body.review).toMatchObject({ taskId: task.id, round: 1, decision: 'APPROVED', comments: 'ممتاز', reviewer: { id: f.users.sm1.id } });
    expect(res.body.task.status).toBe('COMPLETED');
    expect(await auditTypes(`task_id = $1 AND type IN ('REVIEW_DECISION', 'TASK_STATUS_CHANGED') AND created_at > (SELECT MAX(created_at) FROM audit_events WHERE task_id = $1 AND to_status = 'UNDER_REVIEW')`, [task.id])).toEqual(['REVIEW_DECISION', 'TASK_STATUS_CHANGED']);
    const last = (await f.api.pm.get(`/tasks/${task.id}/events`)).body.at(-1);
    expect([last.fromStatus, last.toStatus]).toEqual(['UNDER_REVIEW', 'COMPLETED']);
  });

  it('الموافقة بلا تعليق مسموحة؛ طلب التعديل يستلزم تعليقًا (400 COMMENT_REQUIRED) ويُرجع المهمة CHANGES_REQUESTED', async () => {
    const a = await underReview();
    const ok = await review(f.api.sm1, a.task.id, { decision: 'APPROVED' });
    expect(ok.status).toBe(201);
    expect(ok.body.review.comments).toBeNull();

    const b = await underReview();
    for (const body of [{ decision: 'CHANGES_REQUESTED' }, { decision: 'CHANGES_REQUESTED', comments: '   ' }]) {
      const res = await review(f.api.sm1, b.task.id, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('COMMENT_REQUIRED');
      expect(res.body.fields.comments).toBeTruthy();
    }
    expect(await statusOf(b.task.id)).toBe('UNDER_REVIEW');
    const done = await review(f.api.sm1, b.task.id, { decision: 'CHANGES_REQUESTED', comments: 'أضف المراجع' });
    expect(done.status).toBe(201);
    expect(done.body.task.status).toBe('CHANGES_REQUESTED');
    expect(done.body.task.allowedNext).toEqual([]);
    expect((await f.api.e1.get(`/tasks/${b.task.id}`)).body.allowedNext).toEqual(['IN_PROGRESS']);
  });

  it('قرار غير معروف ← 400', async () => {
    const { task } = await underReview();
    expect((await review(f.api.sm1, task.id, { decision: 'REJECTED' })).status).toBe(400);
    expect((await review(f.api.sm1, task.id, {})).status).toBe(400);
  });

  it('المراجع المعيّن فقط: المكلّف والمدراء والمدير المختص غير المراجع ← 403، وغير المرتبط ← 404', async () => {
    const { task } = await underReview();
    for (const k of ['e1', 'pm', 'exec', 'sm2'] as const) expect((await review(f.api[k], task.id, { decision: 'APPROVED' })).status, k).toBe(403);
    expect((await review(f.api.e2, task.id, { decision: 'APPROVED' })).status).toBe(404);
    expect(await statusOf(task.id)).toBe('UNDER_REVIEW');
    expect(await rowsCount('review_records', task.id)).toBe(0);
  });

  it('المكلّف لا يراجع عمله حتى لو صار مراجعًا بتعديل لاحق في القاعدة', async () => {
    const { task } = await underReview();
    await q(`UPDATE tasks SET reviewer_id = assigned_to WHERE id = $1`, [task.id]);
    expect((await review(f.api.e1, task.id, { decision: 'APPROVED' })).status).toBe(403);
  });

  it('خارج UNDER_REVIEW ← 409 INVALID_TRANSITION، ومشروع مغلق ← PROJECT_CLOSED، والإيقاف المؤقت لا يمنع', async () => {
    const started = await f.startedTask(projectId);
    const r = await review(f.api.sm1, started.id, { decision: 'APPROVED' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('INVALID_TRANSITION');
    expect(r.body.details).toEqual({ from: 'IN_PROGRESS', to: 'COMPLETED' });

    const { task } = await underReview();
    await q(`UPDATE projects SET status = 'CANCELLED' WHERE id = $1`, [projectId]);
    expect((await review(f.api.sm1, task.id, { decision: 'APPROVED' })).body.code).toBe('PROJECT_CLOSED');
    expect(await statusOf(task.id)).toBe('UNDER_REVIEW');
    await q(`UPDATE projects SET status = 'ON_HOLD' WHERE id = $1`, [projectId]);
    expect((await review(f.api.sm1, task.id, { decision: 'APPROVED' })).status).toBe(201);
  });

  it('لا موافقة ما دامت هناك فرعيات مطلوبة مفتوحة (PARENT_HAS_OPEN_SUBTASKS)؛ غير المطلوبة والمؤرشفة والمكتملة لا تحجب، وطلب التعديل مسموح', async () => {
    const { task } = await underReview();
    const mk = async (over: Record<string, unknown>) => (await f.api.pm.post(`/projects/${projectId}/tasks/${task.id}/subtasks`, { title: 'فرعية', ...over })).body;
    const required = await mk({ title: 'مطلوبة مفتوحة' });
    await mk({ title: 'اختيارية', isRequired: false });
    const done = await mk({ title: 'مكتملة' });
    const archived = await mk({ title: 'مؤرشفة' });
    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [done.id]);
    await f.api.pm.post(`/tasks/${archived.id}/archive`);

    const blocked = await review(f.api.sm1, task.id, { decision: 'APPROVED' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('PARENT_HAS_OPEN_SUBTASKS');
    expect(blocked.body.details.openSubtasks.map((s: any) => s.id)).toEqual([required.id]);
    expect(await statusOf(task.id)).toBe('UNDER_REVIEW');
    expect(await rowsCount('review_records', task.id)).toBe(0);

    await q(`UPDATE tasks SET status = 'COMPLETED' WHERE id = $1`, [required.id]);
    expect((await review(f.api.sm1, task.id, { decision: 'APPROVED' })).status).toBe(201);
  });

  it('طلب التعديل مع فرعيات مفتوحة مسموح', async () => {
    const { task } = await underReview();
    await f.api.pm.post(`/projects/${projectId}/tasks/${task.id}/subtasks`, { title: 'مفتوحة' });
    expect((await review(f.api.sm1, task.id, { decision: 'CHANGES_REQUESTED', comments: 'ناقص' })).status).toBe(201);
  });

  it('فشل كتابة التدقيق يلغي المراجعة كلها (لا سجل ولا تغيير حالة)', async () => {
    const { task } = await underReview();
    await withFailingAudit('REVIEW_DECISION', async () => {
      expect((await review(f.api.sm1, task.id, { decision: 'APPROVED' })).status).toBe(500);
    });
    expect(await statusOf(task.id)).toBe('UNDER_REVIEW');
    expect(await rowsCount('review_records', task.id)).toBe(0);
    await withFailingAudit('TASK_STATUS_CHANGED', async () => {
      expect((await review(f.api.sm1, task.id, { decision: 'CHANGES_REQUESTED', comments: 'x' })).status).toBe(500);
    });
    expect(await statusOf(task.id)).toBe('UNDER_REVIEW');
    expect(await rowsCount('review_records', task.id)).toBe(0);
    expect((await review(f.api.sm1, task.id, { decision: 'APPROVED' })).status).toBe(201);
  });

  it('قراران متزامنان (موافقة وتعديل) ← ينجح واحد فقط ويبقى سجل واحد', async () => {
    const { task } = await underReview();
    const [a, b] = await Promise.all([review(f.api.sm1, task.id, { decision: 'APPROVED' }), review(f.api.sm1, task.id, { decision: 'CHANGES_REQUESTED', comments: 'x' })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await rowsCount('review_records', task.id)).toBe(1);
    expect(['COMPLETED', 'CHANGES_REQUESTED']).toContain(await statusOf(task.id));
  });

  it('الموافقة تفتح البدء للاحقات، وطلب التعديل على سابقة يعلّم اللاحقات التي بدأت', async () => {
    const pred = await underReview({ title: 'سابقة' });
    const succ = await f.assignedTask(projectId, { title: 'لاحقة' });
    await q(`INSERT INTO task_dependencies (company_id, project_id, predecessor_task_id, successor_task_id, created_by) VALUES ($1, $2, $3, $4, $5)`, [f.company.id, projectId, pred.task.id, succ.id, f.users.pm.id]);
    expect((await f.api.e1.post(`/tasks/${succ.id}/transitions`, { to: 'IN_PROGRESS' })).body.code).toBe('DEPENDENCIES_NOT_ACCEPTED');
    await q(`UPDATE tasks SET status = 'IN_PROGRESS' WHERE id = $1`, [succ.id]); // بدأت لاحقًا (إضافة اعتمادية بعد البدء)
    expect((await review(f.api.sm1, pred.task.id, { decision: 'CHANGES_REQUESTED', comments: 'أعد الصياغة' })).status).toBe(201);
    expect((await f.api.pm.get(`/tasks/${succ.id}`)).body.needsReview).toBe(true);
    expect(await auditTypes(`task_id = $1 AND type = 'DEPENDENCY_PREDECESSOR_CHANGED'`, [succ.id])).toHaveLength(1);
  });

  it('طلب التعديل على سابقة لا يعلّم اللاحقات غير المبدوءة (ASSIGNED/PLANNED) ولا يسجّل لها حدثًا', async () => {
    const pred = await underReview({ title: 'سابقة' });
    const assigned = await f.assignedTask(projectId, { title: 'لاحقة مُسنَدة' });
    const planned = await f.task(projectId, { title: 'لاحقة مخطّطة' });
    for (const succ of [assigned, planned]) {
      await q(`INSERT INTO task_dependencies (company_id, project_id, predecessor_task_id, successor_task_id, created_by) VALUES ($1, $2, $3, $4, $5)`, [f.company.id, projectId, pred.task.id, succ.id, f.users.pm.id]);
    }
    expect((await review(f.api.sm1, pred.task.id, { decision: 'CHANGES_REQUESTED', comments: 'أعد الصياغة' })).status).toBe(201);
    for (const succ of [assigned, planned]) {
      expect((await f.api.pm.get(`/tasks/${succ.id}`)).body.needsReview, succ.title).toBe(false);
      expect(await auditTypes(`task_id = $1 AND type = 'DEPENDENCY_PREDECESSOR_CHANGED'`, [succ.id])).toHaveLength(0);
    }
  });

  it('الموافقة تحرّر اللاحقة غير المبدوءة', async () => {
    const pred = await underReview({ title: 'سابقة' });
    const succ = await f.assignedTask(projectId, { title: 'لاحقة' });
    await q(`INSERT INTO task_dependencies (company_id, project_id, predecessor_task_id, successor_task_id, created_by) VALUES ($1, $2, $3, $4, $5)`, [f.company.id, projectId, pred.task.id, succ.id, f.users.pm.id]);
    await review(f.api.sm1, pred.task.id, { decision: 'APPROVED' });
    expect((await f.api.e1.post(`/tasks/${succ.id}/transitions`, { to: 'IN_PROGRESS' })).status).toBe(200);
  });
});

describe('GET /tasks/:id/reviews و /submissions', () => {
  it('كل الدورات الأحدث أولًا لمن يرى المهمة، و404 لغيره ولشركة أخرى', async () => {
    const { task } = await underReview();
    await review(f.api.sm1, task.id, { decision: 'CHANGES_REQUESTED', comments: 'الأولى' });
    await f.api.e1.post(`/tasks/${task.id}/transitions`, { to: 'IN_PROGRESS' });
    await submit(f.api.e1, task.id, [att('v2.pdf', pdf('2'))]);
    await review(f.api.sm1, task.id, { decision: 'APPROVED', comments: 'الثانية' });

    for (const k of ['e1', 'sm1', 'sm2', 'pm'] as const) {
      const rs = (await f.api[k].get(`/tasks/${task.id}/reviews`)).body;
      expect(rs.map((r: any) => [r.round, r.decision, r.comments]), k).toEqual([[2, 'APPROVED', 'الثانية'], [1, 'CHANGES_REQUESTED', 'الأولى']]);
      expect((await f.api[k].get(`/tasks/${task.id}/submissions`)).body.map((s: any) => s.round)).toEqual([2, 1]);
    }
    expect((await f.api.e2.get(`/tasks/${task.id}/reviews`)).status).toBe(404);
    expect((await f.api.e2.get(`/tasks/${task.id}/submissions`)).status).toBe(404);

    const co = await createCompany();
    const foreign = await createUser({ companyId: co.id, role: 'EXECUTIVE_MANAGER' });
    await q(`UPDATE users SET must_change_password = FALSE WHERE id = $1`, [foreign.id]);
    const fx = await apiAs(t, foreign);
    expect((await fx.get(`/tasks/${task.id}/reviews`)).status).toBe(404);
    expect((await fx.get(`/tasks/${task.id}/submissions`)).status).toBe(404);
    expect((await review(fx, task.id, { decision: 'APPROVED' })).status).toBe(404);
    expect((await submit(fx, task.id, [att()])).status).toBe(404);
  });
});
