import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dmy, weekLabel, valueText, detailText, cellText, evidenceGroups, visibleItems } from '../weeklyFigures.js';

test('dates are DD-MM-YYYY; a week is Monday to Sunday', () => {
  assert.equal(dmy('2026-11-16'), '16-11-2026');
  assert.equal(dmy(null), '—');
  assert.equal(weekLabel('2026-11-16'), '16-11-2026 to 22-11-2026');
  assert.equal(weekLabel('2026-12-28'), '28-12-2026 to 03-01-2027');
});

test('cells: raw value, counts, "fewer than N items", n/a, C6 off', () => {
  const pct = { metric: 'C5', value: 57.69, numerator: 15, denominator: 26, sample: 26, state: 'ok' };
  assert.equal(valueText(pct, 'percent'), '57.7%');
  assert.equal(detailText(pct, 5), '15/26');
  assert.equal(cellText(pct, 'percent', 5), '57.7% (15/26)');
  const small = { metric: 'Q1', value: 100, numerator: 1, denominator: 1, sample: 1, state: 'small' };
  assert.equal(cellText(small, 'percent', 5), '100% (1/1 · fewer than 5 items)');
  assert.equal(cellText({ metric: 'C4', value: null, numerator: null, denominator: null, sample: 0, state: 'na' }, 'percent', 5), 'n/a');
  assert.equal(cellText({ metric: 'C6', value: null, numerator: null, denominator: null, sample: 0, state: 'off' }, 'percent', 4), 'C6 not switched on');
  // C2 is a count of working days; 1 is singular.
  assert.equal(valueText({ metric: 'C2', value: 3 }, 'count'), '3 working days');
  assert.equal(valueText({ metric: 'C2', value: 1 }, 'count'), '1 working day');
  // The table cell is compact; the header says what the unit is.
  assert.equal(valueText({ metric: 'C2', value: 3 }, 'count', { compact: true }), '3 days');
  assert.equal(valueText({ metric: 'C1', value: 0, medianWorkingHours: 21.53 }, 'percent', { compact: true }), '21.5 h median');
  assert.equal(valueText({ metric: 'O3', value: 2.5 }, 'rate'), '2.5 per 10 tasks due');
});

test('C1: median working hours and % within the target', () => {
  const c1 = { metric: 'C1', value: 0, numerator: 0, denominator: 2, sample: 2, state: 'small', medianWorkingHours: 21.53, targetWorkingHours: 4 };
  assert.equal(cellText(c1, 'percent', 5), 'median 21.5 h (0% in 4 h · 0/2 · fewer than 5 items)');
});

test('evidence: counted and excluded tasks with titles, plain text', () => {
  const titles = { 274: 'Payment retry', 300: 'Quiz export' };
  const d1 = evidenceGroups('D1', { countedTaskIds: [274, 300], late: [{ taskId: 300, due: '2026-11-17', submitted: '2026-11-19', workingDaysLate: 2 }], leftOutExternal: [301] }, titles);
  assert.deepEqual(d1, [
    { label: 'Counted', items: ['#274 Payment retry', '#300 Quiz export'] },
    { label: 'Late', items: ['#300 Quiz export - due 17-11-2026, submitted 19-11-2026, 2 working days late'] },
    { label: 'Left out (external blocker)', items: ['#301'] },
  ]);
  const c2 = evidenceGroups('C2', { blockedTasks: [{ taskId: 274, workingDays: 3 }], overdue: [{ ticketId: 111, taskId: 274, overdueWorkingDays: 1 }], blockerFlags: 0 }, titles);
  assert.deepEqual(c2, [
    { label: 'Tasks kept waiting', items: ['#274 Payment retry - 3 working days'] },
    { label: 'Overdue dependency tickets', items: ['Ticket #111 on #274 Payment retry - 1 working day overdue'] },
  ]);
});

test('evidence: stand-ups and weekly report times are DD-MM-YYYY, 24-hour EAT', () => {
  const c6 = evidenceGroups('C6', { meetings: [{ startAt: '2026-11-17T07:00:00.000Z', outcome: 'late', excused: false }, { startAt: '2026-11-18T07:00:00.000Z', outcome: 'absent', excused: true, excuseReason: 'Sick' }] });
  assert.deepEqual(c6, [{ label: 'Stand-ups', items: ['17-11-2026, 10:00 EAT - late', '18-11-2026, 10:00 EAT - absent (excused: Sick, not counted)'] }]);
  const c3 = evidenceGroups('C3', { late: [], missing: ['2026-11-16'], weeks: [{ week: '2026-11-16', deadline: '2026-11-19T12:30:00.000Z', onTime: false, submitted: false }] });
  assert.deepEqual(c3, [{ label: 'Weekly report', items: ['Week of 16-11-2026 - deadline 19-11-2026, 15:30 EAT - not submitted'] }]);
});

test('evidence: unknown detail keys are still shown, empty ones are not', () => {
  const g = evidenceGroups('Q2', { failed: [], countedTaskIds: [], somethingNew: 4, otherTaskIds: [5] });
  assert.deepEqual(g, [
    { label: 'Something New', items: ['4'] },
    { label: 'Other Task Ids', items: ['#5'] },
  ]);
});

test('long evidence lists: first 5, then "Show all (N)"', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `#${i + 1}`);
  assert.deepEqual(visibleItems(twelve, false), { shown: twelve.slice(0, 5), collapsible: true, total: 12 });
  assert.deepEqual(visibleItems(twelve, true), { shown: twelve, collapsible: true, total: 12 });
  const five = twelve.slice(0, 5);
  assert.deepEqual(visibleItems(five, false), { shown: five, collapsible: false, total: 5 });
  assert.deepEqual(visibleItems(undefined, false), { shown: [], collapsible: false, total: 0 });
});
