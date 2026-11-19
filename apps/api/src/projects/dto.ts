import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { PageQueryDto } from '../common/pagination.js';
import { IsCalendarDate } from '../common/validators.js';
import { PROJECT_STATUSES, type ProjectStatus } from '../work/model.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export const PROJECT_SORTS = ['updatedAt', 'createdAt', 'name', 'dueDate'] as const;

export class ListProjectsQuery extends PageQueryDto {
  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: ProjectStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(PROJECT_SORTS)
  sort?: (typeof PROJECT_SORTS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class CreateProjectDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsCalendarDate()
  startDate?: string;

  @IsOptional()
  @IsCalendarDate()
  dueDate?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name?: string;

  /** null = مسح الوصف. */
  @ValidateIf((o: UpdateProjectDto) => o.description !== null && o.description !== undefined)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: ProjectStatus;

  @ValidateIf((o: UpdateProjectDto) => o.startDate !== null && o.startDate !== undefined)
  @IsCalendarDate()
  startDate?: string | null;

  @ValidateIf((o: UpdateProjectDto) => o.dueDate !== null && o.dueDate !== undefined)
  @IsCalendarDate()
  dueDate?: string | null;
}
