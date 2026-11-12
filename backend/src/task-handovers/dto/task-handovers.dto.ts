import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

// C4 - see ../task-handovers.ts. Minimum lengths are a setting, checked in
// the service.
export class StartHandoverDto {
  @IsInt()
  toUserId: number;

  @IsString()
  @MaxLength(4000)
  whatDone: string;

  @IsString()
  @MaxLength(4000)
  howToTest: string;

  @IsString()
  @MaxLength(4000)
  knownIssues: string;

  @IsString()
  @MaxLength(4000)
  dependencies: string;

  @IsString()
  @MaxLength(4000)
  environment: string;
}

export class RejectHandoverDto {
  @IsString()
  @MaxLength(2000)
  reason: string;
}

// Design handover - see ../design-handovers.ts. Links are checked in the
// service (types, URLs, count); notes length uses handoverFieldMin.
export class StartDesignHandoverDto {
  @IsInt()
  toUserId: number;

  @IsString()
  @MaxLength(4000)
  notes: string;

  @IsArray()
  artifacts: { type: string; url: string }[];
}

// Exactly one of: link an existing task, or create a new one with a title.
export class AcceptDesignHandoverDto {
  @IsOptional()
  @IsInt()
  linkTaskId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  newTaskTitle?: string;
}

export class SetDesignHandoverSwitchDto {
  @IsBoolean()
  enabled: boolean;
}
