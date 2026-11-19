import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators/index.js';
import { UuidParamPipe } from '../common/uuid.js';
import { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './dto.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() q: ListProjectsQuery) {
    return this.projects.list(actor, q);
  }

  /** الدور وحده لا يكفي: يلزم أيضًا canCreateProjects (يُفحص في الخدمة). */
  @Roles('EXECUTIVE_MANAGER', 'PROJECT_MANAGER')
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(actor, dto);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string) {
    return this.projects.get(actor, id);
  }

  @Roles('EXECUTIVE_MANAGER', 'PROJECT_MANAGER')
  @Patch(':id')
  update(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(actor, id, dto);
  }
}
