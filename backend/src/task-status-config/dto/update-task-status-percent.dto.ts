import { IsInt, Min, Max } from 'class-validator';

export class UpdateTaskStatusPercentDto {
  @IsInt()
  @Min(0)
  @Max(100)
  percent: number;
}
