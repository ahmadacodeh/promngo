import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators/index.js';
import { UuidParamPipe } from '../common/uuid.js';
import { DependenciesService } from './dependencies.service.js';
import { CreateDependencyDto } from './dto.js';

@Controller()
export class DependenciesController {
  constructor(private readonly deps: DependenciesService) {}

  @Get('projects/:projectId/dependencies')
  list(@CurrentUser() actor: AuthUser, @Param('projectId', UuidParamPipe) projectId: string) {
    return this.deps.list(actor, projectId);
  }

  @Roles('EXECUTIVE_MANAGER', 'PROJECT_MANAGER')
  @Post('projects/:projectId/dependencies')
  create(@CurrentUser() actor: AuthUser, @Param('projectId', UuidParamPipe) projectId: string, @Body() dto: CreateDependencyDto) {
    return this.deps.create(actor, projectId, dto);
  }

  @Roles('EXECUTIVE_MANAGER', 'PROJECT_MANAGER')
  @HttpCode(204)
  @Delete('dependencies/:id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.deps.remove(actor, id);
  }
}
