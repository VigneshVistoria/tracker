import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dmy, searchTree, storyLabel, resultLabel, failReasonError, plural, todayIso, aOrAn, mapResultMessage } from '../requirementsTree.js';
import { navSectionsFor } from '../navigation.js';

const story = (id, code, title, requirements, tickets = []) => ({ id, code, title, requirements, tickets });
const EPICS = [
  { id: 1, code: 'E1', name: 'Formal lien', srsSection: 'SRS 4.1, 4.3, 4.4', stories: [story(11, 'US-01', 'Record a formal lien', ['LN-01', 'LN-02']), story(12, 'US-02', 'Capture consent', ['LN-10'], [{ taskId: 412, trk: 'TRK-412' }])] },
  { id: 2, code: 'E3', name: 'Litigation', srsSection: 'SRS 5.1', stories: [story(21, 'US-11', 'Record a litigation case', ['LT-01'])] },
];
const ids = (r) => r && { epics: [...r.epicIds].sort(), stories: [...r.storyIds].sort() };

test('dates are DD-MM-YYYY', () => {
  assert.equal(dmy('2026-11-16'), '16-11-2026');
  assert.equal(dmy(null), '—');
});

test('search: empty shows all; requirement ID, story, epic, TRK number', () => {
  assert.equal(searchTree(EPICS, '  '), null);
  assert.deepEqual(ids(searchTree(EPICS, 'ln-10')), { epics: [1], stories: [12] });
  assert.deepEqual(ids(searchTree(EPICS, 'US-11')), { epics: [2], stories: [21] });
  assert.deepEqual(ids(searchTree(EPICS, 'consent')), { epics: [1], stories: [12] });
  // An epic match shows all its stories.
  assert.deepEqual(ids(searchTree(EPICS, 'formal lien')), { epics: [1], stories: [11, 12] });
  assert.deepEqual(ids(searchTree(EPICS, 'SRS 5.1')), { epics: [2], stories: [21] });
  assert.deepEqual(ids(searchTree(EPICS, 'trk-412')), { epics: [1], stories: [12] });
  assert.deepEqual(ids(searchTree(EPICS, '412')), { epics: [1], stories: [12] });
  assert.deepEqual(ids(searchTree(EPICS, 'nothing like this')), { epics: [], stories: [] });
});

test('story labels follow the backend state', () => {
  assert.deepEqual(storyLabel({ state: 'blocked' }), { text: 'Blocked', tone: 'late' });
  assert.deepEqual(storyLabel({ state: 'dependency' }), { text: 'Waiting on dependency', tone: 'warn' });
  assert.deepEqual(storyLabel({ state: 'failed', passed: 2, total: 4 }), { text: '2 of 4 · failed', tone: 'late' });
  assert.deepEqual(storyLabel({ state: 'done' }), { text: 'Done', tone: 'ok' });
  assert.deepEqual(storyLabel({ state: 'no_tickets', status: 'draft' }), { text: 'Draft · no tickets yet', tone: '' });
  assert.deepEqual(storyLabel({ state: 'progress', passed: 1, total: 3 }), { text: '1 of 3 passed', tone: '' });
  assert.deepEqual(resultLabel('not_run'), { text: 'Not run', tone: '' });
});

test('Fail reason needs 10+ characters after trimming', () => {
  assert.match(failReasonError('  short  '), /at least 10/);
  assert.equal(failReasonError('0123456789'), '');
  assert.equal(plural(1, 'story', 'stories'), '1 story');
  assert.equal(plural(23, 'story', 'stories'), '23 stories');
});

test('nav: Requirements only when the switch is ON, never for developers', () => {
  const has = (role, requirements) =>
    navSectionsFor({ role }, { requirements })
      .flatMap((s) => s.items)
      .some((i) => i.href === '/requirements');
  for (const role of ['admin', 'program_manager', 'executive', 'qa', 'ba']) {
    assert.equal(has(role, false), false, role);
    assert.equal(has(role, true), true, role);
  }
  // A BA gets Requirements and nothing else.
  const baItems = navSectionsFor({ role: 'ba' }, { requirements: true }).flatMap((s) => s.items.map((i) => i.href));
  assert.deepEqual(baItems, ['/requirements']);
  assert.deepEqual(navSectionsFor({ role: 'ba' }, { requirements: false }), []);
  assert.equal(has('client', true), false);
  assert.equal(has('developer', true), false);
  // The switch page is always there for Admin/PM, never for others.
  const sw = (role) => navSectionsFor({ role }).flatMap((s) => s.items).some((i) => i.href === '/admin/requirements-settings');
  assert.equal(sw('admin'), true);
  assert.equal(sw('program_manager'), true);
  assert.equal(sw('executive'), false);
  assert.equal(sw('qa'), false);
  assert.equal(sw('ba'), false);
  // Renamed in Stage 2.
  const item = navSectionsFor({ role: 'admin' }).flatMap((s) => s.items).find((i) => i.href === '/admin/requirements-settings');
  assert.equal(item.label, 'Requirements Settings');
});

test('Stage 2 helpers: today in EAT, a/an, mapping message', () => {
  assert.equal(todayIso(new Date('2026-11-25T22:30:00Z')), '2026-11-26'); // 01:30 EAT next day
  assert.equal(todayIso(new Date('2026-11-25T05:00:00Z')), '2026-11-25');
  assert.equal(aOrAn('approver'), 'an');
  assert.equal(aOrAn('bank officer'), 'a');
  assert.equal(aOrAn(''), 'a');
  assert.equal(mapResultMessage({ story: 'US-02', linked: ['TRK-1 (DEV)'], skipped: ['TRK-2 (QA)'] }), 'Linked TRK-1 (DEV) to US-02. Already linked: TRK-2 (QA).');
  assert.equal(mapResultMessage({ story: 'US-02', linked: [], skipped: [] }), 'Nothing to link.');
});
