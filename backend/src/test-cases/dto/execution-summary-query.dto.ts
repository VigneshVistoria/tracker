import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { TestCaseReviewStatus, TestCaseStatus } from '../test-case.entity';

// The Test Cases list's filters, as query params, so the Execution Summary
// counts exactly what the list shows - see TestCasesService.
// applyListFilters() for how each one matches.
export class ExecutionSummaryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  projectId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  moduleId?: number;

  @IsOptional()
  @IsEnum(TestCaseStatus)
  status?: TestCaseStatus;

  @IsOptional()
  @IsEnum(TestCaseReviewStatus)
  reviewStatus?: TestCaseReviewStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  labelId?: number;

  @IsOptional()
  @IsString()
  search?: string;
}
