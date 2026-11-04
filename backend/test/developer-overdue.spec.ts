import { isDeveloperOverdue, isPastEffectiveDue, reviewWaitWorkingDays, developerDueDate } from '../src/tasks/pm-review';

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

describe('review wait (KPI, 2026-11-04)', () => {
  // Mon 2026-10-05 .. : working days only.
  const r = (reviewType: string, status: string, submittedAt: string, reviewedAt: string | null) => ({ reviewType, status, submittedAt: new Date(submittedAt), reviewedAt: reviewedAt ? new Date(reviewedAt) : null });

  it('counts QA and peer rounds from submission to decision, in working days', () => {
    const rounds = [
      r('qa', 'rejected', '2026-10-05T09:00:00Z', '2026-10-07T09:00:00Z'), // Mon -> Wed = 2
      r('peer', 'approved', '2026-10-09T09:00:00Z', '2026-10-12T09:00:00Z'), // Fri -> Mon = 1
    ];
    expect(reviewWaitWorkingDays(rounds)).toBe(3);
    expect(reviewWaitWorkingDays(rounds, rounds[1])).toBe(2);
  });

  it('never counts PM rounds, not-ready returns, reverted or undecided rounds', () => {
    expect(reviewWaitWorkingDays([
      r('pm', 'approved', '2026-10-05T09:00:00Z', '2026-10-09T09:00:00Z'),
      r('qa', 'not_ready', '2026-10-05T09:00:00Z', '2026-10-09T09:00:00Z'),
      r('qa', 'reverted', '2026-10-05T09:00:00Z', '2026-10-09T09:00:00Z'),
      r('qa', 'pending', '2026-10-05T09:00:00Z', null),
    ])).toBe(0);
  });

  it('moves the due date by the review wait, and the overdue check with it', () => {
    const t = { status: 'Failed', dueDate: '2026-10-07', pmWaitWorkingDays: 0 };
    expect(developerDueDate(t, 2)).toBe('2026-10-09');
    expect(isDeveloperOverdue(t, '2026-10-09', 2)).toBe(false);
    expect(isDeveloperOverdue(t, '2026-10-12', 2)).toBe(true);
    expect(isDeveloperOverdue(t, '2026-10-09', 0)).toBe(true);
  });
});
