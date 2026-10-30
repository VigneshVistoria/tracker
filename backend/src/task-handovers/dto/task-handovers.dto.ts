import { IsInt, IsString, MaxLength } from 'class-validator';

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
