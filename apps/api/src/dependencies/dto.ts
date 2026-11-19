import { IsUUID } from 'class-validator';

export class CreateDependencyDto {
  @IsUUID()
  predecessorTaskId!: string;

  @IsUUID()
  successorTaskId!: string;
}
