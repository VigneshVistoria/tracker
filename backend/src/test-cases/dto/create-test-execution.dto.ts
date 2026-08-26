import { IsEnum, IsOptional, IsString, IsInt } from 'class-validator';
import { TestResult } from '../test-execution.entity';

export class CreateTestExecutionDto {
  @IsEnum(TestResult, { message: 'Result must be one of: Passed, Failed, Blocked' })
  result: TestResult;

  @IsOptional()
  @IsString()
  notes?: string;

  // An existing Issue this run's failure was logged as - set separately
  // once the defect ticket exists, not auto-created here.
  @IsOptional()
  @IsInt()
  defectIssueId?: number;
}
