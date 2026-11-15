import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators/index.js';
import { UuidParamPipe } from '../common/uuid.js';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() q: ListUsersQuery) {
    return this.users.list(actor, q);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string) {
    return this.users.get(actor, id);
  }

  @Roles('EXECUTIVE_MANAGER')
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Roles('EXECUTIVE_MANAGER')
  @Patch(':id')
  update(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }

  @Roles('EXECUTIVE_MANAGER')
  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string) {
    return this.users.resetPassword(actor, id);
  }
}
