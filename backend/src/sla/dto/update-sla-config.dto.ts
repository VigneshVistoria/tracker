import { IsInt, Min } from 'class-validator';

export class UpdateSlaConfigDto {
  @IsInt()
  @Min(1, { message: 'Target must be at least 1 hour' })
  targetHours: number;
}
