import { Controller, Get, Module, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PageQueryDto, paged, resolvePage } from '../common/pagination.js';

@Controller('specializations')
export class SpecializationsController {
  constructor(private readonly ds: DataSource) {}

  /** قراءة فقط: التخصصات عامة (تُزرع بالـ migration). */
  @Get()
  async list(@Query() q: PageQueryDto) {
    const { page, pageSize, offset, limit } = resolvePage(q);
    const total = Number((await this.ds.query(`SELECT COUNT(*)::int AS n FROM specializations`))[0].n);
    const rows: Array<{ id: string; name: string; description: string | null }> = await this.ds.query(
      `SELECT id, name, description FROM specializations ORDER BY name, id LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return paged(rows, total, page, pageSize);
  }
}

@Module({ controllers: [SpecializationsController] })
export class SpecializationsModule {}
