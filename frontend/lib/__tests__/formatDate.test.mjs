import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateDMY } from '../formatDate.js';

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
