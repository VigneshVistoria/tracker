import { IsInt, IsString, MaxLength } from 'class-validator';
import { REQUEST_TEXT_MAX } from '../task-requests';

// Minimum lengths are checked in the service, after trimming.
export class CreateTaskRequestDto {
  @IsInt()
  requestedOfUserId: number;

  @IsString()
  @MaxLength(REQUEST_TEXT_MAX)
  body: string;
}

export class AnswerTaskRequestDto {
  @IsString()
  @MaxLength(REQUEST_TEXT_MAX)
  body: string;
}
