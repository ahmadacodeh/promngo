import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { ROLES, type Role } from '../common/auth-user.js';
import { PageQueryDto } from '../common/pagination.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class ListUsersQuery extends PageQueryDto {
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateUserDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName!: string;

  @Transform(trim)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsIn(ROLES)
  role!: Role;

  @IsOptional()
  @IsBoolean()
  canCreateProjects?: boolean;

  @IsOptional()
  @IsUUID()
  specializationId?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  canCreateProjects?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** null = إزالة التخصص. */
  @ValidateIf((o: UpdateUserDto) => o.specializationId !== null && o.specializationId !== undefined)
  @IsUUID()
  specializationId?: string | null;
}

