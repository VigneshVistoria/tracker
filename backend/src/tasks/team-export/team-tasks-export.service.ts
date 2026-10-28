import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { TeamExportRow, ExportSection } from './team-tasks-export';

export interface TeamExportDocument {
  rows: TeamExportRow[];
  filters: Array<[string, string]>;
  exportedBy: string;
  exportedAt: string;
}

// Same ink colors as PdfNonComplianceReportService (hex, since pdfkit
// can't read the app's CSS custom properties).
const INK = '#362b23';
const INK_SOFT = '#6b5f55';
const MUTED = '#8a7d72';
const BAND = '#f1ece6';
const RULE = '#d9d0c7';

const PDF_COLUMNS: Array<{ header: string; width: number; align?: 'left' | 'right' | 'center'; value: (r: TeamExportRow) => string }> = [
  { header: '#', width: 34, value: (r) => `#${r.id}` },
  { header: 'Title', width: 142, value: (r) => r.title },
  { header: 'Type', width: 48, value: (r) => r.type },
  { header: 'Status', width: 72, value: (r) => r.status },
  { header: 'Assignee', width: 76, value: (r) => r.assignee || '—' },
  { header: 'Project phase', width: 60, value: (r) => r.phase || '—' },
  { header: 'Due date', width: 86, value: (r) => r.dueDate || '—' },
  { header: 'Est. hrs', width: 34, align: 'right', value: (r) => (r.estimatedHours == null ? '—' : String(r.estimatedHours)) },
  { header: 'Done %', width: 36, align: 'right', value: (r) => (r.percentComplete == null ? '—' : `${r.percentComplete}%`) },
  { header: 'Age', width: 30, align: 'right', value: (r) => `${r.ageDays}d` },
  { header: 'Filed by', width: 62, value: (r) => r.filedBy || '—' },
  { header: 'Depends on task', width: 90, value: (r) => r.dependsOn || '—' },
];

const EXCEL_COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: 'Section', key: 'section', width: 14 },
  { header: '#', key: 'id', width: 8 },
  { header: 'Title', key: 'title', width: 48 },
  { header: 'Type', key: 'type', width: 12 },
  { header: 'Status', key: 'status', width: 22 },
  { header: 'Assignee', key: 'assignee', width: 22 },
  { header: 'Project phase', key: 'phase', width: 18 },
  { header: 'Due date', key: 'dueDate', width: 20 },
  { header: 'Est. hrs', key: 'estimatedHours', width: 10 },
  { header: 'Done %', key: 'percentComplete', width: 10 },
  { header: 'Age (days)', key: 'ageDays', width: 11 },
  { header: 'Filed by', key: 'filedBy', width: 22 },
  { header: 'Depends on task', key: 'dependsOn', width: 40 },
];

const CELL_PAD = 3;
const FONT_SIZE = 7.5;

// Team Tasks export files (2026-10-28) - same on-demand, in-memory
// pdfkit approach as PdfNonComplianceReportService, plus exceljs as used
// by TaskSpreadsheetService. Landscape A4 so the 12 columns fit without
// wrapping the header.
@Injectable()
export class TeamTasksExportService {
  async buildPdf(docData: TeamExportDocument): Promise<Buffer> {
    // bufferPages: page numbers ("Page X of Y") are written once the total is known.
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: 'Team Tasks' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const left = doc.page.margins.left;
    const tableWidth = PDF_COLUMNS.reduce((sum, c) => sum + c.width, 0);
    // Room kept free at the bottom for the page number.
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 14;

    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('Team Tasks', left, doc.page.margins.top);
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).fillColor(INK_SOFT);
    doc.text(`Exported by ${docData.exportedBy} on ${docData.exportedAt}`);
    doc.text(`${docData.rows.length} ${docData.rows.length === 1 ? 'row' : 'rows'}`);
    doc.moveDown(0.3);
    doc.text(docData.filters.map(([label, value]) => `${label}: ${value}`).join('   ·   '), { width: tableWidth });
    doc.moveDown(0.6);

    const drawColumnHeader = () => {
      const y = doc.y;
      doc.rect(left, y, tableWidth, 14).fill(INK);
      doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor('#ffffff');
      let x = left;
      for (const c of PDF_COLUMNS) {
        doc.text(c.header, x + CELL_PAD, y + 4, { width: c.width - CELL_PAD * 2, align: c.align || 'left', lineBreak: false });
        x += c.width;
      }
      doc.y = y + 14;
    };
    const ensureRoom = (height: number) => {
      if (doc.y + height <= bottomLimit()) return;
      doc.addPage();
      drawColumnHeader();
    };
    const BAND_HEIGHT = 15;
    const drawBand = (label: string, indent: number) => {
      const y = doc.y;
      doc.rect(left, y, tableWidth, BAND_HEIGHT).fill(BAND);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(label, left + CELL_PAD + indent, y + 4, { lineBreak: false });
      doc.y = y + BAND_HEIGHT;
    };

    if (docData.rows.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('No tasks match these filters.', left);
    } else {
      drawColumnHeader();
      const sectionCounts = countBy(docData.rows, (r) => r.section);
      const filerCounts = countBy(docData.rows.filter((r) => r.section === 'Dependencies'), (r) => r.filedBy);
      let prev: TeamExportRow | null = null;
      for (const r of docData.rows) {
        const newSection = !prev || prev.section !== r.section;
        const newFiler = r.section === 'Dependencies' && (newSection || prev!.filedBy !== r.filedBy);
        doc.font('Helvetica').fontSize(FONT_SIZE);
        const values = PDF_COLUMNS.map((c) => c.value(r));
        const height =
          Math.max(...PDF_COLUMNS.map((c, i) => doc.heightOfString(values[i], { width: c.width - CELL_PAD * 2 }))) + CELL_PAD * 2;
        // Bands and their first row move to the next page together, so a
        // band is never left alone at the bottom of a page.
        ensureRoom(height + (newSection ? BAND_HEIGHT : 0) + (newFiler ? BAND_HEIGHT : 0));
        if (newSection) drawBand(`${r.section} (${sectionCounts.get(r.section)})`, 0);
        if (newFiler) drawBand(`Filed by ${r.filedBy} (${filerCounts.get(r.filedBy)})`, 10);
        doc.font('Helvetica').fontSize(FONT_SIZE);
        const y = doc.y;
        let x = left;
        doc.fillColor(INK);
        PDF_COLUMNS.forEach((c, i) => {
          doc.text(values[i], x + CELL_PAD, y + CELL_PAD, { width: c.width - CELL_PAD * 2, align: c.align || 'left' });
          x += c.width;
        });
        doc.moveTo(left, y + height).lineTo(left + tableWidth, y + height).lineWidth(0.5).strokeColor(RULE).stroke();
        doc.y = y + height;
        prev = r;
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would otherwise make pdfkit add a page.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED);
      doc.text(`Team Tasks · Page ${i - range.start + 1} of ${range.count}`, left, doc.page.height - bottomMargin - 6, {
        width: tableWidth,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottomMargin;
    }

    doc.end();
    return done;
  }

  async buildXlsx(docData: TeamExportDocument): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Tracker';
    const sheet = workbook.addWorksheet('Team Tasks', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = EXCEL_COLUMNS;
    for (const r of docData.rows) {
      sheet.addRow({
        section: r.section,
        id: r.id,
        title: r.title,
        type: r.type,
        status: r.status,
        assignee: r.assignee,
        phase: r.phase,
        // A real date (UTC midnight, which is how Excel stores a plain day),
        // shown as "October 28, 2026" by the column format below.
        dueDate: r.dueDateIso ? new Date(`${r.dueDateIso}T00:00:00Z`) : null,
        estimatedHours: r.estimatedHours,
        percentComplete: r.percentComplete,
        ageDays: r.ageDays,
        filedBy: r.filedBy,
        dependsOn: r.dependsOn,
      });
    }
    sheet.getColumn('dueDate').numFmt = 'mmmm dd, yyyy';
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, docData.rows.length + 1), column: EXCEL_COLUMNS.length } };

    const filters = workbook.addWorksheet('Filters');
    filters.columns = [
      { header: 'Field', key: 'field', width: 18 },
      { header: 'Value', key: 'value', width: 80 },
    ];
    filters.getRow(1).font = { bold: true };
    const info: Array<[string, string]> = [
      ['Page', 'Team Tasks'],
      ['Exported by', docData.exportedBy],
      ['Exported at', docData.exportedAt],
      ['Rows', String(docData.rows.length)],
      ...docData.filters,
      ['Note', "For dependency rows, Due date is the parent task's due date and Assignee is who must clear the ticket."],
    ];
    for (const [field, value] of info) filters.addRow({ field, value });

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}

function countBy(rows: TeamExportRow[], key: (r: TeamExportRow) => string | ExportSection): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r), (counts.get(key(r)) || 0) + 1);
  return counts;
}
