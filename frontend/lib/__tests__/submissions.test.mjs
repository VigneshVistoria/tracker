import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSubmissions, roundOutcome, labelArtifacts } from '../submissions.js';

const round = (n, extra) => ({ id: n, roundNumber: n, submittedByUserId: 7, submittedAt: `2026-11-0${n}T10:00:00Z`, reviewType: 'qa', resolution: `note ${n}`, artifacts: [], ...extra });

test('each resubmission is its own submission, numbered in order', () => {
  const g = groupSubmissions([round(2, { status: 'pending' }), round(1, { status: 'rejected', testFailedReason: 'Crash' })]);
  assert.deepEqual(g.map((s) => [s.number, s.outcome.text]), [[1, 'Failed: Crash'], [2, 'Awaiting review']]);
});

test('PM review then the QA round it created is one submission', () => {
  const g = groupSubmissions([round(1, { reviewType: 'pm', status: 'approved' }), round(2, { status: 'approved', resolution: 'note 1' })]);
  assert.equal(g.length, 1);
  assert.equal(g[0].rounds.length, 2);
  assert.equal(g[0].outcome.text, 'Passed');
  assert.equal(g[0].resolution, 'note 1');
});

test('a reverted decision re-opens the same submission', () => {
  const t = '2026-11-01T10:00:00Z';
  const g = groupSubmissions([
    round(1, { status: 'reverted', revertedDecision: 'rejected', submittedAt: t }),
    round(2, { status: 'pending', submittedAt: t }),
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].rounds[0].status, 'reverted');
  assert.equal(roundOutcome(g[0].rounds[0]).text, 'Failed, then reverted');
});

test('not ready shows its reason', () => {
  assert.equal(roundOutcome({ status: 'not_ready', notReadyReason: 'Build missing' }).text, 'Not ready: Build missing');
  assert.equal(roundOutcome({ status: 'not_ready', notReadyReason: 'Build missing' }).tone, 'error');
});

test('artifact links get readable, numbered labels', () => {
  const l = labelArtifacts([{ type: 'Pull Request Link' }, { type: 'APK Build' }, { type: 'Pull Request Link' }, { type: 'Something New' }]);
  assert.deepEqual(l.map((a) => a.label), ['Pull request 1', 'Build / APK', 'Pull request 2', 'Something New']);
});
