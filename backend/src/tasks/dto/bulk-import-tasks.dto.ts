import { IsIn, IsString, MinLength } from 'class-validator';

export type BulkSpreadsheetFormat = 'csv' | 'xlsx';

export class BulkImportTasksDto {
  @IsIn(['csv', 'xlsx'])
  format: BulkSpreadsheetFormat;

  // Base64-encoded file content (no data-URI prefix) - same convention as
  // IssuesBulkService's BulkImportIssuesDto, avoids adding multer/file-
  // upload plumbing this backend uses nowhere else.
  @IsString()
  @MinLength(1, { message: 'File content is required' })
  fileBase64: string;
}
