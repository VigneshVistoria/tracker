import { IsString, MinLength, IsOptional, IsInt, IsEnum, IsBoolean } from 'class-validator';
import { IssueMode } from '../issue.entity';
import { Priority } from '../../common/priority.enum';

export class CreateIssueDto {
  @IsString()
  @MinLength(1, { message: 'Title is required' })
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Raw base64 (no data-URI prefix) of a photo captured/chosen at ticket
  // creation - optional, mobile app only for now.
  @IsOptional()
  @IsString()
  photoBase64?: string;

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
  phaseId?: number;

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

  // Optional - a creator can pick a priority. Ignored (forced to High) for
  // Executive/Program Manager creators, since those are always treated as
  // Leadership Requests per Section 34 - see IssuesService.create().
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;
}
