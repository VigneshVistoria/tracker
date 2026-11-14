import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAddDependencyFiles, checkDependencyFiles } from '../dependencyAttachments.js';

const file = (name, size = 1000) => ({ name, size });

test('allowed types only: images, PDF, docx, xlsx', () => {
  assert.equal(checkDependencyFiles([file('a.png'), file('b.PDF'), file('c.docx'), file('d.xlsx'), file('e.jpeg')]), null);
  assert.match(checkDependencyFiles([file('x.pptx')]), /not an allowed/);
  assert.match(checkDependencyFiles([file('x.txt')]), /not an allowed/);
  assert.match(checkDependencyFiles([file('x.csv')]), /not an allowed/);
});

test('10 MB each, not empty, 5 per upload, 10 per side', () => {
  assert.match(checkDependencyFiles([file('a.png', 10 * 1024 * 1024 + 1)]), /larger than 10 MB/);
  assert.equal(checkDependencyFiles([file('a.png', 10 * 1024 * 1024)]), null);
  assert.match(checkDependencyFiles([file('a.png', 0)]), /empty/);
  assert.match(checkDependencyFiles(Array.from({ length: 6 }, (_, i) => file(`${i}.png`))), /at most 5/);
  assert.match(checkDependencyFiles([file('a.png'), file('b.png')], 9), /at most 10/);
  assert.equal(checkDependencyFiles([file('a.png')], 9), null);
});

test('who can add files - same rule as the backend', () => {
  const me = { id: 7 };
  const open = { status: 'open', createdByUserId: 7, ownerUserId: 8, resolvedByUserId: null, resolvedVia: null };
  assert.equal(canAddDependencyFiles(open, 'request', me), true);
  assert.equal(canAddDependencyFiles(open, 'request', { id: 8 }), false);
  assert.equal(canAddDependencyFiles(open, 'resolution', me), false);
  const resolved = { ...open, status: 'resolved', resolvedByUserId: 8, resolvedVia: 'ticket' };
  assert.equal(canAddDependencyFiles(resolved, 'request', me), false);
  assert.equal(canAddDependencyFiles(resolved, 'resolution', { id: 8 }), true);
  assert.equal(canAddDependencyFiles(resolved, 'resolution', me), false);
  const auto = { ...open, status: 'resolved', resolvedByUserId: null, resolvedVia: 'linked_task' };
  assert.equal(canAddDependencyFiles(auto, 'resolution', { id: 8 }), true);
  assert.equal(canAddDependencyFiles(auto, 'resolution', me), false);
  assert.equal(canAddDependencyFiles({ ...open, status: 'cancelled' }, 'request', me), false);
});
