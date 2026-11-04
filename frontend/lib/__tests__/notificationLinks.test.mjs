import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationHref } from '../notificationLinks.js';

test('new links are used as they are', () => {
  assert.equal(notificationHref({ link: '/tasks/12#dependency-4' }), '/tasks/12#dependency-4');
  assert.equal(notificationHref({ link: '/issues/3' }), '/issues/3');
  assert.equal(notificationHref({ link: null }), null);
});

test('old dependency links open the parent task, not the Open-filtered list', () => {
  assert.equal(
    notificationHref({ link: '/dependency-clearance', title: 'Dependency on task #57 reassigned to you' }),
    '/tasks/57#dependency-tickets',
  );
  assert.equal(notificationHref({ link: '/dependency-clearance', title: 'Something else' }), '/dependency-clearance');
});
