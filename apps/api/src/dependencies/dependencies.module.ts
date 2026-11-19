import { Module } from '@nestjs/common';
import { DependenciesController } from './dependencies.controller.js';
import { DependenciesService } from './dependencies.service.js';

@Module({ controllers: [DependenciesController], providers: [DependenciesService] })
export class DependenciesModule {}
