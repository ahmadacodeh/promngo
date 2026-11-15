import { Body, Controller, Get, Module, Patch } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { ApiException, notFound } from '../common/api-exception.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators/index.js';
import { loadCompanyDto } from '../common/user-dto.js';

export class UpdateCompanyDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name!: string;
}

@Controller('companies')
export class CompaniesController {
  constructor(private readonly ds: DataSource) {}

  @Get('current')
  async current(@CurrentUser() actor: AuthUser) {
    const c = await loadCompanyDto(this.ds, actor.companyId);
    if (!c) throw notFound();
    return c;
  }

  @Roles('EXECUTIVE_MANAGER')
  @Patch('current')
  async update(@CurrentUser() actor: AuthUser, @Body() dto: UpdateCompanyDto) {
    const res = await this.ds.query(`UPDATE companies SET name = $1 WHERE id = $2 RETURNING id`, [dto.name, actor.companyId]);
    if ((Array.isArray(res[0]) ? res[0] : res).length === 0) throw new ApiException(404, 'NOT_FOUND');
    const c = await loadCompanyDto(this.ds, actor.companyId);
    if (!c) throw notFound();
    return c;
  }
}

@Module({ controllers: [CompaniesController] })
export class CompaniesModule {}
