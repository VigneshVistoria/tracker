import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export type TestCaseSpreadsheetFormat = 'csv' | 'xlsx';

export class BulkImportTestCasesDto {
  @IsIn(['csv', 'xlsx'])
  format: TestCaseSpreadsheetFormat;

  // Base64-encoded file content (no data-URI prefix), same convention as
  // BulkImportIssuesDto - avoids adding multer/file-upload plumbing, which
  // this backend uses nowhere else. Column matching/validation rules are
  // documented on TestCasesService.bulkImport().
  @IsString()
  @MinLength(1, { message: 'File content is required' })
  fileBase64: string;

  // true = validate and report what would happen without saving anything
  // (the import page's Preview step). The real import re-validates the
  // whole file from scratch rather than trusting an earlier preview.
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
