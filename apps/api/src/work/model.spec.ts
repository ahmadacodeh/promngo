import { describe, expect, it } from 'vitest';
import {
  ALL_TASK_TRANSITIONS,
  CLOSED_PROJECT_STATUSES,
  FILE_LIMITS,
  MANUAL_TASK_TRANSITIONS,
  PRIORITIES,
  PRIORITY_RANK,
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
  STARTED_STATUSES,
  TASK_STATUSES,
  isAllowedTransition,
  isManualTransition,
  isProjectClosed,
  type TaskStatus,
} from './model.js';

// الجدول المرجعي مكتوب يدويًا من FR-008 (لا يُشتق من الكود المختبَر).
const EXPECTED_ALL = new Set([
  'PLANNED>ASSIGNED',
  'PLANNED>BLOCKED',
  'BLOCKED>ASSIGNED',
  'ASSIGNED>IN_PROGRESS',
  'IN_PROGRESS>SUBMITTED',
  'SUBMITTED>UNDER_REVIEW',
  'UNDER_REVIEW>COMPLETED',
  'UNDER_REVIEW>CHANGES_REQUESTED',
  'CHANGES_REQUESTED>IN_PROGRESS',
]);
const EXPECTED_MANUAL = new Set(['PLANNED>ASSIGNED', 'PLANNED>BLOCKED', 'BLOCKED>ASSIGNED', 'ASSIGNED>IN_PROGRESS', 'CHANGES_REQUESTED>IN_PROGRESS']);

describe('انتقالات حالة المهمة (FR-008)', () => {
  it('الحالات ثماني بالترتيب المعتمد', () => {
    expect([...TASK_STATUSES]).toEqual(['PLANNED', 'BLOCKED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED']);
  });

  it('isAllowedTransition صحيحة لكل الأزواج الـ64 مقارنة بالجدول المرجعي', () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        expect(isAllowedTransition(from, to), `${from} → ${to}`).toBe(EXPECTED_ALL.has(`${from}>${to}`));
      }
    }
  });

  it('isManualTransition صحيحة لكل الأزواج الـ64: التسليم والمراجعة لا يمران يدويًا', () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        expect(isManualTransition(from, to), `${from} → ${to}`).toBe(EXPECTED_MANUAL.has(`${from}>${to}`));
      }
    }
  });

  it('عدد الانتقالات 9 والمدوية 5، والمدوية جزء من الكل', () => {
    expect(ALL_TASK_TRANSITIONS).toHaveLength(9);
    expect(MANUAL_TASK_TRANSITIONS).toHaveLength(5);
    for (const [f, t] of MANUAL_TASK_TRANSITIONS) expect(isAllowedTransition(f, t)).toBe(true);
  });

  it('لا انتقال إلى الذات ولا إلى PLANNED، وCOMPLETED نهائية', () => {
    for (const s of TASK_STATUSES) expect(isAllowedTransition(s, s)).toBe(false);
    for (const s of TASK_STATUSES) expect(isAllowedTransition(s, 'PLANNED')).toBe(false);
    for (const s of TASK_STATUSES) expect(isAllowedTransition('COMPLETED', s)).toBe(false);
  });

  it('كل حالة قابلة للبلوغ من PLANNED، وكل حالة غير نهائية تصل إلى COMPLETED (لا طرق مسدودة)', () => {
    const next = (s: TaskStatus): TaskStatus[] => ALL_TASK_TRANSITIONS.filter(([f]) => f === s).map(([, t]) => t);
    const reach = (from: TaskStatus): Set<TaskStatus> => {
      const seen = new Set<TaskStatus>([from]);
      const queue: TaskStatus[] = [from];
      while (queue.length) {
        for (const n of next(queue.shift()!)) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      return seen;
    };
    expect([...reach('PLANNED')].sort()).toEqual([...TASK_STATUSES].sort());
    for (const s of TASK_STATUSES) expect(reach(s).has('COMPLETED'), `${s} → … → COMPLETED`).toBe(true);
  });

  it('حالات «بدأ العمل» هي الخمس المتأخرة فقط', () => {
    expect([...STARTED_STATUSES].sort()).toEqual(['CHANGES_REQUESTED', 'COMPLETED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW']);
    for (const s of ['PLANNED', 'BLOCKED', 'ASSIGNED'] as const) expect(STARTED_STATUSES).not.toContain(s);
  });
});

describe('حالات المشروع وانتقالاتها (العقد §5)', () => {
  const EXPECTED: Record<string, string[]> = {
    PLANNED: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['CANCELLED', 'COMPLETED', 'ON_HOLD'],
    ON_HOLD: ['ACTIVE', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  };

  it('الجدول مطابق تمامًا لكل حالة', () => {
    expect([...PROJECT_STATUSES]).toEqual(['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
    for (const s of PROJECT_STATUSES) expect([...PROJECT_TRANSITIONS[s]].sort(), s).toEqual(EXPECTED[s]);
  });

  it('المغلقة: COMPLETED وCANCELLED فقط، وكلاهما نهائي', () => {
    expect([...CLOSED_PROJECT_STATUSES].sort()).toEqual(['CANCELLED', 'COMPLETED']);
    for (const s of PROJECT_STATUSES) expect(isProjectClosed(s), s).toBe(s === 'COMPLETED' || s === 'CANCELLED');
    for (const s of CLOSED_PROJECT_STATUSES) expect(PROJECT_TRANSITIONS[s]).toEqual([]);
  });

  it('لا انتقال إلى الذات ولا عودة إلى PLANNED', () => {
    for (const s of PROJECT_STATUSES) {
      expect(PROJECT_TRANSITIONS[s]).not.toContain(s);
      expect(PROJECT_TRANSITIONS[s]).not.toContain('PLANNED');
    }
  });
});

describe('الأولوية والحدود', () => {
  it('الترتيب من الأدنى إلى الأعلى ورتبته متزايدة بدقة (أساس الفرز بالأولوية)', () => {
    expect([...PRIORITIES]).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
    const ranks = PRIORITIES.map((p) => PRIORITY_RANK[p]);
    expect(ranks).toEqual([1, 2, 3, 4]);
  });

  it('حدود الملفات: 5 ملفات و10MB وملاحظة 2000 حرف', () => {
    expect(FILE_LIMITS).toEqual({ maxFiles: 5, maxBytes: 10 * 1024 * 1024, maxNote: 2000 });
  });
});
