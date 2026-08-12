import { IsString, MinLength, IsOptional, IsInt, IsEnum, IsBoolean } from 'class-validator';
import { IssueMode } from '../issue.entity';

export class CreateIssueDto {
  @IsString()
  @MinLength(1, { message: 'Title is required' })
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  assigneeUserId?: number;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsEnum(IssueMode)
  mode?: IssueMode;

  @IsOptional()
  @IsBoolean()
  showstopper?: boolean;
}
