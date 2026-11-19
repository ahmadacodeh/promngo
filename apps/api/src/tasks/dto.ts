import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { PageQueryDto } from '../common/pagination.js';
import { IsCalendarDate } from '../common/validators.js';
import { PRIORITIES, TASK_STATUSES, type Priority, type TaskStatus } from '../work/model.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }): unknown => (value === 'true' ? true : value === 'false' ? false : value);
/** "A,B" → ["A","B"] (المرشحات المتعددة في الاستعلام). */
const toList = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value);

export const TASK_SORTS = ['updatedAt', 'createdAt', 'dueDate', 'priority', 'title', 'status'] as const;

export class ListTasksQuery extends PageQueryDto {
  @IsOptional()
  @IsIn(['all', 'mine', 'review'])
  scope?: 'all' | 'mine' | 'review';

  @IsOptional()
  @Transform(toList)
  @IsIn(TASK_STATUSES, { each: true })
  status?: TaskStatus[];

  @IsOptional()
  @Transform(toList)
  @IsIn(PRIORITIES, { each: true })
  priority?: Priority[];

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  parentOnly?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  needsReview?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** priority: الأعلى أولوية أولًا عند desc. dueDate: الأقرب أولًا عند asc، وبلا تاريخ في الآخر دائمًا. */
  @IsOptional()
  @IsIn(TASK_SORTS)
  sort?: (typeof TASK_SORTS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class CreateTaskDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: Priority;

  @IsOptional()
  @IsCalendarDate()
  dueDate?: string;

  @IsOptional()
  @IsUUID()
  specializationId?: string;

  @IsOptional()
  @IsUUID()
  assignedManagerId?: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @IsOptional()
  @IsUUID()
  reviewerId?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ValidateIf((o: UpdateTaskDto) => o.description !== null && o.description !== undefined)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: Priority;

  @ValidateIf((o: UpdateTaskDto) => o.dueDate !== null && o.dueDate !== undefined)
  @IsCalendarDate()
  dueDate?: string | null;

  @ValidateIf((o: UpdateTaskDto) => o.specializationId !== null && o.specializationId !== undefined)
  @IsUUID()
  specializationId?: string | null;

  @ValidateIf((o: UpdateTaskDto) => o.assignedManagerId !== null && o.assignedManagerId !== undefined)
  @IsUUID()
  assignedManagerId?: string | null;

  @ValidateIf((o: UpdateTaskDto) => o.assignedToId !== null && o.assignedToId !== undefined)
  @IsUUID()
  assignedToId?: string | null;

  @ValidateIf((o: UpdateTaskDto) => o.reviewerId !== null && o.reviewerId !== undefined)
  @IsUUID()
  reviewerId?: string | null;
}

export class TransitionDto {
  @IsIn(TASK_STATUSES)
  to!: TaskStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
