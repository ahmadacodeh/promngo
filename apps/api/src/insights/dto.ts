import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../common/pagination.js';
import { IsCalendarDate } from '../common/validators.js';

export const REPORT_DAYS = [7, 30, 90] as const;

export class ReportsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsIn(REPORT_DAYS)
  days?: (typeof REPORT_DAYS)[number];
}

export class AuditEventsQuery extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @IsOptional()
  @IsCalendarDate()
  to?: string;
}

export class AuditReportQuery {
  @IsIn(['daily', 'weekly'])
  period!: 'daily' | 'weekly';

  @IsOptional()
  @IsCalendarDate()
  date?: string;
}

export class CreateAuditReportDto {
  @IsIn(['daily', 'weekly'])
  period!: 'daily' | 'weekly';

  @IsOptional()
  @IsCalendarDate()
  date?: string;
}

export class PurgeAuditQuery {
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(3650)
  olderThanDays!: number;
}

export class AuditReportsQuery extends PageQueryDto {}
