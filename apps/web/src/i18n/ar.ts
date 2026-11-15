/**
 * Arabic copy, centralised. Screen-specific copy lives in each feature folder (features/<name>/copy.ts).
 * Error rule (user requirement): explain WHAT happened, the likely WHY, HOW to fix it, and allow a retry.
 */
import type { ProjectStatus, Role, TaskStatus } from '@/api/types';

export const ROLE_LABELS: Record<Role, string> = {
  EXECUTIVE_MANAGER: 'المدير التنفيذي',
  PROJECT_MANAGER: 'مدير المشروع',
  SPECIALIZED_MANAGER: 'المدير المختص',
  EMPLOYEE: 'الموظف',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PLANNED: 'مخططة',
  BLOCKED: 'محجوبة',
  ASSIGNED: 'مسندة',
  IN_PROGRESS: 'قيد التنفيذ',
  SUBMITTED: 'مُسلَّمة',
  UNDER_REVIEW: 'قيد المراجعة',
  CHANGES_REQUESTED: 'تعديلات مطلوبة',
  COMPLETED: 'مكتملة',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNED: 'مخطط',
  ACTIVE: 'نشط',
  ON_HOLD: 'معلّق',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغى',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  TASK_CREATED: 'إنشاء المهمة',
  TASK_UPDATED: 'تعديل المهمة',
  TASK_ASSIGNED: 'إسناد المهمة',
  STATUS_CHANGED: 'تغيّر الحالة',
  TASK_SUBMITTED: 'تسليم المهمة',
  REVIEW_APPROVED: 'اعتماد المراجعة',
  REVIEW_CHANGES_REQUESTED: 'طلب تعديلات',
  DEPENDENCY_ADDED: 'إضافة اعتمادية',
  DEPENDENCY_REMOVED: 'حذف اعتمادية',
  DEPENDENCY_PREDECESSOR_CHANGED: 'تغيّرت مهمة سابقة',
  TASK_ARCHIVED: 'أرشفة المهمة',
  REVIEW_FLAG_CLEARED: 'مسح علامة المراجعة',
};

/** Unknown event types fall back to the raw code (never hidden). */
export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

export const NETWORK_MESSAGES = {
  offline: 'تعذّر الاتصال بالخادم.',
  timeout: 'استغرق الخادم وقتًا أطول من المتوقع في الرد.',
  badResponse: 'وصل رد غير مفهوم من الخادم.',
} as const;

export function statusFallbackMessage(status: number): string {
  if (status === 400) return 'البيانات المُرسلة غير صالحة.';
  if (status === 401) return 'انتهت جلستك أو لم تسجّل الدخول.';
  if (status === 403) return 'ليست لديك صلاحية لهذا الإجراء.';
  if (status === 404) return 'العنصر المطلوب غير موجود.';
  if (status === 409) return 'تعارض مع الحالة الحالية للبيانات.';
  if (status === 413) return 'حجم الملف أكبر من المسموح.';
  if (status === 429) return 'محاولات كثيرة خلال وقت قصير.';
  if (status >= 500) return 'حدث خطأ غير متوقع في الخادم.';
  return 'حدث خطأ غير متوقع.';
}

export interface ErrorCopy {
  what: string;
  why: string;
  fix: string;
  /** Whether trying the same action again can plausibly succeed. */
  retryable: boolean;
}

const e = (what: string, why: string, fix: string, retryable = false): ErrorCopy => ({ what, why, fix, retryable });

/** One entry for every `code` in docs/api-contract.md §12 plus the client-side codes. */
export const ERROR_COPY: Record<string, ErrorCopy> = {
  VALIDATION_FAILED: e(
    'بعض البيانات المُدخلة غير صالحة.',
    'حقل مطلوب فارغ أو قيمة لا تطابق الصيغة المطلوبة.',
    'راجع الحقول المعلّمة بالأحمر وصحّحها ثم أعد الإرسال.',
  ),
  UNAUTHORIZED: e(
    'انتهت جلستك.',
    'مرّ وقت طويل على آخر نشاط أو أُبطلت الجلسة من جهاز آخر.',
    'سجّل الدخول مرة أخرى للمتابعة.',
  ),
  INVALID_CREDENTIALS: e(
    'بيانات الدخول غير صحيحة.',
    'البريد الإلكتروني أو كلمة المرور لا يطابقان حسابًا نشطًا.',
    'تأكد من البريد وكلمة المرور (حالة الأحرف ولغة لوحة المفاتيح)، أو اطلب من المدير التنفيذي إعادة تعيين كلمة المرور.',
    true,
  ),
  INVALID_REFRESH_TOKEN: e(
    'تعذّر تجديد الجلسة.',
    'انتهت صلاحية الجلسة أو استُخدمت من مكان آخر.',
    'سجّل الدخول من جديد.',
  ),
  TOO_MANY_ATTEMPTS: e(
    'محاولات كثيرة خلال وقت قصير.',
    'تجاوزت الحد المسموح لمحاولات الدخول، وهذا إجراء حماية من التخمين.',
    'انتظر انتهاء العدّاد ثم حاول مجددًا. إن نسيت كلمة المرور فاطلب إعادة تعيينها من المدير التنفيذي.',
    true,
  ),
  USER_INACTIVE: e(
    'بيانات الدخول غير صحيحة.',
    'قد يكون الحساب معطّلًا، ولا نكشف ذلك حمايةً للحسابات.',
    'تواصل مع المدير التنفيذي في شركتك.',
  ),
  COMPANY_NOT_ACTIVE: e(
    'حساب شركتك غير نشط.',
    'الشركة موقوفة أو مؤرشفة، فلا يمكن الدخول أو العمل مؤقتًا.',
    'تواصل مع إدارة شركتك أو مع دعم PROMANGO لإعادة التفعيل.',
  ),
  PASSWORD_MUST_CHANGE: e(
    'يلزم تغيير كلمة المرور أولًا.',
    'الحساب يستخدم كلمة مرور مؤقتة أُنشئت أو أُعيد تعيينها من المدير.',
    'اختر كلمة مرور جديدة في صفحة تغيير كلمة المرور ثم تابع.',
  ),
  WEAK_PASSWORD: e(
    'كلمة المرور ضعيفة.',
    'لا تحقق الحد الأدنى: 10 أحرف على الأقل وتتضمن حرفًا ورقمًا، ولا تتجاوز 72 بايت.',
    'اكتب كلمة مرور أطول تجمع الأحرف والأرقام، ثم أعد المحاولة.',
    true,
  ),
  FORBIDDEN: e(
    'ليست لديك صلاحية لهذا الإجراء.',
    'دورك الحالي لا يسمح به، أو لست الشخص المعيّن له.',
    'اطلب من المدير المسؤول تنفيذ الإجراء أو منحك الصلاحية المناسبة.',
  ),
  NOT_FOUND: e(
    'العنصر غير موجود.',
    'حُذف أو لم يعد متاحًا لك، أو أن الرابط غير صحيح.',
    'ارجع إلى القائمة وافتح العنصر من هناك.',
  ),
  EMAIL_TAKEN: e(
    'هذا البريد الإلكتروني مستخدم.',
    'يوجد مستخدم مسجّل بالبريد نفسه.',
    'استخدم بريدًا آخر أو عدّل المستخدم الموجود.',
    true,
  ),
  LAST_EXECUTIVE: e(
    'لا يمكن تنفيذ هذا التغيير.',
    'سيترك الشركة بلا مدير تنفيذي نشط.',
    'عيّن مديرًا تنفيذيًا آخر نشطًا أولًا ثم أعد المحاولة.',
  ),
  INVALID_PROJECT_TRANSITION: e(
    'لا يمكن نقل المشروع إلى هذه الحالة.',
    'انتقال الحالة غير مسموح من حالته الحالية (مثل إعادة فتح مشروع مكتمل).',
    'اختر إحدى الحالات المتاحة في قائمة الحالة.',
  ),
  PROJECT_HAS_OPEN_TASKS: e(
    'لا يمكن إكمال المشروع.',
    'ما زالت فيه مهام غير مكتملة.',
    'أكمل المهام المفتوحة أو أرشفها (الفرعية فقط) ثم أعد المحاولة.',
  ),
  PROJECT_CLOSED: e(
    'المشروع مغلق.',
    'المشاريع المكتملة أو الملغاة لا تقبل إضافة مهام أو تعديلها.',
    'أنشئ مشروعًا جديدًا إذا كان العمل لازمًا.',
  ),
  INVALID_TRANSITION: e(
    'هذا الانتقال غير مسموح للمهمة.',
    'الحالة الحالية لا تسمح بالانتقال المطلوب، أو أنه يتم عبر إجراء آخر (التسليم أو المراجعة).',
    'حدّث الصفحة لرؤية الحالة الحالية واستخدم الإجراء المتاح.',
    true,
  ),
  DEPENDENCIES_NOT_ACCEPTED: e(
    'لا يمكن بدء المهمة بعد.',
    'توجد مهام سابقة لها لم تُعتمد بعد (التسليم وحده لا يكفي).',
    'انتظر اعتماد المهام السابقة المذكورة أو راجع المسؤول عنها.',
  ),
  PARENT_HAS_OPEN_SUBTASKS: e(
    'لا يمكن اعتماد المهمة الأم.',
    'لها مهام فرعية مطلوبة لم تُعتمد بعد.',
    'أكمل المهام الفرعية المطلوبة أولًا ثم أعد الاعتماد.',
  ),
  DEPENDENCY_CYCLE: e(
    'لا يمكن إضافة هذه الاعتمادية.',
    'ستُنشئ دورة (مهمة تنتظر نفسها بشكل غير مباشر).',
    'اختر مهمتين لا تنتظر إحداهما الأخرى عبر سلسلة اعتماديات.',
  ),
  DEPENDENCY_DUPLICATE: e('هذه الاعتمادية موجودة مسبقًا.', 'سبق ربط المهمتين بالاتجاه نفسه.', 'لا حاجة لإضافتها مجددًا.'),
  MAIN_TASK_PROTECTED: e(
    'المهمة الرئيسية محمية.',
    'الأرشفة والحذف متاحان للمهام الفرعية اليومية فقط حفاظًا على المهمة الأساسية.',
    'أرشف المهمة الفرعية المطلوبة بدلًا منها.',
  ),
  SUBTASK_DEPTH: e(
    'لا يمكن إنشاء مهمة فرعية داخل مهمة فرعية.',
    'المستوى المسموح هو مهمة رئيسية ثم فرعيات مباشرة فقط.',
    'أنشئ المهمة الفرعية تحت المهمة الرئيسية.',
  ),
  REVIEWER_NOT_ELIGIBLE: e(
    'لا يصلح هذا المستخدم مراجعًا.',
    'المراجع يجب أن يكون مديرًا مختصًا نشطًا من شركتك وليس هو المكلّف بالمهمة.',
    'اختر مراجعًا آخر من قائمة المديرين المختصين.',
    true,
  ),
  SPECIALIZATION_MISMATCH: e(
    'تخصص المكلّف لا يطابق تخصص المهمة.',
    'تخصص المستخدم محدد ويختلف عن تخصص المهمة.',
    'اختر مكلّفًا بالتخصص نفسه أو عدّل تخصص المهمة.',
    true,
  ),
  STATE_CONFLICT: e(
    'تغيّرت البيانات أثناء عملك.',
    'عدّل شخص آخر العنصر نفسه قبل حفظ تغييرك، أو أن الحالة الحالية لا تسمح بهذا الإجراء.',
    'حدّث الصفحة ثم أعد المحاولة على الحالة الجديدة.',
    true,
  ),
  FILES_REQUIRED: e(
    'يلزم إرفاق ملف واحد على الأقل.',
    'التسليم يتطلب نتيجة العمل كملف.',
    'أرفق ملفًا (PDF أو صورة أو Markdown أو HTML) ثم أعد التسليم.',
    true,
  ),
  FILE_TOO_LARGE: e(
    'الملف أكبر من المسموح.',
    'الحد الأقصى 10 ميغابايت للملف الواحد.',
    'اضغط الملف أو قسّمه ثم أعد الرفع.',
    true,
  ),
  FILE_TYPE_NOT_ALLOWED: e(
    'نوع الملف غير مسموح.',
    'المسموح: PDF، PNG، JPG، JPEG، WEBP، MD، HTML، HTM، وتُفحص محتويات الملف فعليًا.',
    'حوّل الملف إلى أحد الأنواع المسموحة وتأكد أن محتواه سليم.',
    true,
  ),
  TOO_MANY_FILES: e('عدد الملفات أكبر من المسموح.', 'الحد الأقصى 5 ملفات في التسليم الواحد.', 'أزل بعض الملفات ثم أعد الإرسال.', true),
  COMMENT_REQUIRED: e(
    'التعليق مطلوب.',
    'طلب التعديلات يحتاج شرحًا يعرف به المكلّف ما المطلوب تصحيحه.',
    'اكتب تعليقًا واضحًا ثم أرسل القرار.',
    true,
  ),
  INTERNAL_ERROR: e(
    'حدث خطأ غير متوقع في الخادم.',
    'مشكلة عابرة أو عطل مؤقت لا علاقة له بما أدخلته.',
    'أعد المحاولة بعد لحظات. إن تكرر الخطأ فبلّغ المسؤول وأرفق رقم الطلب إن ظهر.',
    true,
  ),
  /* client-side codes */
  NETWORK_ERROR: e(
    'تعذّر الاتصال بالخادم.',
    'قد يكون الإنترنت منقطعًا أو الخادم متوقفًا أو الاتصال محجوبًا.',
    'تحقق من اتصالك بالشبكة ثم أعد المحاولة.',
    true,
  ),
  TIMEOUT: e(
    'استغرق الخادم وقتًا طويلًا في الرد.',
    'ضغط على الخادم أو اتصال بطيء.',
    'أعد المحاولة بعد لحظات.',
    true,
  ),
  BAD_RESPONSE: e(
    'وصل رد غير مفهوم من الخادم.',
    'قد يكون هناك وسيط في الشبكة غيّر الرد أو أن الخادم يعمل بإصدار مختلف.',
    'أعد المحاولة، وإن تكرر فبلّغ المسؤول.',
    true,
  ),
};

/** Every code the contract defines (§12) + USER_INACTIVE (§3) + client codes. Used by tests to prove full coverage. */
export const CONTRACT_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'INVALID_REFRESH_TOKEN',
  'TOO_MANY_ATTEMPTS',
  'COMPANY_NOT_ACTIVE',
  'PASSWORD_MUST_CHANGE',
  'WEAK_PASSWORD',
  'FORBIDDEN',
  'NOT_FOUND',
  'EMAIL_TAKEN',
  'LAST_EXECUTIVE',
  'INVALID_PROJECT_TRANSITION',
  'PROJECT_HAS_OPEN_TASKS',
  'PROJECT_CLOSED',
  'INVALID_TRANSITION',
  'DEPENDENCIES_NOT_ACCEPTED',
  'PARENT_HAS_OPEN_SUBTASKS',
  'DEPENDENCY_CYCLE',
  'DEPENDENCY_DUPLICATE',
  'MAIN_TASK_PROTECTED',
  'SUBTASK_DEPTH',
  'REVIEWER_NOT_ELIGIBLE',
  'SPECIALIZATION_MISMATCH',
  'STATE_CONFLICT',
  'FILES_REQUIRED',
  'FILE_TOO_LARGE',
  'FILE_TYPE_NOT_ALLOWED',
  'TOO_MANY_FILES',
  'COMMENT_REQUIRED',
  'INTERNAL_ERROR',
] as const;

const GENERIC: ErrorCopy = e(
  'حدث خطأ غير متوقع.',
  'سبب غير معروف.',
  'أعد المحاولة، وإن تكرر فبلّغ المسؤول.',
  true,
);

export function errorMessageFor(code: string): ErrorCopy {
  return ERROR_COPY[code] ?? GENERIC;
}

export interface DescribedError extends ErrorCopy {
  code: string;
  fields?: Record<string, string>;
  requestId?: string;
  details?: Record<string, unknown>;
}

/**
 * Turns any thrown value into user-facing copy. The server's Arabic `message`/`hint` win over the template
 * (they carry specifics); the template fills in "why" and the default "fix".
 */
export function describeError(err: unknown): DescribedError {
  const anyErr = err as {
    code?: unknown;
    message?: unknown;
    hint?: unknown;
    fields?: unknown;
    requestId?: unknown;
    details?: unknown;
  } | null;
  const code = typeof anyErr?.code === 'string' ? anyErr.code : 'INTERNAL_ERROR';
  const tpl = errorMessageFor(code);
  const known = code in ERROR_COPY;
  const out: DescribedError = {
    code,
    what: known || typeof anyErr?.message !== 'string' || !anyErr.message ? tpl.what : anyErr.message,
    why: tpl.why,
    fix: typeof anyErr?.hint === 'string' && anyErr.hint ? anyErr.hint : tpl.fix,
    retryable: tpl.retryable,
  };
  if (anyErr && typeof anyErr.fields === 'object' && anyErr.fields) out.fields = anyErr.fields as Record<string, string>;
  if (typeof anyErr?.requestId === 'string') out.requestId = anyErr.requestId;
  if (anyErr && typeof anyErr.details === 'object' && anyErr.details) out.details = anyErr.details as Record<string, unknown>;
  return out;
}

/** Common UI words. */
export const COMMON = {
  appName: 'PROMANGO',
  retry: 'إعادة المحاولة',
  cancel: 'إلغاء',
  save: 'حفظ',
  saving: 'جارٍ الحفظ…',
  close: 'إغلاق',
  confirm: 'تأكيد',
  loading: 'جارٍ التحميل…',
  back: 'رجوع',
  next: 'التالي',
  previous: 'السابق',
  search: 'بحث',
  all: 'الكل',
  yes: 'نعم',
  no: 'لا',
  none: 'لا يوجد',
  actions: 'إجراءات',
  edit: 'تعديل',
  copy: 'نسخ',
  copied: 'تم النسخ',
  logout: 'تسجيل الخروج',
  menu: 'القائمة',
  skipToContent: 'تخطّي إلى المحتوى',
  required: 'مطلوب',
  showPassword: 'إظهار كلمة المرور',
  hidePassword: 'إخفاء كلمة المرور',
  page: 'الصفحة',
  of: 'من',
  results: 'نتيجة',
} as const;

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('ar-EG-u-nu-latn').format(n);
}
