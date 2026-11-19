# PROMANGO — عقد واجهة البرمجة (API Contract)

> **المرجع الوحيد المشترك بين الخادم والواجهة.** المتطلبات الأم: `PROMANGO_REQUIREMENTS_AR.md` (لا يُعدَّل). أي انحراف عن هذا العقد يُكتب هنا صراحةً في قسم «انحرافات موثقة» أسفل الملف مع السبب، ولا يُنفَّذ بصمت.
> الأكواد بالإنجليزية، الرسائل الموجهة للمستخدم بالعربية.

## 0. اتفاقيات عامة

- **عنوان الخادم المحلي:** `http://localhost:3000` بلا بادئة مسار. الواجهة تستدعيه عبر وكيل Vite: `/api/*` ← `http://localhost:3000/*` (إزالة `/api`). CORS مفعّل للأصل `WEB_ORIGIN` من البيئة.
- **JSON** camelCase في الاستجابات والطلبات. المعرفات UUID. التواريخ ISO-8601 UTC (`2026-11-09T20:00:00.000Z`).
- **المصادقة:** `Authorization: Bearer <accessToken>` لكل شيء عدا `/health` و`/auth/login` و`/auth/refresh` و`/auth/logout`.
- **الشركة** تُستخرج دائمًا من هوية المستخدم الموثقة، ولا يُقبل `companyId` في أي طلب. مورد شركة أخرى أو غير مرئي ← `404`.
- **الصفحات:** القوائم تقبل `?page=1&pageSize=20` (الحد الأقصى 200) وتعيد `{ items, total, page, pageSize }`.
- **الأدوار:** `EXECUTIVE_MANAGER`, `PROJECT_MANAGER`, `SPECIALIZED_MANAGER`, `EMPLOYEE`. «المدراء» = المدير التنفيذي + مدير المشروع.

### شكل الخطأ الموحد
```ts
interface ApiError {
  statusCode: number;          // 400/401/403/404/409/413/429/500
  code: string;                // رمز آلي ثابت (القائمة في §12)
  message: string;             // عربي، يشرح ما حدث
  hint?: string;               // عربي، كيف يُصلح المستخدم الأمر (اختياري)
  fields?: Record<string, string>; // 400: رسالة عربية لكل حقل
  details?: Record<string, unknown>; // بيانات مساعدة (مثل blockedBy أو retryAfterSeconds)
  requestId?: string;
}
```
لا stack trace في أي بيئة غير `development`.

## 1. الأنواع المشتركة
```ts
type Role = 'EXECUTIVE_MANAGER'|'PROJECT_MANAGER'|'SPECIALIZED_MANAGER'|'EMPLOYEE';
type ProjectStatus = 'PLANNED'|'ACTIVE'|'ON_HOLD'|'COMPLETED'|'CANCELLED';
type TaskStatus = 'PLANNED'|'BLOCKED'|'ASSIGNED'|'IN_PROGRESS'|'SUBMITTED'|'UNDER_REVIEW'|'CHANGES_REQUESTED'|'COMPLETED';
type CompanyStatus = 'ACTIVE'|'SUSPENDED'|'ARCHIVED';

interface UserRef { id: string; fullName: string; role: Role }
interface SpecRef { id: string; name: string }

interface UserDto {
  id: string; fullName: string; email: string; role: Role;
  canCreateProjects: boolean; isActive: boolean;
  mustChangePassword: boolean;
  specialization: SpecRef | null;
  createdAt: string;
}
interface CompanyDto { id: string; name: string; slug: string; status: CompanyStatus; createdAt: string }

interface TaskDto {
  id: string; projectId: string; parentTaskId: string | null;
  title: string; description: string | null; status: TaskStatus; isRequired: boolean;
  specialization: SpecRef | null;
  createdBy: UserRef; assignedManager: UserRef | null; assignedTo: UserRef | null; reviewer: UserRef | null;
  needsReview: boolean;            // علامة FR-010: تغيّرت سابقة بعد بدء العمل
  archivedAt: string | null;
  createdAt: string; updatedAt: string;
}
interface TaskListItem extends TaskDto {
  projectName: string;
  subtaskCount: number; completedSubtaskCount: number;
}
interface DependencyDto {
  id: string; projectId: string;
  predecessor: { id: string; title: string; status: TaskStatus };
  successor:   { id: string; title: string; status: TaskStatus };
  dependencyType: 'FINISH_TO_START_WITH_ACCEPTANCE';
  createdAt: string;
}
interface TaskDetail extends TaskDto {
  project: { id: string; name: string; status: ProjectStatus };
  parent: { id: string; title: string } | null;
  subtasks: TaskDto[];
  predecessors: DependencyDto[];   // ما ينتظره هذا العمل
  successors: DependencyDto[];     // ما ينتظره
  blockedBy: { id: string; title: string; status: TaskStatus }[]; // سوابق غير COMPLETED
  allowedNext: TaskStatus[];       // ما يستطيع المستدعي تنفيذه عبر POST /tasks/:id/transitions الآن
  can: { edit: boolean; assign: boolean; start: boolean; submit: boolean; review: boolean; archive: boolean; delete: boolean; manageDependencies: boolean; createSubtask: boolean };
}
interface ProjectDto {
  id: string; name: string; description: string | null; status: ProjectStatus;
  createdBy: UserRef; createdAt: string; updatedAt: string;
  taskCounts: { total: number } & Partial<Record<TaskStatus, number>>; // مقيّدة بما يراه المستدعي
  allowedNextStatuses: ProjectStatus[];
}
interface AttachmentDto { id: string; fileName: string; mimeType: string; sizeBytes: number }
interface SubmissionDto { id: string; taskId: string; round: number; submittedBy: UserRef; note: string | null; submittedAt: string; attachments: AttachmentDto[] }
interface ReviewDto { id: string; taskId: string; round: number; reviewer: UserRef; decision: 'APPROVED'|'CHANGES_REQUESTED'; comments: string | null; reviewedAt: string }
interface TaskEventDto { id: string; taskId: string; type: string; fromStatus: TaskStatus | null; toStatus: TaskStatus | null; actor: UserRef | null; meta: Record<string, unknown>; createdAt: string }
interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
```

## 2. الصحة
`GET /health` ← `200 { status: 'ok', db: 'up' }` (بلا مصادقة). `503` إن فشلت القاعدة.

## 3. المصادقة
```ts
interface AuthTokens { accessToken: string; refreshToken: string; expiresIn: number /* ثوانٍ */; }
interface AuthResponse extends AuthTokens { user: UserDto; company: CompanyDto; mustChangePassword: boolean }
```
| الطلب | المدخل | الناتج | الأخطاء |
|---|---|---|---|
| `POST /auth/login` | `{ email, password }` | `200 AuthResponse` | `400`, `401 INVALID_CREDENTIALS`, `403 COMPANY_NOT_ACTIVE`, `403 USER_INACTIVE`(نفس رسالة الدخول العامة حتى لا يُكشف الحساب)، `429 TOO_MANY_ATTEMPTS` (`details.retryAfterSeconds`) |
| `POST /auth/refresh` | `{ refreshToken }` | `200 AuthResponse` (تدوير: القديم يُبطل) | `401 INVALID_REFRESH_TOKEN`؛ إعادة استخدام رمز مُدوَّر ← إبطال كل جلسات المستخدم |
| `POST /auth/logout` | `{ refreshToken }` | `204` | — (يُبطل الجلسة، ويقبل رمزًا منتهيًا) |
| `POST /auth/change-password` | `{ currentPassword, newPassword }` | `200 AuthResponse` (جلسة جديدة؛ بقية الجلسات تُبطل) | `400 WEAK_PASSWORD` + `fields`, `401 INVALID_CREDENTIALS` |
| `GET /auth/me` | — | `200 { user: UserDto, company: CompanyDto }` | `401` |

- Access: 15 دقيقة (`typ=access`). Refresh: 7 أيام (`typ=refresh`، مخزن بـ SHA-256، استخدام واحد).
- `mustChangePassword=true` ← كل المسارات ترفض بـ `403 PASSWORD_MUST_CHANGE` ما عدا `/auth/me` و`/auth/change-password` و`/auth/logout`.
- حد المحاولات: 5 فاشلة/بريد و30/عنوان IP كل 15 دقيقة (في القاعدة).
- كلمة المرور: 10–72 بايت، حرف ورقم على الأقل. لا تُسجَّل.
- **التحقق داخل القاعدة:** تجزئة كلمة المرور والتحقق منها يجريان داخل PostgreSQL (pgcrypto `crypt`/`gen_salt('bf',12)`) عبر دوال SQL، فلا يختزن التطبيق ولا يقرأ `password_hash` أبدًا. التفاصيل في `docs/decisions.md`.

## 4. المستخدمون (المدير التنفيذي فقط للكتابة؛ القراءة لكل أعضاء الشركة)
| الطلب | المدخل | الناتج |
|---|---|---|
| `GET /users?role=&active=&q=&page=&pageSize=` | — | `Paged<UserDto>` (مستخدمو الشركة فقط) |
| `GET /users/:id` | — | `UserDto` |
| `POST /users` (EXEC) | `{ fullName, email, role, canCreateProjects?, specializationId? }` | `201 { user: UserDto, temporaryPassword: string }` (تُعرض مرة واحدة، `mustChangePassword=true`) — `409 EMAIL_TAKEN` |
| `PATCH /users/:id` (EXEC) | أي من `{ fullName, role, canCreateProjects, isActive, specializationId }` | `UserDto` — لا يعطّل نفسه ولا يخفّض آخر مدير تنفيذي نشط (`409 LAST_EXECUTIVE`) |
| `POST /users/:id/reset-password` (EXEC) | — | `{ temporaryPassword }` ويُبطل جلسات المستخدم ويفرض التغيير |
`GET /specializations` ← `Paged<SpecRef & { description: string | null }>` (قراءة فقط؛ تُزرع عبر seed/migration).
`GET /companies/current` ← `CompanyDto`. `PATCH /companies/current` (EXEC) `{ name }` ← `CompanyDto`.

## 5. المشاريع
- **الإنشاء:** دور EXEC أو PM **و** `canCreateProjects=true` (الاثنان معًا).
- **التعديل/تغيير الحالة:** EXEC وPM.
- **الرؤية:** EXEC وPM يرون كل مشاريع الشركة؛ SPECIALIZED_MANAGER وEMPLOYEE يرون فقط المشاريع التي أنشؤوها أو فيها مهمة يكونون فيها مكلّفين أو مراجعين أو مديرًا مختصًا. `taskCounts` مقيّدة بما يراه المستدعي.
- **انتقالات الحالة** (ذرية بـ `WHERE status = :current`): `PLANNED→ACTIVE|CANCELLED`، `ACTIVE→ON_HOLD|COMPLETED|CANCELLED`، `ON_HOLD→ACTIVE|CANCELLED`، `COMPLETED` و`CANCELLED` نهائيتان. `COMPLETED` يتطلب اكتمال كل المهام غير المؤرشفة (`409 PROJECT_HAS_OPEN_TASKS`).
- لا إنشاء/تعديل مهام في مشروع `COMPLETED|CANCELLED` (`409 PROJECT_CLOSED`).

| الطلب | المدخل | الناتج |
|---|---|---|
| `GET /projects?status=&q=&page=&pageSize=` | — | `Paged<ProjectDto>` |
| `POST /projects` | `{ name, description? }` | `201 ProjectDto` (الحالة `PLANNED`) |
| `GET /projects/:id` | — | `ProjectDto` |
| `PATCH /projects/:id` | `{ name?, description?, status? }` | `ProjectDto` (`409 INVALID_PROJECT_TRANSITION`) |

## 6. المهام
**الإنشاء**
- مهمة رئيسية: `POST /projects/:projectId/tasks` — EXEC وPM.
- مهمة فرعية: `POST /projects/:projectId/tasks/:taskId/subtasks` — EXEC وPM والمدير المختص المعيّن على المهمة الأم. العمق مستوى واحد (لا فرعية لفرعية: `409 SUBTASK_DEPTH`).
- المدخل: `{ title, description?, isRequired?(true), specializationId?, assignedManagerId?, assignedToId?, reviewerId? }`. كل مستخدم مذكور يجب أن يكون في الشركة ونشطًا؛ `assignedManagerId` ودوره `SPECIALIZED_MANAGER`؛ `reviewerId` دوره `SPECIALIZED_MANAGER` ولا يساوي المكلّف (`409 REVIEWER_NOT_ELIGIBLE`)؛ عدم تطابق تخصص المهمة مع تخصص المكلّف إذا كان كلاهما محددًا ← `409 SPECIALIZATION_MISMATCH`.

**القوائم**
- `GET /projects/:projectId/tasks?status=&parentOnly=&q=&page=&pageSize=` ← `Paged<TaskListItem>` (مقيّدة بالرؤية).
- **`GET /tasks?scope=all|mine|review&status=&projectId=&q=&page=&pageSize=`** ← `Paged<TaskListItem>` عبر المشاريع. `mine` = المكلّف أنا. `review` = أنا المراجع وحالتها `UNDER_REVIEW`. `all` = كل ما أراه.
- **الرؤية:** المدراء (EXEC/PM) يرون كل مهام الشركة؛ غيرهم المهام التي هم فيها مكلّفون أو مراجعون أو مدير مختص معيّن (أو منشئها). مؤرشفة المهام مخفية افتراضيًا (`?includeArchived=true`).

**التفاصيل والتعديل**
- `GET /tasks/:id` ← `TaskDetail`.
- `PATCH /tasks/:id` — `{ title?, description?, isRequired?, specializationId?, assignedManagerId?, assignedToId?, reviewerId? }` (EXEC/PM، والمدير المختص المعيّن لتعيين المكلّف/المراجع فقط). تغيير المكلّف بعد `IN_PROGRESS` ← `409 STATE_CONFLICT`.

**الانتقالات اليدوية** `POST /tasks/:id/transitions` `{ to: TaskStatus, reason?: string }` ← `TaskDetail`
المسموح عبر هذه النقطة فقط: `PLANNED→ASSIGNED` (يتطلب `assignedToId` و`reviewerId`؛ بواسطة EXEC/PM/المدير المختص المعيّن)، `PLANNED→BLOCKED`، `BLOCKED→ASSIGNED` (نفس الجهات)، `ASSIGNED→IN_PROGRESS` (المكلّف فقط، ويتطلب قبول كل السوابق `409 DEPENDENCIES_NOT_ACCEPTED` + `details.blockedBy`)، `CHANGES_REQUESTED→IN_PROGRESS` (المكلّف فقط).
`IN_PROGRESS→SUBMITTED→UNDER_REVIEW` يملكها `submit`، و`UNDER_REVIEW→COMPLETED|CHANGES_REQUESTED` تملكها المراجعة؛ ما عداها `409 INVALID_TRANSITION` (والموظف لا يصل إلى COMPLETED أبدًا). التحديث ذري (`WHERE status = :from`) وكل انتقال يكتب `task_events`.

**الأرشفة والحذف** (للمهام الفرعية «اليومية» فقط؛ الرئيسية محمية: `409 MAIN_TASK_PROTECTED`)
- `POST /tasks/:id/archive` (EXEC/PM/المدير المختص المعيّن) ← `TaskDetail`.
- `DELETE /tasks/:id` — فرعية بحالة `PLANNED|BLOCKED` بلا اعتماديات ولا سجل تسليم ← `204`، وإلا `409`.
- `POST /tasks/:id/clear-review-flag` (EXEC/PM/المدير المختص المعيّن) يمسح `needsReview`.

**الاعتماديات** (`FINISH_TO_START_WITH_ACCEPTANCE`)
- `POST /projects/:projectId/dependencies` `{ predecessorTaskId, successorTaskId }` (EXEC/PM) ← `201 DependencyDto`. أخطاء: `409 DEPENDENCY_CYCLE`، `409 DEPENDENCY_DUPLICATE`، `400` ذاتية، `404` لمهمة خارج المشروع/الشركة. منع الدورات ذري مع قفل استشاري لكل مشروع.
- `DELETE /dependencies/:id` ← `204`.
- إذا تغيّرت سابقة (انتقال، تعديل) بعد أن بدأ اللاحق ← `needsReview=true` على اللاحقة + حدث `DEPENDENCY_PREDECESSOR_CHANGED`، ولا يُحذف العمل.

**اكتمال المهمة الأم:** اعتماد مهمة لها فرعيات `isRequired=true` غير مكتملة ← `409 PARENT_HAS_OPEN_SUBTASKS` (يُحسب في الخادم).

**الأحداث:** `GET /tasks/:id/events` ← `TaskEventDto[]` (من الأقدم إلى الأحدث) لمن يرى المهمة.

## 7. التسليم والمراجعة
- `POST /tasks/:id/submit` — `multipart/form-data`: حقل `note` (نص اختياري ≤ 2000) و`files` (1–5 ملفات). المكلّف فقط والمهمة `IN_PROGRESS`. الملفات: pdf, png, jpg, jpeg, webp, md, html, htm؛ ≤ 10MB للملف؛ تُتحقق بالامتداد + البصمة (magic bytes)/UTF-8 للنصوص؛ ملف واحد على الأقل مطلوب (`400 FILES_REQUIRED`). الأثر: ينشئ `SubmissionDto` (round تصاعدي) وينقل المهمة تلقائيًا `IN_PROGRESS→SUBMITTED→UNDER_REVIEW` في معاملة واحدة بحدثين. ← `201 { submission: SubmissionDto, task: TaskDetail }`.
- `GET /tasks/:id/submissions` ← `SubmissionDto[]` (الأحدث أولًا).
- `GET /attachments/:id/download` ← الملف كـ attachment مع `X-Content-Type-Options: nosniff` و`Content-Security-Policy: sandbox` و`Cache-Control: no-store`؛ يتطلب رؤية المهمة. أسماء الملفات العربية تُحفظ سليمة. التخزين `UPLOAD_DIR/<companyId>/<taskId>/<uuid>.<ext>`.
- `POST /tasks/:id/reviews` `{ decision: 'APPROVED'|'CHANGES_REQUESTED', comments?: string }` — المراجع المعيّن فقط (الموظف والمراجع غير المعيّن ← `403`)، المهمة `UNDER_REVIEW`. `comments` **إلزامي** عند `CHANGES_REQUESTED` (`400` + `fields.comments`). المعاملة تكتب `ReviewDto` وتحدّث الحالة (`COMPLETED` أو `CHANGES_REQUESTED`) وتكتب الأحداث ذريًا (فشل أحدها يلغي الكل). ← `201 { review: ReviewDto, task: TaskDetail }`.
- `GET /tasks/:id/reviews` ← `ReviewDto[]` (الأحدث أولًا، كل الدورات).

## 8. لوحة القيادة والتقارير
```ts
interface DashboardResponse {
  role: Role;
  scope: 'COMPANY' | 'PERSONAL';           // COMPANY للمدراء (EXEC/PM)، PERSONAL لغيرهم
  projects: { total: number; byStatus: Partial<Record<ProjectStatus, number>> };
  tasks: { total: number; byStatus: Partial<Record<TaskStatus, number>> };
  myOpenTasks: number;                      // مكلّف بها ولم تكتمل
  awaitingMyReview: number;                 // أنا المراجع وحالتها UNDER_REVIEW
  flaggedForReview: number;                 // needsReview=true ضمن ما أراه
  recentTasks: TaskListItem[];              // آخر 8 تحديثًا
  awaitingReviewTasks: TaskListItem[];      // حتى 8 (للمراجع: مهامه؛ للمدراء: كل UNDER_REVIEW)
}
```
`GET /dashboard` ← `DashboardResponse`.

`GET /reports/overview?days=7|30|90` (EXEC وPM فقط؛ غيرهما `403`) ←
```ts
interface ReportsOverview {
  period: { from: string; to: string; days: number };
  projects: { byStatus: Partial<Record<ProjectStatus, number>> };
  tasks: { byStatus: Partial<Record<TaskStatus, number>>; createdInPeriod: number; completedInPeriod: number };
  reviews: { approved: number; changesRequested: number; changesRequestRatePct: number | null; avgRoundsToApproval: number | null };
  perProject: { projectId: string; name: string; status: ProjectStatus; totalTasks: number; completedTasks: number; progressPct: number }[];
  perSpecialization: { specializationId: string | null; name: string; total: number; completed: number }[];
  definitions: Record<string, string>;      // تعريف عربي لكل مؤشر وطريقة حسابه
}
```
`progressPct` = المكتملة ÷ الإجمالي للمهام غير المؤرشفة (الرئيسية فقط). لا مؤشر «إنتاجية» مركّب (قرار مفتوح).

## 9. التدقيق (EXEC فقط — افتراض مسجّل بانتظار تأكيد المالك)
- `GET /audit/events?type=&taskId=&actorId=&from=&to=&page=&pageSize=` ← `Paged<{ id, type, entity: string, entityId: string, actor: UserRef|null, fromStatus, toStatus, meta, createdAt }>`.
- `GET /audit/report?period=daily|weekly&date=YYYY-MM-DD` ← تقرير محسوب `{ period, from, to, totalEvents, byType: Record<string,number>, byActor: {actor: UserRef, count: number}[], statusChanges: number, reviews: { approved, changesRequested } }`.
- `POST /audit/reports` `{ period }` يحفظ تقريرًا ← `201`. `GET /audit/reports` ← `Paged<...>`.
- `DELETE /audit/events?olderThanDays=N` (7–3650) ← `200 { deleted: number }`. الاحتفاظ الأدنى أسبوع؛ لا حذف تلقائي.

## 10. الاشتراكات والشراء (المدير التنفيذي فقط)
> بيئة **تجريبية (Sandbox)**: لا بوابة دفع حقيقية ولا تُخزَّن بيانات بطاقات إطلاقًا. حقول الفوترة الشخصية تُشفَّر داخل القاعدة بـ `pgp_sym_encrypt` (مفتاح من البيئة `BILLING_ENCRYPTION_KEY` يُمرَّر كمعامل ولا يُخزَّن في القاعدة) وتُفكّ داخل SQL بـ `pgp_sym_decrypt`.
```ts
interface PlanDto { id: string; code: string; name: string; description: string | null; maxUsers: number | null; priceMonthly: string; priceYearly: string; currency: string; isSandbox: boolean; features: string[] }
interface SubscriptionDto { id: string; plan: PlanDto; status: 'ACTIVE'|'CANCELLED'|'EXPIRED'; billingCycle: 'MONTHLY'|'YEARLY'; currentPeriodStart: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean }
interface BillingDetails { contactName: string; contactEmail: string; taxId?: string; address?: string }
interface OrderDto { id: string; plan: PlanDto; billingCycle: 'MONTHLY'|'YEARLY'; amount: string; currency: string; status: 'PENDING'|'PAID'|'CANCELLED'; paymentMethod: 'SANDBOX'; billing: BillingDetails; createdAt: string; paidAt: string | null }
```
| الطلب | الناتج |
|---|---|
| `GET /plans` | `PlanDto[]` (النشطة) |
| `GET /subscription` | `SubscriptionDto | null` |
| `POST /subscription/orders` `{ planId, billingCycle, billing: BillingDetails }` | `201 OrderDto` (PENDING، السعر يُحسب في الخادم من الخطة لا من العميل) |
| `POST /subscription/orders/:id/confirm-sandbox` | `200 { order: OrderDto, subscription: SubscriptionDto }` — يُفعّل الاشتراك؛ `409` إن لم تكن PENDING |
| `GET /subscription/orders?page=&pageSize=` | `Paged<OrderDto>` (الفوترة مفكوكة داخل القاعدة) |
| `POST /subscription/cancel` | `SubscriptionDto` مع `cancelAtPeriodEnd=true` |
الخطط تُزرع في migration/seed تطويري **موسومة `isSandbox=true`** وتُعرض في الواجهة بوضوح كخطط تجريبية. الأسعار والعملة قرار مفتوح (متطلبات §10-6)؛ لا تُعامل كبيانات تجارية حقيقية.

## 11. بيانات التطوير (seed — للتطوير فقط، يرفض `NODE_ENV=production`)
شركتان (للعزل) بكلمات مرور تُقرأ من البيئة أو تُولَّد وتُطبع مرة واحدة، لا تُكتب في الكود. لكل شركة: مدير تنفيذي، مدير مشروع، مديران مختصان، موظفان. بالإضافة إلى تخصصات ومشروع ومهام تجريبية موسومة بوضوح أنها بيانات تطوير.

## 12. رموز الأخطاء (`code`) المعتمدة
`VALIDATION_FAILED`, `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `TOO_MANY_ATTEMPTS`, `COMPANY_NOT_ACTIVE`, `PASSWORD_MUST_CHANGE`, `WEAK_PASSWORD`, `FORBIDDEN`, `NOT_FOUND`, `EMAIL_TAKEN`, `LAST_EXECUTIVE`, `INVALID_PROJECT_TRANSITION`, `PROJECT_HAS_OPEN_TASKS`, `PROJECT_CLOSED`, `INVALID_TRANSITION`, `DEPENDENCIES_NOT_ACCEPTED`, `PARENT_HAS_OPEN_SUBTASKS`, `DEPENDENCY_CYCLE`, `DEPENDENCY_DUPLICATE`, `MAIN_TASK_PROTECTED`, `SUBTASK_DEPTH`, `REVIEWER_NOT_ELIGIBLE`, `SPECIALIZATION_MISMATCH`, `STATE_CONFLICT`, `FILES_REQUIRED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `TOO_MANY_FILES`, `COMMENT_REQUIRED`, `INTERNAL_ERROR`.

## 13. انحرافات موثقة (B2، 2026-11-16..19)
كلها إضافات متوافقة للخلف أو توضيحات لما سكت عنه العقد؛ لا يُحذف شيء مما ورد أعلاه.
1. **الأولوية والاستحقاق (قرار المالك T4):** للمهمة `priority: 'LOW'|'MEDIUM'|'HIGH'|'URGENT'` (الافتراضي `MEDIUM`) و`dueDate: 'YYYY-MM-DD'|null` و`isOverdue` (محسوب: `dueDate` قبل اليوم والمهمة غير `COMPLETED` وغير مؤرشفة) و`needsReview` و`archivedAt`. للمشروع `startDate` و`dueDate` (اختياريان، `dueDate ≥ startDate`) و`progressPct` (نسبة المهام الرئيسية المكتملة، `null` إن لم توجد) و`overdueCount`. التواريخ تقويمية بلا منطقة زمنية.
2. **قوائم المهام:** `GET /tasks` و`GET /projects/:id/tasks` تقبل `scope=all|mine|review` و`status` و`priority` (قائمة مفصولة بفواصل) و`projectId` و`assigneeId` و`parentOnly` و`overdue` و`needsReview` و`includeArchived` و`q` و`sort=updatedAt|createdAt|dueDate|priority|title|status` و`order=asc|desc`. الفرز بالأولوية يرتّب URGENT>HIGH>MEDIUM>LOW لا أبجديًا؛ وغياب `dueDate` يأتي أخيرًا دائمًا. مشروع غير مرئي أو غير موجود في `/projects/:projectId/tasks` ← `404` (لا قائمة فارغة). قائمة المشاريع تقبل `sort=updatedAt|createdAt|name|dueDate`.
3. **`GET /projects/:projectId/dependencies`** (مضاف) يعيد اعتماديات المشروع المرئية للمستدعي. إضافة اعتمادية بعد بدء اللاحقة، أو تعديل محتوى السابقة (العنوان/الوصف/الإلزامية/التخصص/المكلّف) بعد بدء اللاحقة، تعلّم اللاحقة `needsReview=true` وتكتب حدث `DEPENDENCY_PREDECESSOR_CHANGED`؛ `POST /tasks/:id/clear-review-flag` يزيل العلامة. السابقة المؤرشفة لا تحجب البدء.
4. **ترتيب الأخطاء** في الانتقالات والتسليم والمراجعة: `404` ← `409 INVALID_TRANSITION` (الحالة) ← `409 PROJECT_CLOSED` ← `409 STATE_CONFLICT` (مؤرشفة) ← `403` (الصلاحية) ← الشروط المسبقة/التحقق (`400`/`409 DEPENDENCIES_NOT_ACCEPTED`/`PARENT_HAS_OPEN_SUBTASKS`). السبب: لا تكشف الصلاحية حالة مهمة لا يحق للمستدعي معرفتها، وتبقى الأخطاء حتمية للواجهة.
5. **التسليم:** `submit` يقبل حتى 5 ملفات و4 حقول نصية فقط؛ اسم الملف يُصلَّح من latin1 إلى UTF-8 وتُجرَّد منه المسارات ومحارف التحكم ومحارف اتجاه النص (لمنع تزييف الامتداد). كل مراجعة تحمل `round` يطابق جولة التسليم. أخطاء إضافية: `PAYLOAD_TOO_LARGE`، `RATE_LIMITED` (محجوز).
6. **لوحة القيادة:** `tasks.overdue` و`tasks.byPriority` مضافان؛ النطاق `COMPANY` للمدراء (تنفيذي/مشروع) و`PERSONAL` لغيرهم؛ القوائم القصيرة ≤ 8. **التقارير:** `GET /reports/overview?days=7|30|90` (EXEC وPM) بتعريفات عربية لكل مؤشر.
7. **التدقيق:** الجدول `audit_events` (لا `audit_log`) بكيانات `TASK|PROJECT|DEPENDENCY|USER|AUDIT`؛ حذف مهمة فرعية يُبقي أحداثها بلا ربط (`task_id=NULL`). حدود الفترات في `/audit/report` بتوقيت UTC (اليوم 00:00–24:00 UTC). `DELETE /audit/events` يسجّل حدث `AUDIT_EVENTS_PURGED` نفسه (لا حذف صامت). أُضيفت أحداث `USER_CREATED` و`USER_UPDATED` و`USER_PASSWORD_RESET` بلا أي سر.
8. **`GET /users` و`GET /users/:id`:** مسموحان لأي مستخدم موثّق في شركته (كما في العقد §4) وتشمل البريد؛ سؤال الخصوصية P18 معلّق للمالك.
9. **seed:** لكل شركة 3 مشاريع و15 مهمة (كل الحالات الثماني والأولويات الأربع)، تسليمات ومراجعات واعتماديات وأحداث تدقيق متتابعة، ومرفقات حقيقية تحت `UPLOAD_DIR`.
