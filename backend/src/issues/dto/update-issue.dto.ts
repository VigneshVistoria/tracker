import { IsString, IsOptional, IsEnum, IsInt, IsBoolean } from 'class-validator';
import { IssueStatus, IssueMode, IssueCategory } from '../issue.entity';

export class UpdateIssueDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(IssueStatus, {
    message: 'Status must be one of: Backlog, In Progress, In Review, Completed',
  })
  status?: IssueStatus;

  @IsOptional()
  @IsInt()
  assigneeUserId?: number;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  sprintId?: number;

  @IsOptional()
  @IsInt()
  storyPoints?: number;

  @IsOptional()
  @IsEnum(IssueMode)
  mode?: IssueMode;

  @IsOptional()
  @IsBoolean()
  showstopper?: boolean;

  @IsOptional()
  @IsEnum(IssueCategory)
  category?: IssueCategory;
}
