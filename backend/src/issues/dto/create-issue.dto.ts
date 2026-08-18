import { IsString, MinLength, IsOptional, IsInt, IsEnum, IsBoolean } from 'class-validator';
import { IssueMode, IssueCategory } from '../issue.entity';

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
}
