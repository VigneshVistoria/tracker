import { IsString, MinLength } from 'class-validator';

export class RollbackDto {
  @IsString()
  @MinLength(1)
  releaseId: string;

  @IsString()
  @MinLength(1)
  confirmText: string;
}
