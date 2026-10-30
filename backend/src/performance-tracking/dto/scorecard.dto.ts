import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { TRACKING_METRICS, TrackingMetric } from '../metrics/tracking-metrics';

// The reason's minimum length is checked in the service (after trimming).
export class CreateScoreOverrideDto {
  @IsInt()
  userId: number;

  @IsIn(TRACKING_METRICS)
  metric: TrackingMetric;

  @IsInt()
  @Min(1)
  @Max(5)
  score: number;

  @IsString()
  @MaxLength(2000)
  reason: string;
}

export class RemoveScoreOverrideDto {
  @IsString()
  @MaxLength(2000)
  reason: string;
}
