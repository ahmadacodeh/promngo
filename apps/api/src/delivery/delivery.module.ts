import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';
import { SubmitUploadInterceptor } from './upload.interceptor.js';

@Module({ imports: [TasksModule], controllers: [DeliveryController], providers: [DeliveryService, SubmitUploadInterceptor] })
export class DeliveryModule {}
