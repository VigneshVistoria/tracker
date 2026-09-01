import { Injectable, BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { Issue } from '../issue.entity';
import { BulkSpreadsheetFormat } from '../dto/bulk-import-issues.dto';

// Column headers double as the canonical field keys both formats parse
// into, so validation/import logic downstream never needs to know which
// format a row came from.
export const ISSUE_EXPORT_COLUMNS = [
  'Issue ID',
  'Project',
  'Module',
  'Issue Title',
  'Description',
  'Estimated Hours',
  'Due Date',
  'Target Date',
  'Dependency',
  'Dependency Owner',
  'Status',
] as const;

export type IssueExportColumn = (typeof ISSUE_EXPORT_COLUMNS)[number];
export type RawIssueRow = Partial<Record<IssueExportColumn, string>>;

// CSV formula injection (CWE-1236): Title/Description/Dependency are free
// text, and Title/Description can be set by lower-trust roles (e.g. Client
// tickets) via the normal creation flow. If a value starting with one of
// these characters is opened in Excel from a .csv, Excel's CSV importer
// auto-evaluates it as a formula regardless of any type info - unlike
// .xlsx, which encodes an explicit string type exceljs already sets, so
// this only applies to the CSV path. Prefixing with a single quote is the
// standard mitigation (forces text interpretation); the round-trip cost is
// that a value that legitimately starts with one of these chars picks up
// a leading quote on export.
const CSV_FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];
function sanitizeForCsvFormulaInjection(value: string): string {
  if (value && CSV_FORMULA_TRIGGER_CHARS.includes(value[0])) {
    return `'${value}`;
  }
  return value;
}

function toExportRow(issue: Issue): Record<IssueExportColumn, string> {
  return {
    'Issue ID': String(issue.id),
    Project: issue.projectName || '',
    Module: issue.moduleName || '',
    'Issue Title': issue.title || '',
    Description: issue.description || '',
    'Estimated Hours': issue.estimatedHours != null ? String(issue.estimatedHours) : '',
    'Due Date': issue.dueDate || '',
    'Target Date': issue.targetDate || '',
    Dependency: issue.dependencyText || '',
    'Dependency Owner': issue.dependencyOwnerEmail || '',
    Status: issue.status || '',
  };
}

// Two placeholder rows shown on the downloadable import template: one with
// a blank Issue ID (illustrates a create row) and one with a placeholder
// numeric Issue ID (illustrates an update row) - not real data, just
// concrete examples of every column filled in correctly, including a
// realistic Dependency Owner email and a valid Status value.
const TEMPLATE_ROWS: Record<IssueExportColumn, string>[] = [
  {
    'Issue ID': '',
    Project: 'LMS',
    Module: 'Authentication',
    'Issue Title': 'Fix login button alignment on mobile',
    Description: 'The Sign In button overlaps the password field on iOS Safari at narrow widths.',
    'Estimated Hours': '3',
    'Due Date': '2026-09-20',
    'Target Date': '2026-09-25',
    Dependency: 'Waiting on updated design mockups from UX',
    'Dependency Owner': 'jane.doe@example.com',
    Status: 'Backlog',
  },
  {
    'Issue ID': '123',
    Project: 'LMS',
    Module: 'Authentication',
    'Issue Title': 'Only rows with a real, existing Issue ID update that issue',
    Description: 'Leave Issue ID blank (like the row above) to create a new issue instead.',
    'Estimated Hours': '5',
    'Due Date': '2026-09-22',
    'Target Date': '2026-09-28',
    Dependency: '',
    'Dependency Owner': '',
    Status: 'In Progress',
  },
];

// Cell values coming back from exceljs can be a Date, a number, a rich-text
// object, or null - normalized here to the same plain-string shape CSV
// parsing already produces, so the row validator only ever deals with
// strings regardless of which format was uploaded.
function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'text' in (value as any)) return String((value as any).text ?? '');
  return String(value).trim();
}

@Injectable()
export class IssueSpreadsheetService {
  async buildExport(issues: Issue[], format: BulkSpreadsheetFormat): Promise<{ buffer: Buffer; filename: string }> {
    const rows = issues.map(toExportRow);
    const datestamp = new Date().toISOString().slice(0, 10);
    return this.writeSpreadsheet(rows, format, `issues-export-${datestamp}`, 'Issues');
  }

  // Built from the exact same writer as a real export, so the template's
  // headers/column order can never drift from what parseImport() actually
  // expects - it's just placeholder rows instead of real Issue data.
  async buildTemplate(format: BulkSpreadsheetFormat): Promise<{ buffer: Buffer; filename: string }> {
    return this.writeSpreadsheet(TEMPLATE_ROWS, format, 'issues-import-template', 'Issues');
  }

  private async writeSpreadsheet(
    rows: Record<IssueExportColumn, string>[],
    format: BulkSpreadsheetFormat,
    filenameStem: string,
    sheetName: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (format === 'csv') {
      const sanitizedRows = rows.map((row) => {
        const sanitized = { ...row };
        for (const col of ISSUE_EXPORT_COLUMNS) {
          sanitized[col] = sanitizeForCsvFormulaInjection(sanitized[col]);
        }
        return sanitized;
      });
      const csv = stringify(sanitizedRows, { header: true, columns: ISSUE_EXPORT_COLUMNS as unknown as string[] });
      return { buffer: Buffer.from(csv, 'utf-8'), filename: `${filenameStem}.csv` };
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = ISSUE_EXPORT_COLUMNS.map((header) => ({ header, key: header, width: 22 }));
    sheet.addRows(rows);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: `${filenameStem}.xlsx` };
  }

  async parseImport(fileBase64: string, format: BulkSpreadsheetFormat): Promise<RawIssueRow[]> {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileBase64, 'base64');
    } catch {
      throw new BadRequestException('Uploaded file content is not valid base64.');
    }

    if (format === 'csv') {
      try {
        return parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true });
      } catch (err: any) {
        throw new BadRequestException(`Could not parse CSV: ${err.message}`);
      }
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch (err: any) {
      throw new BadRequestException(`Could not parse .xlsx file: ${err.message}`);
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('The uploaded workbook has no sheets.');
    }

    const headerRow = sheet.getRow(1);
    const columnIndexByHeader = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      const header = cellToString(cell.value);
      if (header) columnIndexByHeader.set(header, colNumber);
    });

    const rows: RawIssueRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      // exceljs still returns a Row object for a fully blank row - skip it
      // the same way csv-parse's skip_empty_lines does, so a trailing
      // blank row in the workbook doesn't become a bogus error row.
      if (row.cellCount === 0 || row.values === undefined || (row.values as any[]).every((v) => v == null || v === '')) {
        continue;
      }
      const raw: RawIssueRow = {};
      for (const header of ISSUE_EXPORT_COLUMNS) {
        const colIndex = columnIndexByHeader.get(header);
        if (colIndex === undefined) continue;
        raw[header] = cellToString(row.getCell(colIndex).value);
      }
      rows.push(raw);
    }
    return rows;
  }
}
