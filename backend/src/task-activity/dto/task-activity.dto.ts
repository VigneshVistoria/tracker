import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ACTIVITY_TEXT_MAX } from '../task-activity';

// The note's minimum length is a setting, checked in the service.
export class ChaseTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(ACTIVITY_TEXT_MAX)
  note?: string;
}

export class AddProgressNoteDto {
  @IsString()
  @MaxLength(ACTIVITY_TEXT_MAX)
  body: string;
}
