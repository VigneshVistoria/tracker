import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateDMY, formatDateTimeEAT } from '../formatDate.js';

test('formatDateDMY: DD-MM-YYYY, zero-padded, local date', () => {
  assert.equal(formatDateDMY(new Date(2026, 10, 20, 7, 49)), '20-11-2026');
  assert.equal(formatDateDMY(new Date(2026, 0, 5)), '05-01-2026');
  // A plain date string is that calendar day, not shifted by the time zone.
  assert.equal(formatDateDMY('2026-11-20'), '20-11-2026');
});

test('formatDateDMY: empty or invalid -> dash', () => {
  assert.equal(formatDateDMY(null), '—');
  assert.equal(formatDateDMY(''), '—');
  assert.equal(formatDateDMY('not a date'), '—');
});

test('formatDateDMY on the task header due date (effectiveDueDate adds PM-wait working days)', async () => {
  const { effectiveDueDate } = await import('../developerTaskStats.js');
  assert.equal(formatDateDMY(effectiveDueDate({ dueDate: '2026-11-20' })), '20-11-2026');
  // Fri 20 Nov + 1 working day = Mon 23 Nov.
  assert.equal(formatDateDMY(effectiveDueDate({ dueDate: '2026-11-20', pmWaitWorkingDays: 1 })), '23-11-2026');
});

test('formatDateTimeEAT: DD-MM-YYYY, 24-hour East Africa Time, any viewer zone', () => {
  assert.equal(formatDateTimeEAT('2026-11-20T07:43:03.200Z'), '20-11-2026, 10:43 EAT');
  assert.equal(formatDateTimeEAT('2026-11-20T18:45:00Z'), '20-11-2026, 21:45 EAT');
  // Crosses midnight in EAT: 22:30 UTC is 01:30 the next day.
  assert.equal(formatDateTimeEAT('2026-11-20T22:30:00Z'), '21-11-2026, 01:30 EAT');
  assert.equal(formatDateTimeEAT(new Date(Date.UTC(2026, 0, 5, 0, 5))), '05-01-2026, 03:05 EAT');
  assert.equal(formatDateTimeEAT(null), '—');
  assert.equal(formatDateTimeEAT('garbage'), '—');
});
