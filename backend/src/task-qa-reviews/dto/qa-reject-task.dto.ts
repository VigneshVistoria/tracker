import { IsString, MinLength } from 'class-validator';

export class QaRejectTaskDto {
  @IsString()
  @MinLength(1, { message: 'A comment explaining the rejection is required.' })
  comment: string;
}
