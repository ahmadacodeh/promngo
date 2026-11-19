import { Body, Controller, Get, Param, Post, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser } from '../common/decorators/index.js';
import { UuidParamPipe } from '../common/uuid.js';
import { DeliveryService, type UploadedFile } from './delivery.service.js';
import { ReviewDto, SubmitTaskDto } from './dto.js';
import { contentDisposition } from './file-rules.js';
import { SubmitUploadInterceptor } from './upload.interceptor.js';

@Controller()
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  /** multipart/form-data: `note` (اختياري) و`files` (1–5). المكلّف فقط. */
  @UseInterceptors(SubmitUploadInterceptor)
  @Post('tasks/:id/submit')
  submit(
    @CurrentUser() actor: AuthUser,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: SubmitTaskDto,
    @UploadedFiles() files: UploadedFile[] | undefined,
  ) {
    return this.delivery.submit(actor, id, dto, files ?? []);
  }

  @Get('tasks/:id/submissions')
  submissions(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string) {
    return this.delivery.listSubmissions(actor, id);
  }

  /** تنزيل فقط (attachment) مع nosniff وCSP sandbox وno-store: لا تنفيذ لمحتوى مرفوع داخل أصل المنصة. */
  @Get('attachments/:id/download')
  async download(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const f = await this.delivery.openAttachment(actor, id);
    res.set({
      'Content-Type': f.contentType,
      'Content-Disposition': contentDisposition(f.fileName),
      'Content-Length': String(f.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(f.stream);
  }

  @Post('tasks/:id/reviews')
  review(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string, @Body() dto: ReviewDto) {
    return this.delivery.review(actor, id, dto);
  }

  @Get('tasks/:id/reviews')
  reviews(@CurrentUser() actor: AuthUser, @Param('id', UuidParamPipe) id: string) {
    return this.delivery.listReviews(actor, id);
  }
}
