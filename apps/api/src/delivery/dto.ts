import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FILE_LIMITS } from '../work/model.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** جسم التسليم (multipart): الحقل النصي `note` فقط؛ الملفات في `files`. */
export class SubmitTaskDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(FILE_LIMITS.maxNote)
  note?: string;
}

export class ReviewDto {
  @IsIn(['APPROVED', 'CHANGES_REQUESTED'])
  decision!: 'APPROVED' | 'CHANGES_REQUESTED';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  comments?: string;
}
