import { percentFor, rowProgress, ticketMismatches, ticketsByRow } from '../src/project-timeline/project-timeline-tickets';

// Project Timeline Stage C (2026-10-16): progress from tickets.
describe('Project Timeline ticket rules', () => {
  const t = (id: number, status: string, moduleId: number | null = 1, phaseId: number | null = null) => ({ id, title: `T${id}`, status, moduleId, phaseId });
  const PCT = { Development: 0, Feedback: 50, Pass: 100, Hold: 0, Closed: 0, Junk: 0 };

  it('a module link takes every ticket in the module; a phase narrows it; single tickets add on; each ticket once', () => {
    const tickets = [t(1, 'Development', 1, 10), t(2, 'Pass', 1, 11), t(3, 'Feedback', 2, 20), t(4, 'Pass', 1, null)];
    const m = ticketsByRow(
      [
        { rowId: 100, moduleId: 1, phaseId: null, taskId: null },
        { rowId: 100, moduleId: null, phaseId: null, taskId: 2 },
        { rowId: 200, moduleId: 1, phaseId: 10, taskId: null },
        { rowId: 200, moduleId: null, phaseId: null, taskId: 3 },
        { rowId: 300, moduleId: null, phaseId: null, taskId: 999 },
      ],
      tickets,
    );
    expect(m.get(100)!.map((x) => x.id)).toEqual([1, 2, 4]);
    expect(m.get(200)!.map((x) => x.id)).toEqual([1, 3]);
    expect(m.get(300)).toEqual([]);
  });

  it('progress is the average Task Status Config %, Junk and Closed left out; done = 100%; Hold counts as open', () => {
    const p = rowProgress([t(1, 'Development'), t(2, 'Feedback'), t(3, 'Pass'), t(4, 'Hold'), t(5, 'Closed'), t(6, 'Junk')], PCT);
    expect(p).toEqual({ counted: 4, done: 1, open: 3, hold: 1, moving: 2, leftOut: 2, percent: 38 });
    expect(rowProgress([t(5, 'Closed')], PCT).percent).toBeNull();
  });

  it('a status missing from the config falls back to the app default', () => {
    expect(percentFor('Pass', {})).toBe(100);
    expect(percentFor('Feedback', { Feedback: 70 })).toBe(70);
    expect(percentFor('Nonsense', {})).toBe(0);
  });

  describe('mismatches', () => {
    const p = (statuses: string[]) => rowProgress(statuses.map((s, i) => t(i + 1, s)), PCT);
    it('Completed with open tickets; To Do with tickets already moving; In Progress/Delayed with everything done', () => {
      expect(ticketMismatches('Completed', p(['Pass', 'Development']), 1).map((m) => m.text)).toEqual(['Completed, but 1 ticket still open']);
      expect(ticketMismatches('To Do', p(['Feedback', 'Pass', 'Development']), 1).map((m) => m.text)).toEqual(['Still To Do, but 2 tickets already in review or done']);
      expect(ticketMismatches('In Progress', p(['Pass', 'Pass']), 1).map((m) => m.code)).toEqual(['all_done']);
      expect(ticketMismatches('Delayed', p(['Pass']), 1).map((m) => m.code)).toEqual(['all_done']);
    });
    it('nothing to flag when they agree, or when the phase has no links; linked-but-empty says so', () => {
      expect(ticketMismatches('Completed', p(['Pass', 'Closed']), 1)).toEqual([]);
      expect(ticketMismatches('To Do', p(['Development', 'Hold']), 1)).toEqual([]);
      expect(ticketMismatches('In Progress', p(['Development', 'Pass']), 1)).toEqual([]);
      expect(ticketMismatches('Completed', p(['Development']), 0)).toEqual([]);
      expect(ticketMismatches('Completed', p([]), 2).map((m) => m.code)).toEqual(['no_match']);
    });
  });
});
