import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators/index.js';
import { AuditService } from './audit.service.js';
import { DashboardService } from './dashboard.service.js';
import { AuditEventsQuery, AuditReportQuery, AuditReportsQuery, CreateAuditReportDto, PurgeAuditQuery, ReportsQuery } from './dto.js';
import { ReportsService } from './reports.service.js';

@Controller()
export class InsightsController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly reports: ReportsService,
  ) {}

  /** لكل دور ما يراه فقط (المدراء: الشركة؛ غيرهم: ما يخصهم). */
  @Get('dashboard')
  get(@CurrentUser() actor: AuthUser) {
    return this.dashboard.get(actor);
  }

  @Roles('EXECUTIVE_MANAGER', 'PROJECT_MANAGER')
  @Get('reports/overview')
  overview(@CurrentUser() actor: AuthUser, @Query() q: ReportsQuery) {
    return this.reports.overview(actor, q.days ?? 30);
  }
}

/** التدقيق للمدير التنفيذي فقط (افتراض مسجّل بانتظار تأكيد المالك). */
@Roles('EXECUTIVE_MANAGER')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  events(@CurrentUser() actor: AuthUser, @Query() q: AuditEventsQuery) {
    return this.audit.events(actor, q);
  }

  @Get('report')
  report(@CurrentUser() actor: AuthUser, @Query() q: AuditReportQuery) {
    return this.audit.report(actor, q.period, q.date);
  }

  @Post('reports')
  saveReport(@CurrentUser() actor: AuthUser, @Body() dto: CreateAuditReportDto) {
    return this.audit.saveReport(actor, dto.period, dto.date);
  }

  @Get('reports')
  listReports(@CurrentUser() actor: AuthUser, @Query() q: AuditReportsQuery) {
    return this.audit.listReports(actor, q);
  }

  @Delete('events')
  purge(@CurrentUser() actor: AuthUser, @Query() q: PurgeAuditQuery) {
    return this.audit.purge(actor, q.olderThanDays);
  }
}
