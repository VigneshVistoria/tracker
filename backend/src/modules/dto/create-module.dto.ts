import { IsString, MinLength, IsOptional, IsInt } from 'class-validator';

export class CreateModuleDto {
  @IsInt()
  projectId: number;

  @IsString()
  @MinLength(1, { message: 'Module name is required' })
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
