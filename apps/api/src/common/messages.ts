/**
 * كتالوج الرسائل العربية الموحد لرموز الأخطاء. كل رمز له رسالة (ماذا حدث)
 * واقتراح إصلاح اختياري (كيف يُصلح المستخدم الأمر).
 * يُضيف B2 رموزه هنا (المهام، الاعتماديات، التسليم...) ولا يكتب نصوصًا متناثرة في الخدمات.
 */
export interface MessageEntry {
  message: string;
  hint?: string;
}

export const MESSAGES = {
  VALIDATION_FAILED: { message: 'بعض البيانات المُدخلة غير صالحة.', hint: 'صحّح الحقول المشار إليها ثم أعد المحاولة.' },
  UNAUTHORIZED: { message: 'انتهت جلستك أو لم تسجّل الدخول.', hint: 'سجّل الدخول من جديد للمتابعة.' },
  INVALID_CREDENTIALS: { message: 'بيانات الدخول غير صحيحة.', hint: 'تأكد من البريد الإلكتروني وكلمة المرور ثم أعد المحاولة.' },
  INVALID_REFRESH_TOKEN: { message: 'تعذّر تجديد الجلسة.', hint: 'سجّل الدخول من جديد.' },
  TOO_MANY_ATTEMPTS: { message: 'تجاوزت عدد محاولات الدخول المسموح بها مؤقتًا.', hint: 'انتظر قليلًا ثم أعد المحاولة، أو اطلب من المدير التنفيذي إعادة تعيين كلمة المرور.' },
  COMPANY_NOT_ACTIVE: { message: 'حساب شركتك غير نشط حاليًا (موقوف أو مؤرشف).', hint: 'تواصل مع إدارة المنصة لإعادة التفعيل.' },
  PASSWORD_MUST_CHANGE: { message: 'يجب تغيير كلمة المرور المؤقتة قبل المتابعة.', hint: 'اختر كلمة مرور جديدة من صفحة تغيير كلمة المرور.' },
  WEAK_PASSWORD: { message: 'كلمة المرور الجديدة لا تحقق الشروط.', hint: 'استخدم 10 أحرف على الأقل (72 بايت كحد أقصى) تتضمن حرفًا ورقمًا.' },
  FORBIDDEN: { message: 'ليست لديك صلاحية تنفيذ هذا الإجراء.', hint: 'اطلب الصلاحية من مدير شركتك إن كنت تحتاجها.' },
  NOT_FOUND: { message: 'العنصر المطلوب غير موجود أو غير متاح لك.' },
  EMAIL_TAKEN: { message: 'هذا البريد الإلكتروني مستخدم بالفعل.', hint: 'استخدم بريدًا آخر أو عدّل حساب المستخدم الحالي.' },
  LAST_EXECUTIVE: { message: 'لا يمكن تعطيل أو تخفيض آخر مدير تنفيذي نشط في الشركة.', hint: 'عيّن مديرًا تنفيذيًا آخر أولًا.' },
  STATE_CONFLICT: { message: 'تعارض مع الحالة الحالية للبيانات.', hint: 'حدّث الصفحة ثم أعد المحاولة.' },
  INTERNAL_ERROR: { message: 'حدث خطأ غير متوقع في الخادم.', hint: 'أعد المحاولة بعد قليل. إن تكرر الخطأ فأبلغ الدعم مع رقم الطلب.' },
  PAYLOAD_TOO_LARGE: { message: 'حجم الطلب أكبر من المسموح.' },
  RATE_LIMITED: { message: 'طلبات كثيرة في وقت قصير.', hint: 'انتظر قليلًا ثم أعد المحاولة.' },
} as const satisfies Record<string, MessageEntry>;

export type MessageCode = keyof typeof MESSAGES;

/** تسميات الحقول بالعربية لرسائل التحقق. يُوسّعها B2 بحقوله. */
export const FIELD_LABELS: Record<string, string> = {
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  currentPassword: 'كلمة المرور الحالية',
  newPassword: 'كلمة المرور الجديدة',
  refreshToken: 'رمز التحديث',
  fullName: 'الاسم الكامل',
  role: 'الدور',
  canCreateProjects: 'صلاحية إنشاء المشاريع',
  isActive: 'حالة التفعيل',
  specializationId: 'التخصص',
  name: 'الاسم',
  planId: 'الخطة',
  billingCycle: 'دورة الفوترة',
  billing: 'بيانات الفوترة',
  contactName: 'اسم جهة الاتصال',
  contactEmail: 'بريد جهة الاتصال',
  taxId: 'الرقم الضريبي',
  address: 'العنوان',
  page: 'رقم الصفحة',
  pageSize: 'حجم الصفحة',
  q: 'نص البحث',
  active: 'التفعيل',
};

/** حد أقصى لطول كلمة المرور بالبايت (حد bcrypt). */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 10;
