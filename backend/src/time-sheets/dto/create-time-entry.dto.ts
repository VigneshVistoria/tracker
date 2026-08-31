import { IsInt, IsOptional, IsString, IsDateString, IsNumber, Min, Max } from 'class-validator';

export class CreateTimeEntryDto {
  @IsOptional()
  @IsInt()
  issueId?: number;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0.25, { message: 'Hours must be at least 0.25' })
  @Max(24, { message: 'Hours can’t exceed 24 in a single entry' })
  hours: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
