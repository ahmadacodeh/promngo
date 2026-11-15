import { Controller, Get, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/index.js';

@Controller('health')
export class HealthController {
  constructor(private readonly ds: DataSource) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' | 'error'; db: 'up' | 'down' }> {
    try {
      await this.ds.query('SELECT 1');
      return { status: 'ok', db: 'up' };
    } catch {
      res.status(503);
      return { status: 'error', db: 'down' };
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
