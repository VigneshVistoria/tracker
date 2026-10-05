import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { TestCaseSpreadsheetFormat } from './dto/bulk-import-test-cases.dto';

// Format-agnostic read/write for test case bulk import/export, so the
// validation in TestCasesService.bulkImport() never needs to know whether
// a row came from a .csv or an .xlsx - same idea as
// IssueSpreadsheetService, but reading *every* column (not a fixed list),
// since custom field columns vary per tenant.

export const MAX_IMPORT_ROWS = 5000;

export interface ParsedSheet {
  headers: string[];
  // rowNumber is the row as the user sees it in their spreadsheet (the
  // header is row 1), so error messages point at the right place.
  rows: { rowNumber: number; cells: string[] }[];
}

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as any;
    if (Array.isArray(v.richText)) return v.richText.map((part: any) => part.text ?? '').join('').trim();
    if ('result' in v) return cellToString(v.result); // formula - use its computed value
    if ('text' in v) return String(v.text ?? '').trim(); // hyperlink
    if ('error' in v) return '';
  }
  return String(value).trim();
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c === '');
}

export async function parseSpreadsheet(fileBase64: string, format: TestCaseSpreadsheetFormat): Promise<ParsedSheet> {
  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length === 0) {
    throw new BadRequestException('The uploaded file is empty.');
  }

  let headers: string[];
  let rows: ParsedSheet['rows'] = [];

  if (format === 'csv') {
    let records: string[][];
    try {
      // bom: Excel's "CSV UTF-8" export starts with a byte-order mark,
      // which would otherwise stick to the first header ("﻿title").
      records = parse(buffer.toString('utf-8'), { bom: true, relax_column_count: true, skip_empty_lines: true });
    } catch (err: any) {
      throw new BadRequestException(`Could not read the CSV file: ${err.message}`);
    }
    headers = (records[0] || []).map((h) => cellToString(h));
    rows = records
      .slice(1)
      .map((cells, i) => ({ rowNumber: i + 2, cells: headers.map((_, col) => cellToString(cells[col])) }))
      .filter((row) => !isBlankRow(row.cells));
  } else {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch (err: any) {
      throw new BadRequestException(`Could not read the Excel file (.xlsx only, not .xls): ${err.message}`);
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('The uploaded workbook has no sheets.');
    }
    headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber - 1] = cellToString(cell.value);
    });
    headers = Array.from(headers, (h) => h ?? '');
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const cells = headers.map((_, col) => cellToString(row.getCell(col + 1).value));
      if (!isBlankRow(cells)) rows.push({ rowNumber, cells });
    }
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(`The file has ${rows.length} rows - split it into files of at most ${MAX_IMPORT_ROWS} rows.`);
  }
  return { headers, rows };
}

export interface ReferenceSheet {
  name: string;
  columns: string[];
  rows: string[][];
}

export interface SpreadsheetSpec {
  columns: string[];
  rows: Record<string, string | number>[];
  // .xlsx only: in-cell dropdowns (column -> allowed values) and extra
  // read-only sheets (e.g. instructions). Ignored for CSV.
  dropdowns?: Record<string, string[]>;
  referenceSheets?: ReferenceSheet[];
}

// Excel caps an inline list validation at 255 characters.
const MAX_INLINE_LIST_LENGTH = 255;
const DROPDOWN_ROW_COUNT = 1000;

export async function writeSpreadsheet(spec: SpreadsheetSpec, format: TestCaseSpreadsheetFormat): Promise<Buffer> {
  if (format === 'csv') {
    return Buffer.from(stringify(spec.rows, { header: true, columns: spec.columns }), 'utf-8');
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Test Cases', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = spec.columns.map((header) => ({ header, key: header, width: Math.max(14, Math.min(40, header.length + 6)) }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(spec.rows);
  for (const row of sheet.getRows(2, spec.rows.length) || []) {
    row.alignment = { vertical: 'top', wrapText: true };
  }

  for (const [column, values] of Object.entries(spec.dropdowns || {})) {
    const colIndex = spec.columns.indexOf(column) + 1;
    const list = values.map((v) => v.replace(/"/g, '""')).join(',');
    if (colIndex === 0 || values.length === 0 || values.some((v) => v.includes(',')) || list.length > MAX_INLINE_LIST_LENGTH) {
      continue;
    }
    for (let r = 2; r <= DROPDOWN_ROW_COUNT + 1; r++) {
      sheet.getCell(r, colIndex).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${list}"`],
        showErrorMessage: true,
        errorTitle: 'Not an allowed value',
        error: `Pick one of: ${values.join(', ')}`,
      };
    }
  }

  for (const ref of spec.referenceSheets || []) {
    const refSheet = workbook.addWorksheet(ref.name);
    refSheet.columns = ref.columns.map((header) => ({ header, key: header, width: 30 }));
    refSheet.getRow(1).font = { bold: true };
    ref.rows.forEach((r) => refSheet.addRow(r));
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Execution Summary download - one sheet laid out like the team's own
// Excel summary (Overall Progress, then By Priority). Values, not
// formulas, so the file is a snapshot of the portal at download time.
// Typed loosely to avoid importing the service's types back into here.
export async function writeExecutionSummary(
  summary: {
    overall: Record<'total' | 'passed' | 'failed' | 'blocked' | 'notExecuted' | 'na', number>;
    byPriority: (Record<'total' | 'passed' | 'failed' | 'blocked' | 'notExecuted' | 'na', number> & { priority: string | null })[];
  },
  filtersApplied: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Execution Summary');
  sheet.columns = [{ width: 30 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 10 }];
  const heading = (text: string) => {
    sheet.addRow([text]).font = { bold: true, size: 12 };
  };
  const header = (cells: string[]) => {
    const row = sheet.addRow(cells);
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EAF0' } };
      cell.border = { bottom: { style: 'thin' } };
    });
  };

  sheet.addRow(['Test Case – Execution Summary']).font = { bold: true, size: 14 };
  sheet.addRow([`Filters: ${filtersApplied}`]);
  sheet.addRow([`Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`]);
  sheet.addRow(['Results are each test case\'s latest run. N/A = Deprecated test cases.']);
  sheet.addRow([]);

  const { overall } = summary;
  heading('Overall Progress');
  header(['Metric', 'Count', '% of Total']);
  const pct = (n: number) => (overall.total ? n / overall.total : 0);
  [
    ['Total Test Cases', overall.total],
    ['Passed', overall.passed],
    ['Failed', overall.failed],
    ['Blocked', overall.blocked],
    ['Not Executed (incl. blank)', overall.notExecuted],
    ['N/A', overall.na],
  ].forEach(([label, count]) => {
    const row = sheet.addRow([label, count, pct(count as number)]);
    row.getCell(3).numFmt = '0.0%';
  });
  sheet.addRow([]);

  heading('By Priority');
  header(['Priority', 'Total', 'Pass', 'Fail', 'Blocked', 'Not Executed', 'N/A']);
  const countsRow = (label: string, c: (typeof summary.byPriority)[number] | typeof overall) =>
    sheet.addRow([label, c.total, c.passed, c.failed, c.blocked, c.notExecuted, c.na]);
  summary.byPriority.forEach((p) => countsRow(p.priority ?? 'Not set', p));
  countsRow('Total', overall).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
