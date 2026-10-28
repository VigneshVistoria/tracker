import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { EXTERNAL_OWNER_MAX, FLAG_TEXT_MAX, TASK_FLAG_KINDS, TaskFlagKind } from '../task-flags';

// Minimum lengths and the risk/blocker field rules are checked in the
// service (after trimming) so the messages can be specific.
export class SetTaskFlagDto {
  @IsInt()
  taskId: number;

  @IsIn(TASK_FLAG_KINDS)
  kind: TaskFlagKind;

  @IsString()
  @MaxLength(FLAG_TEXT_MAX)
  reason: string;

  @IsOptional()
  @IsDateString({ strict: true })
  likelyDueDate?: string;

  @IsOptional()
  @IsInt()
  blockingOwnerUserId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(EXTERNAL_OWNER_MAX)
  blockingOwnerExternal?: string;

  @IsOptional()
  @IsInt()
  dependencyTicketId?: number;
}

export class ClearTaskFlagDto {
  @IsOptional()
  @IsString()
  @MaxLength(FLAG_TEXT_MAX)
  note?: string;
}

export class ChangeNeedByDateDto {
  @IsDateString({ strict: true })
  needByDate: string;

  @IsString()
  @MaxLength(FLAG_TEXT_MAX)
  reason: string;
}
