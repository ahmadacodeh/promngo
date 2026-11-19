import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators/index.js';
import { UuidParamPipe } from '../common/uuid.js';
import { CreateTaskDto, ListTasksQuery, TransitionDto, UpdateTaskDto } from './dto.js';
import { TasksService } from './tasks.service.js';

/**
 * كل المسارات خلف JwtAuthGuard العام. الشركة من المستخدم الموثّق فقط؛ ما لا يراه المستخدم ← 404.
 * صلاحيات الإجراءات الدقيقة (المدير المختص المعيّن، المكلّف، المراجع) تُفحص في الخدمة عبر taskCapabilities().
 */
@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('tasks')
  listAll(@CurrentUser() actor: AuthUser, @Query() q: ListTasksQuery) {
    return this.tasks.list(actor, q);
  }

  @Get('projects/:projectId/tasks')
  listInProject(@CurrentUser() actor: AuthUser, @Param('projectId', UuidParamPipe) projectId: string, @Query() q: ListTasksQuery) {
    return this.tasks.list(actor, q, projectId);
  }

  @Roles('EXECUTIVE_MANAGER', 'PROJECT_MANAGER')
  @Post('projects/:projectId/tasks')
  createMain(@CurrentUser() actor: AuthUser, @Param('projectId', UuidParamPipe) projectId: string, @Body() dto: CreateTaskDto) {
    return this.tasks.createMain(actor, projectId, dto);
  }

  /** المدراء أو المدير المختص المعيّن على المهمة الأم (يُفحص في الخدمة). */
  @Post('projects/:projectId/tasks/:taskId/subtasks')
  createSubtask(
    @CurrentUser() actor: AuthUser,
    @Param('projectId', UuidParamPipe) projectId: string,
    @Param('taskId', UuidParamPipe) taskId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.createSubtask(actor, projectId, taskId, dto);
  }

  @Get('tasks/:id')
  get(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string) {
    return this.tasks.getDetail(actor, id);
  }

  @Patch('tasks/:id')
  update(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(actor, id, dto);
  }

  @HttpCode(200)
  @Post('tasks/:id/transitions')
  transition(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string, @Body() dto: TransitionDto) {
    return this.tasks.transition(actor, id, dto);
  }

  @HttpCode(200)
  @Post('tasks/:id/archive')
  archive(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string) {
    return this.tasks.archive(actor, id);
  }

  @HttpCode(204)
  @Delete('tasks/:id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.tasks.remove(actor, id);
  }

  @HttpCode(200)
  @Post('tasks/:id/clear-review-flag')
  clearReviewFlag(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string) {
    return this.tasks.clearReviewFlag(actor, id);
  }

  @Get('tasks/:id/events')
  events(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string) {
    return this.tasks.events(actor, id);
  }
}
