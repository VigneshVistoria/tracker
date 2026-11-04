import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerReviewerOptions } from '../peerReviewers.js';

const people = [
  { id: 1, name: 'Zed', role: 'developer' },
  { id: 2, name: 'Rhea', role: 'designer' },
  { id: 3, name: 'Dana', role: 'designer' },
  { id: 4, name: 'Ali', role: 'devops' },
  { id: 5, name: 'Bea', role: 'designer' },
];

test('same role first, then everyone else with their role, never yourself', () => {
  const names = peerReviewerOptions(people, { id: 3, role: 'designer' }).map((p) => p.name);
  assert.deepEqual(names, ['Bea', 'Rhea', 'Ali (DevOps)', 'Zed (Developer)']);
});

test('nobody is removed - the rule stays any Developer/Designer/DevOps', () => {
  assert.equal(peerReviewerOptions(people, { id: 1, role: 'developer' }).length, 4);
});
