import { workingMinutesBetween, workingDaysCalendar, daysBetween, PersonCalendar } from '../src/work-calendar/work-calendar';
import { calendarProblem, isValidTimeZone, PERFORMANCE_TRACKING_DEFAULTS } from '../src/performance-tracking/performance-tracking';
import { computeTrackingMetrics } from '../src/performance-tracking/metrics/tracking-metrics';

// Performance Tracking B4 (2026-10-30): per-person calendar (default EAT,
// 07:30-15:30, Sat/Sun off), leave and country holidays; C1 response time
// in the person's own working hours; working-day metrics per person.
const eat = (extra: Partial<PersonCalendar> = {}): PersonCalendar => ({
  timeZone: 'Africa/Addis_Ababa',
  workStart: '07:30',
  workEnd: '15:30',
  weekendDays: [0, 6],
  country: null,
  daysOff: new Set(),
  ...extra,
});
const at = (iso: string) => new Date(iso);

describe('Per-person working calendar (B4)', () => {
  it('counts only core hours on working days, in the person own zone', () => {
    // Fri 13 Nov 2026 14:30 EAT (11:30Z) -> Mon 16 Nov 08:30 EAT (05:30Z):
    // 1h on Friday + 1h on Monday; the weekend is skipped.
    expect(workingMinutesBetween(at('2026-11-13T11:30:00Z'), at('2026-11-16T05:30:00Z'), eat())).toBe(120);
    // Before opening and after closing do not count.
    expect(workingMinutesBetween(at('2026-11-16T02:00:00Z'), at('2026-11-16T04:30:00Z'), eat())).toBe(0);
    expect(workingMinutesBetween(at('2026-11-16T04:30:00Z'), at('2026-11-16T12:30:00Z'), eat())).toBe(480);
    expect(workingMinutesBetween(at('2026-11-16T12:30:00Z'), at('2026-11-16T04:30:00Z'), eat())).toBe(0);
  });

  it('leave and holidays are not working time', () => {
    const onLeave = eat({ daysOff: new Set(['2026-11-16']) });
    expect(workingMinutesBetween(at('2026-11-13T11:30:00Z'), at('2026-11-17T05:30:00Z'), onLeave)).toBe(120);
  });

  it('a person in India works their own hours in IST', () => {
    const india = eat({ timeZone: 'Asia/Kolkata', workStart: '09:30', workEnd: '18:00' });
    // Mon 16 Nov 09:30-18:00 IST = 04:00Z-12:30Z.
    expect(workingMinutesBetween(at('2026-11-16T03:00:00Z'), at('2026-11-16T13:00:00Z'), india)).toBe(510);
  });

  it('days between, and the working-days view keeps the team zone', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    const cal = workingDaysCalendar(eat({ timeZone: 'Asia/Kolkata', weekendDays: [0], daysOff: new Set(['2026-11-16']) }), 'Africa/Addis_Ababa');
    expect(cal).toMatchObject({ timeZone: 'Africa/Addis_Ababa', weekendDays: [0] });
    expect(cal.holidays.has('2026-11-16')).toBe(true);
  });

  it('calendar checks', () => {
    expect(isValidTimeZone('Africa/Addis_Ababa')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(calendarProblem({ timeZone: 'Africa/Addis_Ababa', workStart: '07:30', workEnd: '15:30', weekendDays: [0, 6] })).toBeNull();
    expect(calendarProblem({ timeZone: 'Africa/Addis_Ababa', workStart: '15:30', workEnd: '07:30', weekendDays: [0, 6] })).toMatch(/end after/);
    expect(calendarProblem({ timeZone: 'Africa/Addis_Ababa', workStart: '7:30', workEnd: '15:30', weekendDays: [0, 6] })).toMatch(/HH:MM/);
    expect(calendarProblem({ timeZone: 'Africa/Addis_Ababa', workStart: '07:30', workEnd: '15:30', weekendDays: [0, 0] })).toMatch(/distinct/);
    expect(calendarProblem({ timeZone: 'Africa/Addis_Ababa', workStart: '07:30', workEnd: '15:30', weekendDays: [0, 1, 2, 3, 4, 5, 6] })).toMatch(/working day/);
  });
});

describe('C1 and per-person working days in the metrics (B4)', () => {
  const base = {
    snapshotDate: '2026-11-20',
    now: at('2026-11-20T23:30:00Z'),
    trackingSince: at('2026-11-02T06:00:00Z'),
    windowDays: 28,
    minSample: 1,
    calendar: { timeZone: 'Africa/Addis_Ababa', weekendDays: [0, 6], holidays: new Set<string>() },
    thresholds: { ...PERFORMANCE_TRACKING_DEFAULTS },
    people: [10],
    tasks: [
      { id: 1, status: 'Pass', assigneeUserId: 10, createdByUserId: 99, dueDate: '2026-11-12', isDefect: false, taskType: null, requirementId: null, clientImpact: null, improvementDecision: null, improvementDecidedAt: null },
    ],
    rounds: [{ taskId: 1, submittedByUserId: 10, submittedAt: at('2026-11-16T08:00:00Z'), status: 'approved', reviewType: 'qa', reviewedAt: at('2026-11-17T08:00:00Z'), dependencyExempt: null }],
    commitmentEvents: [],
    flags: [],
    tickets: [
      // Filed Fri 14:30 EAT, resolved Mon 08:30 EAT: 2 working hours.
      { id: 7, parentTaskId: 1, ownerUserId: 10, createdByUserId: 99, createdAt: at('2026-11-13T11:30:00Z'), overdueAt: null, status: 'resolved', resolvedAt: at('2026-11-16T05:30:00Z') },
      // Filed Mon 08:00 EAT, answered on the task 10:00 EAT (2h) - before it was resolved.
      { id: 8, parentTaskId: 1, ownerUserId: 10, createdByUserId: 99, createdAt: at('2026-11-16T05:00:00Z'), overdueAt: null, status: 'resolved', resolvedAt: at('2026-11-18T05:00:00Z') },
      // Their own ticket - not a request to them.
      { id: 9, parentTaskId: 1, ownerUserId: 10, createdByUserId: 10, createdAt: at('2026-11-16T05:00:00Z'), overdueAt: null, status: 'open', resolvedAt: null },
    ],
    reopens: [],
    chases: [],
    notes: [],
    statusEvents: [],
    requests: [
      { source: 'dependency' as const, dependencyTicketId: 8, requestedOfUserId: 10, requestedAt: at('2026-11-16T05:00:00Z'), respondedAt: at('2026-11-16T07:00:00Z') },
      // Asked Tue 08:00 EAT, answered Wed 15:00 EAT: 7.5 + 7.5 = 15h - late.
      { source: 'request' as const, dependencyTicketId: null, requestedOfUserId: 10, requestedAt: at('2026-11-17T05:00:00Z'), respondedAt: at('2026-11-18T12:00:00Z') },
      // Asked Fri 20 Nov 15:00 EAT, unanswered: 30 min so far - still waiting, not counted.
      { source: 'request' as const, dependencyTicketId: null, requestedOfUserId: 10, requestedAt: at('2026-11-20T12:00:00Z'), respondedAt: null },
    ],
    onTimeItems: new Map(),
    chargedChanges: new Map(),
    changeSample: new Map(),
    hoursFor: () => eat(),
    workingDaysFor: () => base.calendar,
  };
  const c1 = (r: ReturnType<typeof computeTrackingMetrics>) => r.rows.find((x) => x.metric === 'C1')!;

  it('C1: share answered within 4 working hours; unanswered ones only once past the target', () => {
    const r = c1(computeTrackingMetrics(base as any));
    expect(r).toMatchObject({ value: 66.67, numerator: 2, denominator: 3 });
    expect(r.details).toMatchObject({ targetWorkingHours: 4, medianWorkingHours: 2, unanswered: 0, waiting: 1 });
  });

  it('C1 follows the request sources setting', () => {
    const only = c1(computeTrackingMetrics({ ...base, thresholds: { ...base.thresholds, requestSources: ['marked_request'] } } as any));
    expect(only).toMatchObject({ numerator: 0, denominator: 1 });
  });

  it('a leave day is not a working day for that person: D1 days late shrink', () => {
    const plain = computeTrackingMetrics(base as any).rows.find((x) => x.metric === 'D1')!;
    expect((plain.details as any).late[0].workingDaysLate).toBe(2);
    const onLeave = computeTrackingMetrics({ ...base, workingDaysFor: () => ({ ...base.calendar, holidays: new Set(['2026-11-13']) }) } as any).rows.find((x) => x.metric === 'D1')!;
    expect((onLeave.details as any).late[0].workingDaysLate).toBe(1);
  });
});
