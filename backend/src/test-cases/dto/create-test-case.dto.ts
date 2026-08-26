import { IsString, MinLength, IsOptional, IsInt, IsEnum } from 'class-validator';
import { Priority } from '../../common/priority.enum';
import { IssueCategory } from '../../issues/issue.entity';

export class CreateTestCaseDto {
  @IsString()
  @MinLength(1, { message: 'Title is required' })
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  preconditions?: string;

  @IsString()
  @MinLength(1, { message: 'Steps are required' })
  steps: string;

  @IsString()
  @MinLength(1, { message: 'Expected result is required' })
  expectedResult: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsEnum(IssueCategory)
  category?: IssueCategory;

  @IsOptional()
  @IsInt()
  projectId?: number;
}
