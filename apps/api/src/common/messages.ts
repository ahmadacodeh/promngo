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
  INVALID_PROJECT_TRANSITION: { message: 'لا يمكن نقل المشروع إلى هذه الحالة من حالته الحالية.', hint: 'اختر إحدى الحالات المتاحة لهذا المشروع.' },
  PROJECT_HAS_OPEN_TASKS: { message: 'لا يمكن إكمال المشروع لوجود مهام غير مكتملة.', hint: 'أكمل المهام المفتوحة أو أرشف الفرعية غير اللازمة أولًا.' },
  PROJECT_CLOSED: { message: 'المشروع مغلق (مكتمل أو ملغى) ولا يقبل هذا التغيير.', hint: 'لا يمكن تعديل مهام مشروع مغلق.' },
  INVALID_TRANSITION: { message: 'هذا الانتقال في حالة المهمة غير مسموح.', hint: 'اطّلع على الإجراءات المتاحة للمهمة في صفحتها.' },
  DEPENDENCIES_NOT_ACCEPTED: { message: 'لا يمكن بدء المهمة قبل قبول المهام السابقة لها.', hint: 'انتظر اعتماد المهام المذكورة ثم ابدأ.' },
  PARENT_HAS_OPEN_SUBTASKS: { message: 'لا يمكن اعتماد المهمة قبل اكتمال مهامها الفرعية المطلوبة.', hint: 'أكمل الفرعيات المطلوبة المذكورة أو اجعلها غير مطلوبة.' },
  DEPENDENCY_CYCLE: { message: 'هذه الاعتمادية تُنشئ دورة (حلقة مغلقة) بين المهام.', hint: 'اختر سابقة لا تعتمد على هذه المهمة بشكل مباشر أو غير مباشر.' },
  DEPENDENCY_DUPLICATE: { message: 'هذه الاعتمادية موجودة بالفعل.' },
  MAIN_TASK_PROTECTED: { message: 'المهام الرئيسية محمية من الأرشفة والحذف.', hint: 'يمكن أرشفة أو حذف المهام الفرعية فقط.' },
  SUBTASK_DEPTH: { message: 'لا يمكن إنشاء مهمة فرعية تحت مهمة فرعية.', hint: 'أنشئ المهمة الفرعية تحت المهمة الرئيسية مباشرة.' },
  REVIEWER_NOT_ELIGIBLE: { message: 'هذا المستخدم لا يصلح مراجعًا لهذه المهمة.', hint: 'اختر مديرًا مختصًا نشطًا غير المكلّف بالمهمة.' },
  SPECIALIZATION_MISMATCH: { message: 'تخصص المكلّف لا يطابق تخصص المهمة.', hint: 'اختر مكلّفًا بالتخصص نفسه أو عدّل تخصص المهمة.' },
  FILES_REQUIRED: { message: 'يجب إرفاق ملف واحد على الأقل مع التسليم.', hint: 'أضف ملفًا (PDF أو صورة أو Markdown أو HTML) ثم أعد الإرسال.' },
  FILE_TOO_LARGE: { message: 'حجم أحد الملفات أكبر من 10 ميغابايت.', hint: 'قلّل حجم الملف أو جزّئه.' },
  FILE_TYPE_NOT_ALLOWED: { message: 'نوع أحد الملفات غير مسموح أو محتواه لا يطابق امتداده.', hint: 'المسموح: pdf وpng وjpg وjpeg وwebp وmd وhtml وhtm.' },
  TOO_MANY_FILES: { message: 'عدد الملفات أكبر من المسموح (5 ملفات).', hint: 'أرسل حتى 5 ملفات في كل تسليم.' },
  COMMENT_REQUIRED: { message: 'التعليق إلزامي عند طلب التعديل.', hint: 'اشرح للمكلّف ما المطلوب تعديله.' },
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
  title: 'العنوان',
  description: 'الوصف',
  status: 'الحالة',
  priority: 'الأولوية',
  dueDate: 'تاريخ الاستحقاق',
  startDate: 'تاريخ البداية',
  isRequired: 'إلزامية المهمة',
  assignedManagerId: 'المدير المختص',
  assignedToId: 'المكلّف',
  reviewerId: 'المراجع',
  to: 'الحالة المطلوبة',
  reason: 'السبب',
  decision: 'القرار',
  comments: 'التعليق',
  note: 'الملاحظة',
  files: 'الملفات',
  predecessorTaskId: 'المهمة السابقة',
  successorTaskId: 'المهمة اللاحقة',
  scope: 'النطاق',
  projectId: 'المشروع',
  days: 'عدد الأيام',
  period: 'الفترة',
  date: 'التاريخ',
  olderThanDays: 'أقدم من (أيام)',
  sort: 'الترتيب',
  order: 'اتجاه الترتيب',
  parentOnly: 'الرئيسية فقط',
  includeArchived: 'تضمين المؤرشفة',
  overdue: 'المتأخرة',
  assigneeId: 'المكلّف',
  type: 'النوع',
  taskId: 'المهمة',
  actorId: 'الفاعل',
  from: 'من تاريخ',
};

/** حد أقصى لطول كلمة المرور بالبايت (حد bcrypt). */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 10;
