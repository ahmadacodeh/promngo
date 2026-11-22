import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../common/auth-user.js';
import { MANUAL_TASK_TRANSITIONS, PROJECT_STATUSES, TASK_STATUSES, type ProjectStatus, type TaskStatus } from './model.js';
import { canCreateProject, canSeeTask, isAssignedManager, taskCapabilities, type Actor, type PolicyContext, type PolicyTask } from './policy.js';

const ME = 'user-me';
const OTHER = 'user-other';
const OTHER2 = 'user-other-2';

const task = (o: Partial<PolicyTask> = {}): PolicyTask => ({
  status: 'PLANNED',
  parentTaskId: null,
  createdBy: OTHER,
  assignedManagerId: null,
  assignedTo: null,
  reviewerId: null,
  archived: false,
  projectStatus: 'ACTIVE',
  ...o,
});
const ctx = (o: Partial<PolicyContext> = {}): PolicyContext => ({ blockedByCount: 0, hasDependencies: false, hasSubmissions: false, ...o });
const actor = (role: Role): Actor => ({ id: ME, role });
const caps = (role: Role, t: Partial<PolicyTask>, c: Partial<PolicyContext> = {}) => taskCapabilities(actor(role), task(t), ctx(c));
const trues = (can: object): string[] => Object.entries(can).filter(([, v]) => v === true).map(([k]) => k).sort();

describe('canSeeTask', () => {
  const base = { createdBy: OTHER, assignedManagerId: OTHER, assignedTo: OTHER, reviewerId: OTHER };

  it('المدير التنفيذي ومدير المشروع يريان كل شيء حتى بلا علاقة', () => {
    expect(canSeeTask(actor('EXECUTIVE_MANAGER'), base)).toBe(true);
    expect(canSeeTask(actor('PROJECT_MANAGER'), base)).toBe(true);
  });

  it('المدير المختص والموظف لا يريان إلا ما لهما علاقة به (منشئ/مدير مختص/مكلّف/مراجع)', () => {
    for (const role of ['SPECIALIZED_MANAGER', 'EMPLOYEE'] as const) {
      expect(canSeeTask(actor(role), base), `${role} بلا علاقة`).toBe(false);
      for (const field of ['createdBy', 'assignedManagerId', 'assignedTo', 'reviewerId'] as const) {
        expect(canSeeTask(actor(role), { ...base, [field]: ME }), `${role}/${field}`).toBe(true);
      }
    }
  });

  it('حقول فارغة لا تطابق أحدًا', () => {
    expect(canSeeTask(actor('EMPLOYEE'), { createdBy: OTHER, assignedManagerId: null, assignedTo: null, reviewerId: null })).toBe(false);
  });
});

describe('canCreateProject / isAssignedManager', () => {
  it('الإنشاء يتطلب دور مدير والعلامة معًا (أربعة أدوار × علامتان)', () => {
    for (const role of ROLES) {
      for (const flag of [true, false]) {
        const manager = role === 'EXECUTIVE_MANAGER' || role === 'PROJECT_MANAGER';
        expect(canCreateProject({ role, canCreateProjects: flag }), `${role}/${flag}`).toBe(manager && flag);
      }
    }
  });

  it('المدير المختص المعيّن يتطلب الدور ومطابقة المعرّف معًا', () => {
    expect(isAssignedManager(actor('SPECIALIZED_MANAGER'), { assignedManagerId: ME })).toBe(true);
    expect(isAssignedManager(actor('SPECIALIZED_MANAGER'), { assignedManagerId: OTHER })).toBe(false);
    expect(isAssignedManager(actor('SPECIALIZED_MANAGER'), { assignedManagerId: null })).toBe(false);
    for (const role of ['EXECUTIVE_MANAGER', 'PROJECT_MANAGER', 'EMPLOYEE'] as const) {
      expect(isAssignedManager(actor(role), { assignedManagerId: ME }), role).toBe(false);
    }
  });
});

describe('taskCapabilities — سيناريوهات محدّدة', () => {
  it('المدير التنفيذي ومدير المشروع: تعديل وإسناد واعتماديات وفرعية، لا بدء ولا تسليم ولا مراجعة', () => {
    for (const role of ['EXECUTIVE_MANAGER', 'PROJECT_MANAGER'] as const) {
      expect(trues(caps(role, {}).can), role).toEqual(['assign', 'createSubtask', 'edit', 'manageDependencies']);
    }
  });

  it('المدير المختص المعيّن: يُسند وينشئ فرعية فقط، ولا يعدّل ولا يدير الاعتماديات', () => {
    expect(trues(caps('SPECIALIZED_MANAGER', { assignedManagerId: ME }).can)).toEqual(['assign', 'createSubtask']);
  });

  it('المدير المختص غير المعيّن والموظف غير المرتبط: لا شيء', () => {
    expect(trues(caps('SPECIALIZED_MANAGER', { assignedManagerId: OTHER }).can)).toEqual([]);
    expect(trues(caps('EMPLOYEE', {}).can)).toEqual([]);
    expect(caps('EMPLOYEE', {}).allowedNext).toEqual([]);
  });

  it('موظف مسجَّل مديرًا مختصًا على المهمة لا يكتسب صلاحية (الدور شرط)', () => {
    expect(trues(caps('EMPLOYEE', { assignedManagerId: ME }).can)).toEqual([]);
  });

  it('PLANNED: بوجود مكلّف ومراجع → [ASSIGNED, BLOCKED]؛ بدونهما → [BLOCKED] فقط', () => {
    expect(caps('EXECUTIVE_MANAGER', { assignedTo: OTHER, reviewerId: OTHER2 }).allowedNext).toEqual(['ASSIGNED', 'BLOCKED']);
    expect(caps('EXECUTIVE_MANAGER', {}).allowedNext).toEqual(['BLOCKED']);
    expect(caps('EXECUTIVE_MANAGER', { assignedTo: OTHER }).allowedNext).toEqual(['BLOCKED']);
    expect(caps('EXECUTIVE_MANAGER', { reviewerId: OTHER2 }).allowedNext).toEqual(['BLOCKED']);
  });

  it('BLOCKED: يُسند فقط بوجود المكلّف والمراجع', () => {
    expect(caps('PROJECT_MANAGER', { status: 'BLOCKED', assignedTo: OTHER, reviewerId: OTHER2 }).allowedNext).toEqual(['ASSIGNED']);
    expect(caps('PROJECT_MANAGER', { status: 'BLOCKED' }).allowedNext).toEqual([]);
  });

  it('المدير المختص المعيّن يملك انتقالات الإسناد نفسها', () => {
    expect(caps('SPECIALIZED_MANAGER', { assignedManagerId: ME, assignedTo: OTHER, reviewerId: OTHER2 }).allowedNext).toEqual(['ASSIGNED', 'BLOCKED']);
  });

  it('المكلّف: يبدأ من ASSIGNED ومن CHANGES_REQUESTED فقط، ويسلّم من IN_PROGRESS فقط', () => {
    for (const status of TASK_STATUSES) {
      const c = caps('EMPLOYEE', { status, assignedTo: ME, reviewerId: OTHER }).can;
      expect(c.start, `start@${status}`).toBe(status === 'ASSIGNED' || status === 'CHANGES_REQUESTED');
      expect(c.submit, `submit@${status}`).toBe(status === 'IN_PROGRESS');
      expect(c.review, `review@${status}`).toBe(false);
    }
  });

  it('البدء محجوب بوجود سوابق غير مكتملة: can.start قائمة لكن allowedNext فارغة', () => {
    const blocked = caps('EMPLOYEE', { status: 'ASSIGNED', assignedTo: ME, reviewerId: OTHER }, { blockedByCount: 1 });
    expect(blocked.can.start).toBe(true);
    expect(blocked.allowedNext).toEqual([]);
    const free = caps('EMPLOYEE', { status: 'ASSIGNED', assignedTo: ME, reviewerId: OTHER }, { blockedByCount: 0 });
    expect(free.allowedNext).toEqual(['IN_PROGRESS']);
    expect(caps('EMPLOYEE', { status: 'CHANGES_REQUESTED', assignedTo: ME, reviewerId: OTHER }).allowedNext).toEqual(['IN_PROGRESS']);
  });

  it('المراجع: يراجع من UNDER_REVIEW فقط، ولا يراجع من هو مكلّف بها (لا مراجعة ذاتية)', () => {
    for (const status of TASK_STATUSES) {
      expect(caps('SPECIALIZED_MANAGER', { status, assignedTo: OTHER, reviewerId: ME }).can.review, `review@${status}`).toBe(status === 'UNDER_REVIEW');
    }
    expect(caps('SPECIALIZED_MANAGER', { status: 'UNDER_REVIEW', assignedTo: ME, reviewerId: ME }).can.review).toBe(false);
  });

  it('المدير التنفيذي ليس مراجعًا إلا إن عُيّن مراجعًا', () => {
    expect(caps('EXECUTIVE_MANAGER', { status: 'UNDER_REVIEW', assignedTo: OTHER, reviewerId: OTHER2 }).can.review).toBe(false);
    expect(caps('EXECUTIVE_MANAGER', { status: 'UNDER_REVIEW', assignedTo: OTHER, reviewerId: ME }).can.review).toBe(true);
  });

  it('الفرعية: أرشفة وحذف وإنشاء فرعية تتبع نوع المهمة (فرعية/رئيسية)', () => {
    const main = caps('EXECUTIVE_MANAGER', { parentTaskId: null }).can;
    expect([main.archive, main.delete, main.createSubtask]).toEqual([false, false, true]);
    const sub = caps('EXECUTIVE_MANAGER', { parentTaskId: 'p1' }).can;
    expect([sub.archive, sub.delete, sub.createSubtask]).toEqual([true, true, false]);
  });

  it('الحذف: فقط من PLANNED/BLOCKED وبلا اعتماديات ولا تسليمات', () => {
    for (const status of TASK_STATUSES) {
      const expected = status === 'PLANNED' || status === 'BLOCKED';
      expect(caps('EXECUTIVE_MANAGER', { status, parentTaskId: 'p1' }).can.delete, status).toBe(expected);
    }
    expect(caps('EXECUTIVE_MANAGER', { parentTaskId: 'p1' }, { hasDependencies: true }).can.delete).toBe(false);
    expect(caps('EXECUTIVE_MANAGER', { parentTaskId: 'p1' }, { hasSubmissions: true }).can.delete).toBe(false);
    expect(caps('EXECUTIVE_MANAGER', { parentTaskId: 'p1' }, { hasDependencies: true }).can.archive).toBe(true);
  });

  it('المدير المختص المعيّن يحذف ويؤرشف فرعيته، وغير المعيّن لا', () => {
    expect(caps('SPECIALIZED_MANAGER', { parentTaskId: 'p1', assignedManagerId: ME }).can.delete).toBe(true);
    expect(caps('SPECIALIZED_MANAGER', { parentTaskId: 'p1', assignedManagerId: OTHER }).can.delete).toBe(false);
  });

  it('مشروع مغلق (مكتمل/ملغى) أو مهمة مؤرشفة: كل القدرات مغلقة وallowedNext فارغة، ON_HOLD ليس مغلقًا', () => {
    const rich = { assignedTo: ME, reviewerId: ME, assignedManagerId: ME, parentTaskId: 'p1' };
    for (const role of ROLES) {
      for (const projectStatus of ['COMPLETED', 'CANCELLED'] as const) {
        const r = caps(role, { ...rich, projectStatus, status: 'IN_PROGRESS' });
        expect(trues(r.can), `${role}/${projectStatus}`).toEqual([]);
        expect(r.allowedNext).toEqual([]);
      }
      const archived = caps(role, { ...rich, archived: true, status: 'IN_PROGRESS' });
      expect(trues(archived.can), `${role}/archived`).toEqual([]);
    }
    expect(caps('EXECUTIVE_MANAGER', { projectStatus: 'ON_HOLD' }).can.edit).toBe(true);
    expect(caps('EXECUTIVE_MANAGER', { projectStatus: 'PLANNED' }).can.edit).toBe(true);
  });
});

describe('taskCapabilities — ثوابت على كل التركيبات الممكنة', () => {
  // أدوار × علاقات × حالات مهمة × حالات مشروع × مؤرشفة × فرعية × سياق
  const relations: Array<Partial<PolicyTask>> = [
    {},
    { assignedTo: ME },
    { reviewerId: ME },
    { assignedManagerId: ME },
    { assignedTo: ME, reviewerId: ME },
    { assignedTo: ME, reviewerId: OTHER, assignedManagerId: ME },
    { createdBy: ME },
    { assignedTo: OTHER, reviewerId: OTHER2, assignedManagerId: OTHER },
  ];
  const contexts: Array<Partial<PolicyContext>> = [{}, { blockedByCount: 2 }, { hasDependencies: true }, { hasSubmissions: true }];

  function* all() {
    for (const role of ROLES)
      for (const rel of relations)
        for (const status of TASK_STATUSES)
          for (const projectStatus of PROJECT_STATUSES)
            for (const archived of [false, true])
              for (const parentTaskId of [null, 'p1'])
                for (const c of contexts) yield { role, t: { ...rel, status, projectStatus, archived, parentTaskId }, c };
  }
  const manual = new Set(MANUAL_TASK_TRANSITIONS.map(([f, t]) => `${f}>${t}`));
  const closed = (p: ProjectStatus): boolean => p === 'COMPLETED' || p === 'CANCELLED';

  it('عدد التركيبات المفحوصة معقول (لا حلقة فارغة بالخطأ)', () => {
    expect([...all()].length).toBe(4 * 8 * 8 * 5 * 2 * 2 * 4);
  });

  it('مشروع مغلق أو مهمة مؤرشفة ⇒ لا قدرة ولا انتقال', () => {
    for (const { role, t, c } of all()) {
      if (!closed(t.projectStatus as ProjectStatus) && !t.archived) continue;
      const r = caps(role, t, c);
      expect(trues(r.can), JSON.stringify({ role, t })).toEqual([]);
      expect(r.allowedNext).toEqual([]);
    }
  });

  it('start/submit/review لا تُمنح إلا للشخص الصحيح بالحالة الصحيحة', () => {
    for (const { role, t, c } of all()) {
      const { can } = caps(role, t, c);
      const status = t.status as TaskStatus;
      if (can.start) expect(t.assignedTo === ME && (status === 'ASSIGNED' || status === 'CHANGES_REQUESTED')).toBe(true);
      if (can.submit) expect(t.assignedTo === ME && status === 'IN_PROGRESS').toBe(true);
      if (can.review) expect(t.reviewerId === ME && t.assignedTo !== ME && status === 'UNDER_REVIEW').toBe(true);
    }
  });

  it('لا أحد يراجع مهمة هو مكلّف بها، ولا يسلّم مراجع غير مكلّف', () => {
    for (const { role, t, c } of all()) {
      const { can } = caps(role, t, c);
      if (t.assignedTo === ME) expect(can.review).toBe(false);
      if (t.assignedTo !== ME) expect(can.start || can.submit).toBe(false);
    }
  });

  it('كل انتقال معروض من الانتقالات اليدوية المعتمدة فقط، وIN_PROGRESS ⇔ (can.start وبلا سوابق معلّقة)', () => {
    for (const { role, t, c } of all()) {
      const r = caps(role, t, c);
      for (const n of r.allowedNext) expect(manual.has(`${t.status}>${n}`), `${t.status}→${n}`).toBe(true);
      expect(r.allowedNext.includes('IN_PROGRESS')).toBe(r.can.start && (c.blockedByCount ?? 0) === 0);
      expect(new Set(r.allowedNext).size).toBe(r.allowedNext.length);
    }
  });

  it('أرشفة وحذف الفرعية فقط؛ إنشاء الفرعية للرئيسية فقط (لا تداخل)', () => {
    for (const { role, t, c } of all()) {
      const { can } = caps(role, t, c);
      if (t.parentTaskId === null) expect(can.archive || can.delete).toBe(false);
      else expect(can.createSubtask).toBe(false);
      if (can.delete) expect(can.archive).toBe(true);
    }
  });

  it('الموظف غير المدير لا يعدّل ولا يدير اعتماديات ولا يُسند أبدًا', () => {
    for (const { role, t, c } of all()) {
      if (role !== 'EMPLOYEE') continue;
      const { can } = caps(role, t, c);
      expect([can.edit, can.assign, can.manageDependencies, can.createSubtask, can.archive, can.delete]).toEqual([false, false, false, false, false, false]);
    }
  });

  it('التعديل وإدارة الاعتماديات للمدير التنفيذي ومدير المشروع فقط', () => {
    for (const { role, t, c } of all()) {
      const { can } = caps(role, t, c);
      const manager = role === 'EXECUTIVE_MANAGER' || role === 'PROJECT_MANAGER';
      if (can.edit || can.manageDependencies) expect(manager).toBe(true);
      if (manager && !closed(t.projectStatus as ProjectStatus) && !t.archived) expect(can.edit && can.manageDependencies && can.assign).toBe(true);
    }
  });

  it('الإسناد للمدراء وللمدير المختص المعيّن فقط', () => {
    for (const { role, t, c } of all()) {
      const { can } = caps(role, t, c);
      const manager = role === 'EXECUTIVE_MANAGER' || role === 'PROJECT_MANAGER';
      const am = role === 'SPECIALIZED_MANAGER' && t.assignedManagerId === ME;
      if (can.assign) expect(manager || am).toBe(true);
    }
  });
});
