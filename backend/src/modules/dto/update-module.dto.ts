import { IsString, MinLength, IsOptional } from 'class-validator';

export class UpdateModuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Module name is required' })
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
