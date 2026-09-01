import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export type BulkSpreadsheetFormat = 'csv' | 'xlsx';

export class BulkImportIssuesDto {
  @IsIn(['csv', 'xlsx'])
  format: BulkSpreadsheetFormat;

  // Base64-encoded file content (no data-URI prefix), same convention as
  // Issue.photoBase64 - avoids adding multer/file-upload plumbing, which
  // this backend uses nowhere else.
  @IsString()
  @MinLength(1, { message: 'File content is required' })
  fileBase64: string;
}
