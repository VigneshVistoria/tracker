import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// C3 - see ../weekly-status.ts. Minimum lengths are a setting, checked in
// the service.
export class WeeklyStatusQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  week?: string;
}

export class SubmitWeeklyStatusDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  week: string;

  @IsString()
  @MaxLength(4000)
  done: string;

  @IsString()
  @MaxLength(4000)
  plan: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  blockers?: string;
}
