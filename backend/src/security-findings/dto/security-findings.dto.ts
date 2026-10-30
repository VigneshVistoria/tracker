import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { SEVERITIES, Severity } from '../security-findings';

// P3/P4 - see ../security-findings.ts.
export class CreateSecurityFindingDto {
  // Needed when no task is given (the task's project is used otherwise).
  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  taskId?: number | null;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsIn(SEVERITIES)
  severity: Severity;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  details?: string | null;

  @IsInt()
  ownerUserId: number;

  @IsDateString({}, { message: 'Found on must be a valid date.' })
  foundOn: string;
}

export class UpdateSecurityFindingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: Severity;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  details?: string | null;

  @IsOptional()
  @IsInt()
  ownerUserId?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Found on must be a valid date.' })
  foundOn?: string;
}

export class SubmitSecurityFixDto {
  @IsString()
  @MaxLength(4000)
  note: string;
}

export class VerifySecurityFixDto {
  @IsBoolean()
  passed: boolean;

  // Required when the fix failed.
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class AcceptSecurityRiskDto {
  @IsString()
  @MaxLength(4000)
  reason: string;
}
