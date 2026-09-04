import { IsEnum, IsNumber, IsString, IsUrl, Min, MinLength } from 'class-validator';
import { TaskArtifactType } from '../task-qa-review.entity';

export class QaSubmitTaskDto {
  @IsString()
  @MinLength(1, { message: 'Resolution is required.' })
  resolution: string;

  // Feeds the KPI module's Hours Exceed % - required here since this is
  // the one Assignee-initiated action where they know total time spent.
  @IsNumber()
  @Min(0, { message: 'Actual Hours must be zero or more.' })
  actualHours: number;

  @IsEnum(TaskArtifactType, { message: 'A valid Artifact Type is required.' })
  artifactType: TaskArtifactType;

  @IsUrl({}, { message: 'Artifact URL must be a valid link.' })
  artifactUrl: string;
}
