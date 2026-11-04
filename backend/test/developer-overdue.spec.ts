import { isDeveloperOverdue, isPastEffectiveDue } from '../src/tasks/pm-review';

// User feedback 2026-11-04: work waiting for QA / a peer is not the
// developer's overdue work in lists and cards. KPI and Non-Compliance
// keep isPastEffectiveDue, which must not change.
describe('isDeveloperOverdue', () => {
  const today = '2026-11-04';
  const task = (status: string, dueDate: string | null = '2026-10-30') => ({ status, dueDate, pmWaitWorkingDays: 0 });

  it('is not overdue while waiting for QA or a peer reviewer', () => {
    for (const s of ['Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review']) {
      expect(isDeveloperOverdue(task(s), today)).toBe(false);
    }
  });

  it('is overdue again once sent back, counted from the original due date', () => {
    for (const s of ['Development', 'Failed', 'PM Feedback', 'Not Ready for Testing']) {
      expect(isDeveloperOverdue(task(s), today)).toBe(true);
    }
  });

  it('keeps the existing PM-wait and not-yet-due rules', () => {
    expect(isDeveloperOverdue(task('Pending PM Review'), today)).toBe(false);
    expect(isDeveloperOverdue(task('Development', '2026-11-04'), today)).toBe(false);
    expect(isDeveloperOverdue(task('Development', null), today)).toBe(false);
    // 2026-10-30 + 3 PM-wait working days = 2026-11-04: not past yet.
    expect(isDeveloperOverdue({ status: 'Failed', dueDate: '2026-10-30', pmWaitWorkingDays: 3 }, today)).toBe(false);
  });

  it('leaves the KPI / Non-Compliance rule unchanged (QA wait still counts there)', () => {
    expect(isPastEffectiveDue(task('Feedback'), today)).toBe(true);
    expect(isPastEffectiveDue(task('Re-Peer-Review'), today)).toBe(true);
  });
});
