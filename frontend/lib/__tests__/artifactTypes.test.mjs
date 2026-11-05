import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactTypeGroups, DEV_ARTIFACT_TYPES, ALL_ARTIFACT_TYPES, latestWork } from '../artifactTypes.js';

test('a Designer assignee gets the design types first, build types still below', () => {
  const [design, other] = artifactTypeGroups('designer');
  assert.deepEqual(design.types.slice(0, 3), ['Design file', 'Prototype', 'Design spec']);
  assert.ok(other.types.includes('APK Build') && other.types.includes('Pull Request Link'));
  const all = [...design.types, ...other.types];
  assert.equal(new Set(all).size, ALL_ARTIFACT_TYPES.length, 'every type exactly once');
});

test('developers, DevOps and unknown roles keep the existing list', () => {
  for (const role of ['developer', 'devops', undefined]) {
    assert.deepEqual(artifactTypeGroups(role), [{ label: null, types: DEV_ARTIFACT_TYPES }]);
  }
});

const round = (id, submittedAt, artifacts, extra = {}) => ({ id, reviewType: 'qa', status: 'rejected', submittedAt, submittedByUserId: 5, resolution: 'x', artifacts, ...extra });

test('latest work: the newest submission, design links for a Designer, build/PR links for a developer', () => {
  const reviews = [
    round(1, '2026-11-01T10:00:00Z', [{ id: 1, type: 'Prototype', url: 'https://p/1' }]),
    round(2, '2026-11-03T10:00:00Z', [
      { id: 2, type: 'Prototype', url: 'https://p/2' },
      { id: 3, type: 'Screenshot', url: 'https://s/2' },
      { id: 4, type: 'Pull Request Link', url: 'https://pr/2' },
    ], { status: 'pending' }),
  ];
  assert.deepEqual(latestWork(reviews, 'designer').artifacts.map((a) => a.url), ['https://p/2']);
  assert.deepEqual(latestWork(reviews, 'developer').artifacts.map((a) => a.url), ['https://pr/2']);
  assert.equal(latestWork(reviews, 'designer').number, 2);
});

test('latest work: all links when none are of the main kind; nothing before the first submission', () => {
  const reviews = [round(1, '2026-11-01T10:00:00Z', [{ id: 1, type: 'Screenshot', url: 'https://s/1' }])];
  assert.deepEqual(latestWork(reviews, 'developer').artifacts.map((a) => a.url), ['https://s/1']);
  assert.equal(latestWork([], 'developer'), null);
});
