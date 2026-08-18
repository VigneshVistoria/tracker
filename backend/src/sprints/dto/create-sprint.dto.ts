import { IsString, MinLength, IsOptional, IsInt, IsDateString } from 'class-validator';

export class CreateSprintDto {
  @IsInt()
  projectId: number;

  @IsString()
  @MinLength(1, { message: 'Sprint name is required' })
  name: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
