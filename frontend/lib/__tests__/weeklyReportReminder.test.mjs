import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlineText, weeklyReportReminder } from '../weeklyReportReminder.js';

const page = (over = {}) => ({
  week: '2026-11-23',
  timeZone: 'Africa/Addis_Ababa',
  // Thursday 26-11-2026 15:30 EAT = 12:30 UTC.
  deadlineAt: '2026-11-26T12:30:00.000Z',
  deadlinePassed: false,
  canSubmit: true,
  mine: null,
  ...over,
});

test('deadline as "Thursday 15:30 EAT", whatever the browser zone', () => {
  assert.equal(deadlineText('2026-11-26T12:30:00.000Z'), 'Thursday 15:30 EAT');
  assert.equal(deadlineText('2026-11-27T14:00:00.000Z', 'Africa/Addis_Ababa'), 'Friday 17:00 EAT');
  assert.equal(deadlineText('nonsense'), null);
});

test('shown until the report is submitted', () => {
  assert.deepEqual(weeklyReportReminder(page()), { overdue: false, text: 'Weekly report due Thursday 15:30 EAT' });
  assert.equal(weeklyReportReminder(page({ mine: { submittedAt: '2026-11-25T08:00:00.000Z' } })), null);
});

test('after the deadline it still shows, as overdue', () => {
  assert.deepEqual(weeklyReportReminder(page({ deadlinePassed: true })), { overdue: true, text: 'Weekly report overdue - it was due Thursday 15:30 EAT' });
});

test('nothing for people who do not file one, or with no page', () => {
  assert.equal(weeklyReportReminder(page({ canSubmit: false })), null);
  assert.equal(weeklyReportReminder(null), null);
});
