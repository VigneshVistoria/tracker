import * as zlib from 'zlib';
import ExcelJS from 'exceljs';
import {
  buildExportRows,
  describeFilters,
  formatLongDate,
  formatLongDateTime,
  TeamExportQuery,
} from '../src/tasks/team-export/team-tasks-export';
import { TeamTasksExportService } from '../src/tasks/team-export/team-tasks-export.service';

// Team Tasks export (2026-10-28): rows, order, dates and filter text with
// no database, plus the PDF/Excel files themselves.
describe('Team Tasks export', () => {
  const assignees = [
    { id: 1, email: 'ann@x', fullName: 'Ann Lee' },
    { id: 2, email: 'bob@x', fullName: null },
  ];
  const phases = [{ id: 7, name: 'Build' }];
  const task = (id: number, values: Record<string, any> = {}) => ({
    id,
    title: `Task ${id}`,
    status: 'Development',
    isDefect: false,
    assigneeUserId: 1,
    assigneeEmail: 'ann@x',
    phaseName: 'Build',
    dueDate: '2026-11-03',
    estimatedHours: '4.5',
    percentComplete: 20,
    ageingDays: 3,
    ...values,
  });
  const dep = (id: number, filer: string, parentTaskId: number, values: Record<string, any> = {}) => ({
    kind: 'dependency',
    id,
    title: `Ticket ${id}`,
    status: 'Open',
    assigneeUserId: 2,
    assigneeEmail: 'bob@x',
    createdByEmail: `${filer}@x`,
    createdByName: filer,
    dueDate: '2026-11-10',
    parentTaskId,
    parentTaskTitle: `Parent ${parentTaskId}`,
    ageingDays: 1,
    ...values,
  });
  const result = (tasks: any[]) => ({ tasks, assignees, phases, total: tasks.length }) as any;
  const baseQuery: TeamExportQuery = { showHoldClosed: false, includeDependencies: false };

  describe('dates', () => {
    it('writes a due date as "Month DD, YYYY" without shifting the day', () => {
      expect(formatLongDate('2026-11-03')).toBe('November 03, 2026');
      expect(formatLongDate(null)).toBe('');
    });

    it('shows a timestamp on its Addis Ababa calendar day', () => {
      // 22:30 UTC on Oct 27 is 01:30 on Oct 28 in Addis Ababa (UTC+3).
      expect(formatLongDate(new Date('2026-10-27T22:30:00Z'))).toBe('October 28, 2026');
      expect(formatLongDateTime(new Date('2026-10-27T22:30:00Z'))).toBe('October 28, 2026, 01:30 AM (Addis Ababa time)');
    });
  });

  describe('rows', () => {
    it('keeps the page order and fills every column', () => {
      const rows = buildExportRows(
        result([task(1), task(2, { isDefect: true, status: 'Escalated', assigneeUserId: 2, assigneeEmail: 'bob@x' }), dep(9, 'Cara', 1)]),
        {},
      );
      expect(rows.map((r) => [r.section, r.type, r.id])).toEqual([
        ['Tasks', 'Task', 1],
        ['Defects', 'Defect', 2],
        ['Dependencies', 'Dependency', 9],
      ]);
      expect(rows[0]).toMatchObject({
        title: 'Task 1',
        status: 'Development',
        assignee: 'Ann Lee',
        phase: 'Build',
        dueDate: 'November 03, 2026',
        dueDateIso: '2026-11-03',
        estimatedHours: 4.5,
        percentComplete: 20,
        ageDays: 3,
        filedBy: '',
        dependsOn: '',
      });
      // Status display rename and email fallback for a person with no Full Name.
      expect(rows[1]).toMatchObject({ status: 'Intervention', assignee: 'bob@x' });
      expect(rows[2]).toMatchObject({
        filedBy: 'Cara',
        dependsOn: '#1 Parent 1',
        dueDate: 'November 10, 2026 (task due)',
        assignee: 'bob@x',
        phase: '',
        estimatedHours: null,
        percentComplete: null,
      });
    });

    it('applies the column sort inside each section and "Filed by" group only', () => {
      const rows = buildExportRows(
        result([
          task(1, { title: 'b' }),
          task(2, { title: 'a' }),
          task(3, { isDefect: true, title: 'c' }),
          dep(10, 'Zed', 1, { title: 'z2' }),
          dep(11, 'Zed', 1, { title: 'z1' }),
          dep(12, 'Amy', 2, { title: 'a1' }),
        ]),
        { sortKey: 'title', sortDir: 'asc' },
      );
      // Zed's group stays ahead of Amy's (the server's group order).
      expect(rows.map((r) => r.title)).toEqual(['a', 'b', 'c', 'z1', 'z2', 'a1']);
      const desc = buildExportRows(result([task(1, { dueDate: '2026-11-01' }), task(2, { dueDate: '2026-12-01' })]), {
        sortKey: 'dueDate',
        sortDir: 'desc',
      });
      expect(desc.map((r) => r.id)).toEqual([2, 1]);
    });

    it('ignores an unknown sort key', () => {
      const rows = buildExportRows(result([task(2), task(1)]), { sortKey: 'nope', sortDir: 'asc' });
      expect(rows.map((r) => r.id)).toEqual([2, 1]);
    });
  });

  describe('filter text', () => {
    it('names the tab, people and phase instead of ids', () => {
      const lines = describeFilters(
        {
          ...baseQuery,
          status: 'Development,Failed,Released - With Showstoppers,PM Feedback,Not Ready for Testing',
          assigneeUserId: 1,
          phaseId: 7,
          dependency: 'Yes',
          dueFrom: '2026-11-01',
          showHoldClosed: true,
        },
        result([]),
      );
      expect(Object.fromEntries(lines)).toEqual({
        Tab: 'Development / Failed',
        Assignee: 'Ann Lee',
        'Project phase': 'Build',
        Dependency: 'Yes',
        'Due from': 'November 01, 2026',
        'Due to': 'Any',
        'Hold/Closed': 'Shown',
        Dependencies: 'Hidden while Project Phase, Dependency, Defect, or Due date filters are active',
      });
    });

    it('defaults to All, and shows a card-only status and the Defect filter', () => {
      expect(Object.fromEntries(describeFilters(baseQuery, result([])))).toMatchObject({ Tab: 'All', Assignee: 'All', 'Hold/Closed': 'Hidden' });
      expect(Object.fromEntries(describeFilters({ ...baseQuery, status: 'Failed', isDefect: 'Yes' }, result([])))).toMatchObject({
        Tab: 'Failed',
        Defect: 'Yes',
      });
    });
  });

  // The text drawn on each PDF page: pdfkit writes it as hex strings
  // inside compressed content streams (one stream per page, in order).
  const pdfPageTexts = (pdf: Buffer): string[] => {
    const raw = pdf.toString('latin1');
    const texts: string[] = [];
    const re = /stream\r?\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const start = m.index + m[0].length;
      const end = raw.indexOf('endstream', start);
      let content: string;
      try {
        content = zlib.inflateSync(pdf.subarray(start, end)).toString('latin1');
      } catch {
        continue;
      }
      const hex = content.match(/<[0-9a-fA-F]+>/g) || [];
      texts.push(hex.map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1')).join(''));
    }
    return texts.filter((t) => t.length > 0);
  };

  describe('files', () => {
    const service = new TeamTasksExportService();
    const many = Array.from({ length: 120 }, (_, i) => task(i + 1, { title: `A fairly long task title number ${i + 1} — “quoted”…` }));
    const docData = (tasks: any[]) => ({
      rows: buildExportRows(result(tasks), {}),
      filters: describeFilters(baseQuery, result([])),
      exportedBy: 'Pat PM (pm@x)',
      exportedAt: 'October 28, 2026, 10:00 AM (Addis Ababa time)',
    });

    it('PDF is landscape A4 and runs onto several pages', async () => {
      const pdf = await service.buildPdf(docData([...many, dep(500, 'Cara', 1)]));
      const text = pdf.toString('latin1');
      expect(text.startsWith('%PDF')).toBe(true);
      expect(text).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
      const pageCount = (text.match(/\/Type \/Page\b/g) || []).length;
      expect(pageCount).toBeGreaterThan(1);
      const pages = pdfPageTexts(pdf);
      expect(pages).toHaveLength(pageCount);
      pages.forEach((t, i) => expect(t).toContain(`Page ${i + 1} of ${pageCount}`));
      expect(pages[0]).toContain('Team Tasks');
      expect(pages[0]).toContain('Exported by Pat PM (pm@x) on October 28, 2026');
      expect(pages[0]).toContain('Tab: All');
      expect(pages[0]).toContain('Tasks (120)');
      expect(pages[pageCount - 1]).toContain('Filed by Cara (1)');
      // The column header repeats on every page.
      pages.forEach((t) => expect(t).toContain('Depends on task'));
    });

    it('PDF with no rows still builds', async () => {
      const pdf = await service.buildPdf(docData([]));
      expect(pdf.toString('latin1').startsWith('%PDF')).toBe(true);
    });

    it('Excel has a filtered data sheet with real dates and a Filters sheet', async () => {
      const buffer = await service.buildXlsx(docData([...many, dep(500, 'Cara', 1)]));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
      const sheet = wb.getWorksheet('Team Tasks')!;
      expect((sheet.getRow(1).values as any[]).slice(1)).toEqual([
        'Section', '#', 'Title', 'Type', 'Status', 'Assignee', 'Project phase', 'Due date', 'Est. hrs', 'Done %', 'Age (days)', 'Filed by', 'Depends on task',
      ]);
      expect(sheet.rowCount).toBe(1 + 121);
      expect(sheet.autoFilter).toBeTruthy();
      const first = sheet.getRow(2);
      expect(first.getCell(8).value).toEqual(new Date('2026-11-03T00:00:00Z'));
      expect(first.getCell(8).numFmt).toBe('mmmm dd, yyyy');
      const last = sheet.getRow(122);
      expect([last.getCell(1).value, last.getCell(12).value, last.getCell(13).value]).toEqual(['Dependencies', 'Cara', '#1 Parent 1']);

      const filters = wb.getWorksheet('Filters')!;
      const info = new Map<string, string>();
      filters.eachRow((row, n) => {
        if (n > 1) info.set(String(row.getCell(1).value), String(row.getCell(2).value));
      });
      expect(info.get('Exported by')).toBe('Pat PM (pm@x)');
      expect(info.get('Rows')).toBe('121');
      expect(info.get('Tab')).toBe('All');
    });

    it('Excel stores a formula-looking title as plain text', async () => {
      const buffer = await service.buildXlsx(docData([task(1, { title: '=HYPERLINK("http://x","y")' })]));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
      expect(wb.getWorksheet('Team Tasks')!.getRow(2).getCell(3).value).toBe('=HYPERLINK("http://x","y")');
    });
  });
});
