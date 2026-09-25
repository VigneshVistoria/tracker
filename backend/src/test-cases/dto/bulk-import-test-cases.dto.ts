import { IsString, MinLength } from 'class-validator';

export class BulkImportTestCasesDto {
  // Raw CSV text, read client-side from the uploaded file and sent as
  // JSON - avoids adding multer/file-upload plumbing for what's a small,
  // text-only payload. Expected columns: title, description,
  // preconditions, steps, expectedResult, priority, category,
  // projectName, moduleName, phaseName. title/steps/expectedResult are
  // required per row; moduleName requires projectName on the same row,
  // phaseName requires moduleName.
  @IsString()
  @MinLength(1, { message: 'CSV content is required' })
  csvText: string;
}
