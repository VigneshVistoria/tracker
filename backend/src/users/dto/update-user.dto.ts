import { IsString, IsOptional, IsEnum, IsArray, IsInt, IsBoolean, MinLength } from 'class-validator';
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

  // Setting this true on one user automatically clears it from every
  // other user - only one Program Manager at a time.
  @IsOptional()
  @IsBoolean()
  isProgramManager?: boolean;
}
