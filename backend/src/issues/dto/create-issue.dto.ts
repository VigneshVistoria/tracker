import { IsString, MinLength, IsOptional, IsInt, IsEnum, IsBoolean } from 'class-validator';
import { IssueMode, IssueCategory } from '../issue.entity';
import { Priority } from '../../common/priority.enum';

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

  // Optional - a creator can pick a priority. Ignored (forced to High) for
  // Executive/Program Manager creators, since those are always treated as
  // Leadership Requests per Section 34 - see IssuesService.create().
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;
}
