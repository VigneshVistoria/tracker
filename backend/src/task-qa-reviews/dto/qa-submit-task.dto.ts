import { IsEnum, IsString, IsUrl, MinLength } from 'class-validator';
import { TaskArtifactType } from '../task-qa-review.entity';

export class QaSubmitTaskDto {
  @IsString()
  @MinLength(1, { message: 'Resolution is required.' })
  resolution: string;

  @IsEnum(TaskArtifactType, { message: 'A valid Artifact Type is required.' })
  artifactType: TaskArtifactType;

  @IsUrl({}, { message: 'Artifact URL must be a valid link.' })
  artifactUrl: string;
}
