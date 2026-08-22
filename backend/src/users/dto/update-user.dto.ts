import { IsString, IsOptional, IsEnum, IsArray, IsInt, MinLength } from 'class-validator';
import { UserRole } from '../user.entity';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  // Program Manager is now a normal role value here (ReleaseBot,
  // 2026-08-22) rather than a separate singleton flag - set role to
  // UserRole.PROGRAM_MANAGER the same way you'd set any other role.
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  projectIds?: number[];
}
