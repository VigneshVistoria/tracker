import { IsString, IsOptional, IsEnum, IsInt, IsBoolean } from 'class-validator';
import { IssueStatus, IssueMode } from '../issue.entity';

export class UpdateIssueDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(IssueStatus, {
    message: 'Status must be one of: Backlog, In Progress, In Review, QA Testing, QA Failed, Ready for Production',
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
  moduleId?: number;

  @IsOptional()
  @IsInt()
  storyPoints?: number;

  @IsOptional()
  @IsEnum(IssueMode)
  mode?: IssueMode;

  @IsOptional()
  @IsBoolean()
  showstopper?: boolean;

  // Free text - the category's name from the admin-managed issue_categories
  // catalog (backend/src/issue-categories), not validated against it here.
  @IsOptional()
  @IsString()
  category?: string;
}
