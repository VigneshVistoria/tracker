import { Injectable, BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { ProjectTask } from '../project-task.entity';
import { BulkSpreadsheetFormat } from '../dto/bulk-import-tasks.dto';

// Export is deliberately narrower than import: the Task Backlog list
// being exported is always unassigned by definition (TasksService.
// findBacklog() only ever returns assigneeUserId IS NULL rows), so an
// Assignee column would always be blank there. Import adds Description
// and Assignee back as the two optional columns that let a row create an
// already-assigned, already-described task instead of a bare Backlog
// placeholder (mirrors CreateTaskDto's own optional fields).
export const TASK_EXPORT_COLUMNS = ['Project', 'Module', 'Phase', 'Title', 'Priority'] as const;
export const TASK_IMPORT_COLUMNS = ['Project', 'Module', 'Phase', 'Title', 'Description', 'Priority', 'Assignee'] as const;

export type TaskExportColumn = (typeof TASK_EXPORT_COLUMNS)[number];
export type TaskImportColumn = (typeof TASK_IMPORT_COLUMNS)[number];
export type RawTaskRow = Partial<Record<TaskImportColumn, string>>;

// CSV formula injection (CWE-1236) - same mitigation as
// IssueSpreadsheetService: Title/Description are free text, so a value
// starting with one of these characters gets a leading quote on export to
// stop Excel's CSV importer from auto-evaluating it as a formula.
const CSV_FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];
function sanitizeForCsvFormulaInjection(value: string): string {
  if (value && CSV_FORMULA_TRIGGER_CHARS.includes(value[0])) {
    return `'${value}`;
  }
  return value;
}

function toExportRow(task: ProjectTask): Record<TaskExportColumn, string> {
  return {
    Project: task.projectName || '',
    Module: task.moduleName || '',
    Phase: task.phaseName || '',
    Title: task.title || '',
    Priority: task.priority || '',
  };
}

// Two placeholder rows on the downloadable import template - real column
// headers/order (via the same writer buildExport() uses), fake data. One
// row leaves Description/Priority/Assignee blank to show they're
// optional; the other fills every column in, including a QA assignee, to
// show that's a supported role too.
const TEMPLATE_ROWS: Record<TaskImportColumn, string>[] = [
  {
    Project: 'LMS',
    Module: 'Authentication',
    Phase: 'Sprint 1',
    Title: 'Add password strength meter',
    Description: '',
    Priority: '',
    Assignee: '',
  },
  {
    Project: 'LMS',
    Module: 'Authentication',
    Phase: 'Sprint 1',
    Title: 'Set up staging environment for login testing',
    Description: 'Provision a staging instance with seeded test accounts before QA starts writing test cases.',
    Priority: 'High',
    Assignee: 'qa.person@example.com',
  },
];

// Cell values coming back from exceljs can be a Date, a number, a
// rich-text object, or null - normalized here to the same plain-string
// shape CSV parsing already produces, so the row validator only ever
// deals with strings regardless of which format was uploaded.
function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'text' in (value as any)) return String((value as any).text ?? '');
  return String(value).trim();
}

@Injectable()
export class TaskSpreadsheetService {
  async buildExport(tasks: ProjectTask[], format: BulkSpreadsheetFormat): Promise<{ buffer: Buffer; filename: string }> {
    const rows = tasks.map(toExportRow);
    const datestamp = new Date().toISOString().slice(0, 10);
    return this.writeSpreadsheet(rows, TASK_EXPORT_COLUMNS, format, `task-backlog-export-${datestamp}`, 'Task Backlog');
  }

  // Built from the exact same writer as a real export/template pairing
  // that IssueSpreadsheetService uses, so headers/column order can never
  // drift from what parseImport() actually expects.
  async buildTemplate(format: BulkSpreadsheetFormat): Promise<{ buffer: Buffer; filename: string }> {
    return this.writeSpreadsheet(TEMPLATE_ROWS, TASK_IMPORT_COLUMNS, format, 'task-backlog-import-template', 'Task Backlog');
  }

  private async writeSpreadsheet(
    rows: Record<string, string>[],
    columns: readonly string[],
    format: BulkSpreadsheetFormat,
    filenameStem: string,
    sheetName: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (format === 'csv') {
      const sanitizedRows = rows.map((row) => {
        const sanitized = { ...row };
        for (const col of columns) {
          sanitized[col] = sanitizeForCsvFormulaInjection(sanitized[col]);
        }
        return sanitized;
      });
      const csv = stringify(sanitizedRows, { header: true, columns: columns as unknown as string[] });
      return { buffer: Buffer.from(csv, 'utf-8'), filename: `${filenameStem}.csv` };
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns.map((header) => ({ header, key: header, width: 22 }));
    sheet.addRows(rows);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: `${filenameStem}.xlsx` };
  }

  async parseImport(fileBase64: string, format: BulkSpreadsheetFormat): Promise<RawTaskRow[]> {
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

    const rows: RawTaskRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      // exceljs still returns a Row object for a fully blank row - skip it
      // the same way csv-parse's skip_empty_lines does, so a trailing
      // blank row in the workbook doesn't become a bogus error row.
      if (row.cellCount === 0 || row.values === undefined || (row.values as any[]).every((v) => v == null || v === '')) {
        continue;
      }
      const raw: RawTaskRow = {};
      for (const header of TASK_IMPORT_COLUMNS) {
        const colIndex = columnIndexByHeader.get(header);
        if (colIndex === undefined) continue;
        raw[header] = cellToString(row.getCell(colIndex).value);
      }
      rows.push(raw);
    }
    return rows;
  }
}
