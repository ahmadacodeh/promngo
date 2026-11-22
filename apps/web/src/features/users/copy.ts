import type { Role } from '@/api/types';

/** Screen copy for features/users (Arabic). Errors use the shared what/why/how block (i18n/ar.ts). */
export const USERS_COPY = {
  title: 'المستخدمون',
  subtitle: (n: number) => (n === 0 ? 'لا يوجد مستخدمون بعد' : `${n} مستخدم في شركتك`),
  add: 'إضافة مستخدم',
  searchLabel: 'بحث بالاسم أو البريد',
  searchPlaceholder: 'ابحث بالاسم أو البريد الإلكتروني',
  roleFilter: 'تصفية بالدور',
  allRoles: 'كل الأدوار',
  statusFilter: 'تصفية بالحالة',
  statusAll: 'كل الحالات',
  statusActive: 'النشطون',
  statusInactive: 'المعطّلون',

  colUser: 'المستخدم',
  colRole: 'الدور',
  colSpec: 'التخصص',
  colStatus: 'الحالة',
  tableCaption: 'قائمة مستخدمي الشركة',
  noSpec: '—',
  active: 'نشط',
  inactive: 'معطّل',
  mustChange: 'كلمة مرور مؤقتة',
  canCreateProjects: 'ينشئ مشاريع',
  you: 'أنت',

  edit: 'تعديل',
  resetPassword: 'إعادة تعيين كلمة المرور',
  disable: 'تعطيل',
  enable: 'تفعيل',

  emptyTitle: 'لا يوجد مستخدمون',
  emptyFiltered: 'لا نتائج مطابقة',
  emptyFilteredHint: 'غيّر كلمات البحث أو التصفية، أو امسحها لعرض الجميع.',
  clearFilters: 'مسح التصفية',

  /* create / edit */
  createTitle: 'إضافة مستخدم',
  editTitle: 'تعديل المستخدم',
  fullName: 'الاسم الكامل',
  email: 'البريد الإلكتروني',
  emailHintEdit: 'البريد هو اسم الدخول ولا يمكن تغييره.',
  role: 'الدور',
  roleSelf: 'لا يمكنك تغيير دورك بنفسك. اطلب ذلك من مدير تنفيذي آخر.',
  spec: 'التخصص',
  noSpecOption: 'بدون تخصص',
  specHint: 'عند تحديد تخصص لا يُسند للمستخدم إلا مهام بالتخصص نفسه.',
  specsFailed: 'تعذّر تحميل قائمة التخصصات، ويمكنك الحفظ دون تغيير التخصص.',
  canCreate: 'يمكنه إنشاء مشاريع',
  canCreateHint: 'يتطلب دور مدير تنفيذي أو مدير مشروع.',
  createSubmit: 'إنشاء المستخدم',
  createNote: 'ستُنشأ كلمة مرور مؤقتة تُعرض لك مرة واحدة فقط، ويُطلب من المستخدم تغييرها عند أول دخول.',

  fullNameRequired: 'أدخل الاسم الكامل.',
  fullNameTooLong: 'الاسم أطول من 150 حرفًا.',
  emailRequired: 'أدخل البريد الإلكتروني.',
  emailInvalid: 'صيغة البريد غير صحيحة. مثال: name@company.com',
  emailTooLong: 'البريد أطول من 255 حرفًا.',

  /* temporary password */
  pwCreatedTitle: 'تم إنشاء المستخدم',
  pwResetTitle: 'كلمة مرور مؤقتة جديدة',
  pwWarning: 'تظهر كلمة المرور هذه الآن فقط ولا يمكن استرجاعها لاحقًا. انسخها وسلّمها للمستخدم بوسيلة آمنة؛ سيُطلب منه اختيار كلمة مرور جديدة عند أول دخول.',
  pwLabel: 'كلمة المرور المؤقتة',
  pwCopy: 'نسخ كلمة المرور',
  pwCopied: 'نُسخت كلمة المرور.',
  pwCopyFailed: 'تعذّر النسخ تلقائيًا. حدّد كلمة المرور يدويًا وانسخها.',
  pwDone: 'تم، حفظتها',
  pwFor: (name: string, email: string) => `للمستخدم ${name} (${email})`,
  pwSessionsRevoked: 'أُنهيت جلساته الحالية.',

  /* confirms */
  disableTitle: (name: string) => `تعطيل ${name}؟`,
  disableBody: 'لن يتمكن من الدخول، وتُنهى جلساته الحالية فورًا. تبقى مهامه وسجلاته كما هي، ويمكنك إعادة تفعيله لاحقًا.',
  disableConfirm: 'تعطيل المستخدم',
  resetTitle: (name: string) => `إعادة تعيين كلمة مرور ${name}؟`,
  resetBody: 'ستُنشأ كلمة مرور مؤقتة جديدة، وتُنهى جلسات المستخدم الحالية، ويُطلب منه تغييرها عند أول دخول. كلمة مروره الحالية لن تعمل بعد الآن.',
  resetConfirm: 'إعادة التعيين',

  /* toasts */
  created: (name: string) => `أُنشئ المستخدم ${name}.`,
  updated: (name: string) => `حُفظت تغييرات ${name}.`,
  disabled: (name: string) => `عُطّل ${name}.`,
  enabled: (name: string) => `فُعّل ${name}.`,
  enableFailed: (name: string) => `تعذّر تفعيل ${name}.`,
} as const;

/** One-line meaning of each role, shown under the role select. */
export const ROLE_HINTS: Record<Role, string> = {
  EXECUTIVE_MANAGER: 'يدير المستخدمين والشركة ويطّلع على سجل التدقيق والتقارير.',
  PROJECT_MANAGER: 'يرى كل المشاريع والمهام ويديرها (وينشئ مشاريع إن مُنح الصلاحية).',
  SPECIALIZED_MANAGER: 'يُعيَّن على مهام تخصصه ويراجع تسليماتها.',
  EMPLOYEE: 'ينفّذ المهام المسندة إليه ويسلّمها للمراجعة.',
};
