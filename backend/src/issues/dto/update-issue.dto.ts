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
    message: 'Status must be one of: Open, In Progress, Client Review, Closed',
  })
  status?: IssueStatus;

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
