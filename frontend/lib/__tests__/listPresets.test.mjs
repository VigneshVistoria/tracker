import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateOnly, readCardParam, readPassedParams, passedPeriodRange, buildHref, syncedQuery, sameQuery,
  readIssueStatusParam, issueMatchesStatus,
} from '../listPresets.js';

test('parseDateOnly accepts real YYYY-MM-DD dates only', () => {
  assert.equal(parseDateOnly('2026-10-31'), '2026-10-31');
  assert.equal(parseDateOnly('2024-02-29'), '2024-02-29');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-01', 'yesterday', '', undefined, null, 20261031]) {
    assert.equal(parseDateOnly(bad), null, String(bad));
  }
});

test('readCardParam only returns a card the page knows', () => {
  const keys = ['total', 'overdue'];
  assert.equal(readCardParam({ card: 'overdue' }, keys), 'overdue');
  assert.equal(readCardParam({ card: ['overdue', 'total'] }, keys), 'overdue');
  assert.equal(readCardParam({ card: 'nope' }, keys), null);
  assert.equal(readCardParam({}, keys), null);
  assert.equal(readCardParam(undefined, keys), null);
});

test('readPassedParams keeps valid dates and drops invalid ones', () => {
  assert.deepEqual(readPassedParams({ passedFrom: '2026-10-01', passedTo: '2026-10-31' }), { passedFrom: '2026-10-01', passedTo: '2026-10-31' });
  assert.deepEqual(readPassedParams({ passedFrom: '2026-10-01', passedTo: 'x' }), { passedFrom: '2026-10-01', passedTo: '' });
  assert.equal(readPassedParams({ passedFrom: 'x' }), null);
  assert.equal(readPassedParams({}), null);
});

test('passedPeriodRange: this week is Monday to Sunday, months are whole months (UTC)', () => {
  const wed = new Date('2026-11-04T10:00:00Z');
  assert.deepEqual(passedPeriodRange('thisWeek', wed), { passedFrom: '2026-11-02', passedTo: '2026-11-08' });
  const sun = new Date('2026-11-08T23:00:00Z');
  assert.deepEqual(passedPeriodRange('thisWeek', sun), { passedFrom: '2026-11-02', passedTo: '2026-11-08' });
  assert.deepEqual(passedPeriodRange('thisMonth', wed), { passedFrom: '2026-11-01', passedTo: '2026-11-30' });
  assert.deepEqual(passedPeriodRange('lastMonth', wed), { passedFrom: '2026-10-01', passedTo: '2026-10-31' });
  const jan = new Date('2027-01-15T00:00:00Z');
  assert.deepEqual(passedPeriodRange('lastMonth', jan), { passedFrom: '2026-12-01', passedTo: '2026-12-31' });
  const feb = new Date('2028-02-10T00:00:00Z');
  assert.deepEqual(passedPeriodRange('thisMonth', feb), { passedFrom: '2028-02-01', passedTo: '2028-02-29' });
  // Unknown key falls back to this month.
  assert.deepEqual(passedPeriodRange('bogus', wed), passedPeriodRange('thisMonth', wed));
});

test('buildHref leaves out empty values and encodes the rest', () => {
  assert.equal(buildHref('/tasks/team', { card: 'overdue' }), '/tasks/team?card=overdue');
  assert.equal(buildHref('/tasks/team', { card: '', x: null, y: undefined }), '/tasks/team');
  assert.equal(buildHref('/issues', { status: 'Ready for Production' }), '/issues?status=Ready+for+Production');
});

test('syncedQuery replaces only the preset keys and sameQuery compares values', () => {
  const q = { card: 'overdue', passedFrom: '2026-10-01', other: 'keep' };
  assert.deepEqual(syncedQuery(q, ['card', 'passedFrom', 'passedTo'], { card: 'total', passedFrom: '', passedTo: '' }), { other: 'keep', card: 'total' });
  assert.deepEqual(syncedQuery(q, ['card'], { card: null }), { passedFrom: '2026-10-01', other: 'keep' });
  assert.equal(sameQuery({ a: '1' }, { a: '1' }), true);
  assert.equal(sameQuery({ a: '1' }, { a: '1', b: '2' }), false);
  assert.equal(sameQuery({}, {}), true);
});

test('issue status param: single status or a named group', () => {
  const options = ['Backlog', 'In Progress', 'In Review', 'QA Testing', 'QA Failed', 'Ready for Production'];
  assert.equal(readIssueStatusParam({ status: 'Backlog' }, options), 'Backlog');
  assert.equal(readIssueStatusParam({ status: 'in-progress' }, options), 'in-progress');
  assert.equal(readIssueStatusParam({ status: 'Closed' }, options), null);
  assert.equal(issueMatchesStatus({ status: 'QA Failed' }, 'in-progress'), true);
  assert.equal(issueMatchesStatus({ status: 'Backlog' }, 'in-progress'), false);
  assert.equal(issueMatchesStatus({ status: 'Backlog' }, 'Backlog'), true);
  assert.equal(issueMatchesStatus({ status: 'Backlog' }, 'All'), true);
});
