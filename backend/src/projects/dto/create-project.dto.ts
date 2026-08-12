import { IsString, MinLength, IsOptional } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1, { message: 'Project name is required' })
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
