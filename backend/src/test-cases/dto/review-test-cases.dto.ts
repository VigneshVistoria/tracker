import { ArrayMinSize, ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

// Every review action takes a list of ids so the list page can act on a
// selection in one call; the detail page just sends a single id.
export class SubmitTestCasesForReviewDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one test case' })
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids: number[];
}

export class ApproveTestCasesDto extends SubmitTestCasesForReviewDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

export class RejectTestCasesDto extends SubmitTestCasesForReviewDto {
  @IsString()
  @MinLength(1, { message: 'A comment is required to reject a test case' })
  comment: string;
}
