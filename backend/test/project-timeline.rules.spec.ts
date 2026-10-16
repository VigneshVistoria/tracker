import * as fs from 'fs';
import * as path from 'path';
import { parseSpreadsheet } from '../src/test-cases/test-case-spreadsheet';
import {
  buildPreview,
  editDistance,
  findOverlaps,
  isOverdue,
  matchKeyFor,
  parsePlanDate,
  parseStatus,
  rowsFromSheet,
  summarizePlan,
  tidyName,
  typoCorrections,
  correctTypos,
  buildBaselines,
  slipDays,
} from '../src/project-timeline/project-timeline-rules';

// Project Timeline rules (2026-10-16), against a small sample file that
// covers every case the import must handle: 1-Jul-26 dates, extra spaces,
// typos, end before start, empty dates, overlaps (incl. non-neighbours and
// same-day touching), bad status, empty module, duplicates, unknown team.
const SAMPLE = path.resolve(__dirname, 'fixtures/project-timeline-sample.csv');
const TODAY = '2026-10-16';
const TEAMS = [
  { id: 1, name: 'Amanah', isActive: true },
  { id: 2, name: 'Vistoria', isActive: true },
];

async function samplePreview() {
  const sheet = await parseSpreadsheet(fs.readFileSync(SAMPLE).toString('base64'), 'csv');
  const { rows, missingColumns } = rowsFromSheet(sheet);
  expect(missingColumns).toEqual([]);
  return buildPreview({ rows, saved: [], teams: TEAMS, today: TODAY });
}
const phaseRow = (preview: any, phase: string) => preview.rows.find((r: any) => r.values.phase === phase);

describe('Project Timeline rules', () => {
  describe('dates', () => {
    it.each([
      ['1-Jul-26', '2026-07-01'],
      ['01-Jul-2026', '2026-07-01'],
      ['31-Dec-26', '2026-12-31'],
      ['1 July 2026', '2026-07-01'],
      ['2026-07-01', '2026-07-01'],
      ['Jul 1, 2026', '2026-07-01'],
      ['29-Feb-28', '2028-02-29'],
    ])('reads %s as %s', (raw, iso) => {
      expect(parsePlanDate(raw)).toEqual({ value: iso });
    });

    it.each(['32-Oct-26', '31-Feb-26', '29-Feb-27', '07/01/26', 'next week', '1-Jux-26', '1-Jul-1999'])('refuses %s', (raw) => {
      const result = parsePlanDate(raw);
      expect(result.value).toBeNull();
      expect(result.error).toContain(raw);
    });

    it('treats empty as no date', () => {
      expect(parsePlanDate('')).toEqual({ value: null });
      expect(parsePlanDate('   ')).toEqual({ value: null });
    });
  });

  it('reads statuses case-, space- and hyphen-blind and refuses others', () => {
    expect(parseStatus('to do').value).toBe('To Do');
    expect(parseStatus('ToDo').value).toBe('To Do');
    expect(parseStatus('IN-PROGRESS').value).toBe('In Progress');
    expect(parseStatus('on hold').value).toBe('On Hold');
    expect(parseStatus('').value).toBeNull();
    expect(parseStatus('Finished').error).toContain('To Do, In Progress, Completed, Delayed, On Hold');
  });

  it('tidies spaces and matches on module + phase ignoring case and spacing', () => {
    expect(tidyName('  Data   Migration ')).toBe('Data Migration');
    expect(matchKeyFor(' Medical  Claim', 'data MIGRATION ')).toBe(matchKeyFor('Medical Claim', 'Data Migration'));
  });

  it('reports missing columns and keeps unknown ones visible', () => {
    const result = rowsFromSheet({ headers: ['module', 'Phase', 'start_date', 'Notes'], rows: [] });
    expect(result.missingColumns).toEqual(['Team', 'Status', 'End Date']);
    expect(result.ignoredColumns).toEqual(['Notes']);
  });

  describe('overdue', () => {
    it('is To Do only, with an end date before today', () => {
      expect(isOverdue({ status: 'To Do', endDate: '2026-10-15' }, TODAY)).toBe(true);
      expect(isOverdue({ status: 'To Do', endDate: TODAY }, TODAY)).toBe(false);
      expect(isOverdue({ status: 'To Do', endDate: null }, TODAY)).toBe(false);
      for (const status of ['Delayed', 'In Progress', 'On Hold', 'Completed']) {
        expect(isOverdue({ status, endDate: '2026-01-01' }, TODAY)).toBe(false);
      }
    });
  });

  describe('overlaps', () => {
    const row = (module: string, phase: string, startDate: string, endDate: string) => ({ module, phase, startDate, endDate });

    it('does not count same-day touching', () => {
      expect(findOverlaps([row('M', 'A', '2026-07-01', '2026-07-05'), row('M', 'B', '2026-07-05', '2026-07-09')])).toEqual([]);
    });

    it('compares every pair in a module, not just neighbours', () => {
      const pairs = findOverlaps([
        row('M', 'A', '2026-07-01', '2026-07-31'),
        row('M', 'B', '2026-08-01', '2026-08-10'),
        row('M', 'C', '2026-07-25', '2026-08-05'),
      ]);
      expect(pairs.map((p) => `${p.a.phase}+${p.b.phase}`)).toEqual(['A+C', 'B+C']);
    });

    it('never compares across modules and skips rows missing a date', () => {
      expect(findOverlaps([row('M', 'A', '2026-07-01', '2026-07-31'), row('N', 'B', '2026-07-01', '2026-07-31')])).toEqual([]);
      expect(findOverlaps([row('M', 'A', '2026-07-01', '2026-07-31'), { module: 'M', phase: 'B', startDate: '2026-07-02', endDate: null }])).toEqual([]);
    });
  });

  describe('typo suggestions', () => {
    it('catches one-off misspellings and transpositions, case preserved', () => {
      const corrections = typoCorrections(['Data Migratiaon', 'Prodcution Readiness']);
      expect(correctTypos('Data Migratiaon', corrections)).toBe('Data Migration');
      expect(correctTypos('Prodcution Readiness', corrections)).toBe('Production Readiness');
      expect(editDistance('prodcution', 'production')).toBe(1);
    });

    it('leaves real words, plurals and short acronyms alone', () => {
      const corrections = typoCorrections(['Claims Testing', 'UAT', 'SRS Preparation', 'Medical Claim']);
      expect(corrections.size).toBe(0);
    });
  });

  describe('the sample file', () => {
    it('counts rows, modules, errors, overdue, Delayed and overlaps', async () => {
      const preview = await samplePreview();
      const s = preview.summary;
      expect(s.totalRows).toBe(16);
      expect(s.modules).toBe(3);
      expect(s.errorRows).toBe(5);
      expect(s.toImport).toBe(11);
      expect(s.newRows).toBe(11);
      expect(s.afterImport.rows).toBe(11);
      expect(s.afterImport.overdue).toBe(2); // Data Migration, Production Readiness
      expect(s.afterImport.delayed).toBe(1); // Go Live is Delayed but has an error, so isn't imported
      expect(s.afterImport.delayedPastEnd.map((r) => r.phase)).toEqual(['Pilot Run - Staging']);
      expect(s.afterImport.inProgressPastEnd.map((r) => r.phase)).toEqual(['Pilot Run (Staging)']);
      expect(s.afterImport.overlaps.map((p) => `${p.module}: ${p.a.phase} + ${p.b.phase}`)).toEqual([
        'Medical Claim: Data Migration + Pilot Run (Staging)',
        'Pre-Auth: Design + Integration',
        'Pre-Auth: Build + Integration',
      ]);
      expect(s.newTeams).toEqual(['Amanha']);
    });

    it('explains every skipped row', async () => {
      const preview = await samplePreview();
      const errors = (n: number) => preview.rows.find((r) => r.rowNumber === n)!.errors.join(' | ');
      expect(errors(7)).toContain('End date (Aug 1, 2026) is before the start date (Aug 10, 2026)');
      expect(errors(10)).toContain('Status "Finished" is not one of');
      expect(errors(11)).toContain('Module is empty');
      expect(errors(12)).toContain('Start date: "32-Oct-26" is not a date');
      expect(errors(14)).toContain('Same Module and Phase as row 13');
      // Skipped rows show only their errors - no "Still To Do" from the fallback status.
      expect(preview.rows.find((r) => r.rowNumber === 10)!.warnings).toEqual([]);
    });

    it('tidies spaces silently but only suggests renames', async () => {
      const preview = await samplePreview();
      const migration = preview.rows.find((r) => r.rowNumber === 3)!;
      expect(migration.values.phase).toBe('Data Migration');
      expect(migration.tidied).toEqual(['phase']);

      const typo = phaseRow(preview, 'Data Migratiaon Rehearsal');
      expect(typo.suggestions).toEqual([expect.objectContaining({ field: 'phase', to: 'Data Migration Rehearsal', reason: 'typo' })]);
      expect(phaseRow(preview, 'Prodcution Deployment').suggestions).toEqual([
        expect.objectContaining({ field: 'phase', to: 'Production Deployment', reason: 'typo' }),
      ]);
      expect(phaseRow(preview, 'Pilot Run - Staging').suggestions).toEqual([
        expect.objectContaining({ field: 'phase', to: 'Pilot Run (Staging)', reason: 'near_duplicate' }),
      ]);
      const training = preview.rows.find((r) => r.rowNumber === 13)!;
      expect(training.suggestions).toEqual([expect.objectContaining({ field: 'team', from: 'Amanha', to: 'Amanah', reason: 'existing_team' })]);
      // Nothing was renamed by the preview itself.
      expect(typo.values.phase).toBe('Data Migratiaon Rehearsal');
    });

    it('warns without blocking', async () => {
      const preview = await samplePreview();
      const warnings = (phase: string) => phaseRow(preview, phase).warnings.join(' | ');
      expect(warnings('Data Migratiaon Rehearsal')).toContain('No end date');
      expect(warnings('Training')).toContain('Completed, but the end date (Nov 30, 2026) is in the future');
      expect(warnings('Data Migration')).toContain('Still To Do, but the end date (Jul 24, 2026) has passed');
      expect(warnings('Data Migration')).toContain('Overlaps "Pilot Run (Staging)"');
      expect(warnings('Production Readiness')).not.toContain('Overlaps'); // touches Pilot Run on Jul 31
    });

    it('drops unticked rows from every count', async () => {
      const sheet = await parseSpreadsheet(fs.readFileSync(SAMPLE).toString('base64'), 'csv');
      const { rows } = rowsFromSheet(sheet);
      const preview = buildPreview({ rows: rows.map((r) => ({ ...r, include: r.rowNumber !== 3 && r.rowNumber !== 14 })), saved: [], teams: TEAMS, today: TODAY });
      expect(preview.summary.includedRows).toBe(14);
      expect(preview.summary.errorRows).toBe(4);
      expect(preview.summary.toImport).toBe(10);
      expect(preview.summary.afterImport.overdue).toBe(1);
      expect(preview.summary.afterImport.overlaps).toHaveLength(2);
    });
  });

  it('diffs a re-upload against the saved plan', () => {
    const saved = [
      { id: 10, module: 'Medical Claim', phase: 'Design', teamId: 2, status: 'Completed' as const, startDate: '2026-07-01', endDate: '2026-07-10' },
      { id: 11, module: 'Medical Claim', phase: 'Build', teamId: 2, status: 'To Do' as const, startDate: '2026-07-11', endDate: '2026-07-20' },
      { id: 12, module: 'Medical Claim', phase: 'Retired', teamId: null, status: 'To Do' as const, startDate: null, endDate: null },
    ];
    const raw = (rowNumber: number, phase: string, status: string, startDate: string, endDate: string) => ({
      rowNumber, module: 'medical claim', phase, team: 'vistoria', status, startDate, endDate,
    });
    const preview = buildPreview({
      rows: [raw(2, 'design', 'Completed', '1-Jul-26', '10-Jul-26'), raw(3, 'Build', 'In Progress', '11-Jul-26', '20-Jul-26'), raw(4, 'Test', 'To Do', '', '')],
      saved,
      teams: TEAMS,
      today: TODAY,
    });
    expect(preview.rows.map((r) => r.diff)).toEqual(['changed', 'changed', 'new']);
    // Only the spelling differs on "design" - shown as a change, not a new row.
    expect(Object.keys(preview.rows[0].changes)).toEqual(['module', 'phase']);
    expect(preview.rows[1].changes).toEqual({
      module: { old: 'Medical Claim', new: 'medical claim' },
      status: { old: 'To Do', new: 'In Progress' },
    });
    // ...and the saved spelling is offered back, never applied silently.
    expect(preview.rows[1].suggestions).toEqual([expect.objectContaining({ field: 'module', to: 'Medical Claim', reason: 'near_duplicate' })]);
    expect(preview.missing.map((m) => m.id)).toEqual([12]);
    expect(preview.summary).toEqual(expect.objectContaining({ newRows: 1, changedRows: 2, unchangedRows: 0, missingRows: 1, toImport: 3 }));
    expect(summarizePlan(saved, TODAY).overdue).toBe(1);
  });

  describe('slip baselines', () => {
    const created = (id: number, rowId: number, startDate: string | null, endDate: string | null, source = 'import') =>
      ({ id, action: 'created' as const, rowId, at: `t${id}`, by: 'pm@x', details: { source, values: { startDate, endDate } } });
    const moved = (id: number, rowId: number, changes: any) => ({ id, action: 'updated' as const, rowId, at: `t${id}`, by: 'pm@x', details: { changes } });
    const reset = (id: number, snapshot: any[]) => ({ id, action: 'reset' as const, rowId: null, at: `t${id}`, by: 'pm@x', details: { reason: 'r', snapshot } });

    it('keeps the first dates as the baseline and counts end-date moves', () => {
      const b = buildBaselines([1], [
        created(1, 1, '2026-07-01', '2026-07-10'),
        moved(2, 1, { endDate: { old: '2026-07-10', new: '2026-07-20' } }),
        moved(3, 1, { status: { old: 'To Do', new: 'In Progress' } }),
        moved(4, 1, { endDate: { old: '2026-07-20', new: '2026-07-15' } }),
      ]).get(1)!;
      expect(b).toEqual(expect.objectContaining({ baselineStart: '2026-07-01', baselineEnd: '2026-07-10', source: 'import', endMoves: 2 }));
      expect(b.lastMove).toEqual({ at: 't4', by: 'pm@x', from: '2026-07-20', to: '2026-07-15' });
      expect(slipDays(b.baselineEnd, '2026-07-15')).toBe(5);
      expect(slipDays(b.baselineEnd, '2026-07-05')).toBe(-5);
      expect(slipDays(null, '2026-07-05')).toBeNull();
    });

    it('takes the first date given to an empty phase as its baseline - not a move', () => {
      const b = buildBaselines([1], [created(1, 1, null, null, 'edit'), moved(2, 1, { endDate: { old: null, new: '2026-08-01' }, startDate: { old: null, new: '2026-07-01' } })]).get(1)!;
      expect(b).toEqual(expect.objectContaining({ baselineStart: '2026-07-01', baselineEnd: '2026-08-01', source: 'added', endMoves: 0, lastMove: null }));
    });

    it('a reset re-baselines the rows it snapshotted; later rows and moves count from there', () => {
      const m = buildBaselines([1, 2, 3], [
        created(1, 1, '2026-07-01', '2026-07-10'),
        created(2, 2, '2026-07-11', '2026-07-20'),
        moved(3, 1, { endDate: { old: '2026-07-10', new: '2026-07-30' } }),
        reset(4, [{ id: 1, startDate: '2026-07-01', endDate: '2026-07-30' }, { id: 2, startDate: '2026-07-11', endDate: '2026-07-20' }, { id: 99, startDate: null, endDate: null }]),
        moved(5, 2, { endDate: { old: '2026-07-20', new: '2026-07-25' } }),
        created(6, 3, '2026-08-01', '2026-08-05', 'edit'),
      ]);
      expect(m.get(1)).toEqual(expect.objectContaining({ baselineEnd: '2026-07-30', source: 'reset', endMoves: 0, setAt: 't4' }));
      expect(m.get(2)).toEqual(expect.objectContaining({ baselineEnd: '2026-07-20', source: 'reset', endMoves: 1 }));
      expect(m.get(3)).toEqual(expect.objectContaining({ baselineEnd: '2026-08-05', source: 'added' }));
      expect(m.has(99)).toBe(false); // deleted since - ignored
    });
  });
});
