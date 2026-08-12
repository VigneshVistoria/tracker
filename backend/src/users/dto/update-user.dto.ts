import { IsString, IsOptional, IsEnum, IsArray, IsInt, MinLength } from 'class-validator';
import { UserRole } from '../user.entity';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  fullName?: string;

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
