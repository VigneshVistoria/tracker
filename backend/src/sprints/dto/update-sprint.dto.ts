import { IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { SprintStatus } from '../sprint.entity';

export class UpdateSprintDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(SprintStatus, { message: 'Status must be one of: Planned, Active, Completed' })
  status?: SprintStatus;
}
