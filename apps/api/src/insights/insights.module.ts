import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { DashboardService } from './dashboard.service.js';
import { AuditController, InsightsController } from './insights.controller.js';
import { ReportsService } from './reports.service.js';

@Module({ controllers: [InsightsController, AuditController], providers: [DashboardService, ReportsService, AuditService], exports: [AuditService] })
export class InsightsModule {}
