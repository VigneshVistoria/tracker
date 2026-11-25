import { UserRole } from '../src/users/user.entity';
import { baMayCall } from '../src/common/ba-scope.guard';
import {
  averagePercent,
  canApprove,
  canEditStory,
  canRecordClientSignOff,
  canRecordResults,
  canTakeClientSignOff,
  canWrite,
  isWorkingStory,
  nextCode,
  parseTrk,
  requirementTokens,
  showsAtRisk,
  suggestStories,
  canViewRequirements,
  failReasonProblem,
  isStoryDone,
  nextStoryStatus,
  resolveRequirementsTree,
  seesAllProjects,
  storyPercent,
  storyState,
  summaryStrip,
} from '../src/requirements/requirements';

// Requirements traceability Stage 1 - the pure rules (src/requirements/requirements.ts).
describe('requirements rules', () => {
  it('story % = criteria passed / total, rounded; no criteria = 0', () => {
    expect(storyPercent([])).toBe(0);
    expect(storyPercent(['not_run', 'not_run'])).toBe(0);
    expect(storyPercent(['pass', 'fail', 'not_run'])).toBe(33);
    expect(storyPercent(['pass', 'pass', 'not_run'])).toBe(67);
    expect(storyPercent(['pass', 'pass'])).toBe(100);
  });

  it('Done only when every criterion passes, never with no criteria', () => {
    expect(isStoryDone([])).toBe(false);
    expect(isStoryDone(['pass', 'not_run'])).toBe(false);
    expect(isStoryDone(['pass', 'pass'])).toBe(true);
  });

  it('epic and SRS % = average of the stories, empty = 0', () => {
    expect(averagePercent([])).toBe(0);
    expect(averagePercent([100, 0, 50])).toBe(50);
    expect(averagePercent([100, 33, 0])).toBe(44);
  });

  it('story status: Draft stays Draft; Approved -> In progress -> Done and back', () => {
    expect(nextStoryStatus('draft', ['pass', 'pass'], true)).toBe('draft');
    expect(nextStoryStatus('approved', ['not_run'], false)).toBe('approved');
    expect(nextStoryStatus('approved', ['not_run'], true)).toBe('in_progress');
    expect(nextStoryStatus('approved', ['pass', 'not_run'], false)).toBe('in_progress');
    expect(nextStoryStatus('in_progress', ['pass', 'pass'], true)).toBe('done');
    expect(nextStoryStatus('done', ['pass', 'fail'], true)).toBe('in_progress');
    expect(nextStoryStatus('approved', [], false)).toBe('approved');
  });

  it('tree label precedence: blocked, dependency, failed, done, progress, no tickets', () => {
    const base = { results: ['pass', 'fail'] as any, blocked: true, dependency: true, ticketCount: 1 };
    expect(storyState(base)).toBe('blocked');
    expect(storyState({ ...base, blocked: false })).toBe('dependency');
    expect(storyState({ ...base, blocked: false, dependency: false })).toBe('failed');
    expect(storyState({ results: ['pass'], blocked: false, dependency: false, ticketCount: 0 })).toBe('done');
    expect(storyState({ results: ['pass', 'not_run'], blocked: false, dependency: false, ticketCount: 0 })).toBe('progress');
    expect(storyState({ results: ['not_run'], blocked: false, dependency: false, ticketCount: 2 })).toBe('progress');
    expect(storyState({ results: ['not_run'], blocked: false, dependency: false, ticketCount: 0 })).toBe('no_tickets');
  });

  it('summary strip counts', () => {
    const s = summaryStrip([
      { results: ['pass', 'pass'], blocked: false, dependency: false, ticketCount: 1 },
      { results: ['pass', 'fail', 'not_run'], blocked: true, dependency: false, ticketCount: 1 },
      { results: ['not_run'], blocked: false, dependency: true, ticketCount: 1 },
    ]);
    expect(s).toEqual({ percent: 44, criteriaPassed: 3, criteriaTotal: 6, storiesDone: 1, storiesTotal: 3, storiesFailed: 1, storiesBlocked: 1, storiesWaiting: 1 });
    expect(summaryStrip([])).toEqual({ percent: 0, criteriaPassed: 0, criteriaTotal: 0, storiesDone: 0, storiesTotal: 0, storiesFailed: 0, storiesBlocked: 0, storiesWaiting: 0 });
  });

  it('Fail reason: at least 10 characters after trimming', () => {
    expect(failReasonProblem(undefined)).toMatch(/at least 10/);
    expect(failReasonProblem('   short    ')).toMatch(/at least 10/);
    expect(failReasonProblem('0123456789')).toBeNull();
    expect(failReasonProblem('x'.repeat(2001))).toMatch(/at most/);
  });

  it('roles: view, all projects, Pass/Fail', () => {
    for (const r of [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE]) {
      expect(canViewRequirements(r)).toBe(true);
      expect(seesAllProjects(r)).toBe(true);
    }
    expect(canViewRequirements(UserRole.QA)).toBe(true);
    expect(seesAllProjects(UserRole.QA)).toBe(false);
    for (const r of [UserRole.DEVELOPER, UserRole.DESIGNER, UserRole.DEVOPS, UserRole.CLIENT]) expect(canViewRequirements(r)).toBe(false);
    expect([UserRole.QA, UserRole.PROGRAM_MANAGER, UserRole.ADMIN].every(canRecordResults)).toBe(true);
    expect([UserRole.EXECUTIVE, UserRole.DEVELOPER, UserRole.CLIENT].some(canRecordResults)).toBe(false);
  });

  it('switch: only true is ON', () => {
    expect(resolveRequirementsTree(true)).toBe(true);
    for (const v of [false, null, undefined, 'true', 1]) expect(resolveRequirementsTree(v)).toBe(false);
  });

  // ---- Stage 2 ----

  it('Stage 2 roles: write, approve, client sign-off; BA edits Draft stories only', () => {
    expect([UserRole.BA, UserRole.PROGRAM_MANAGER, UserRole.ADMIN].every(canWrite)).toBe(true);
    expect([UserRole.QA, UserRole.EXECUTIVE, UserRole.DEVELOPER].some(canWrite)).toBe(false);
    expect([UserRole.PROGRAM_MANAGER, UserRole.ADMIN].every(canApprove)).toBe(true);
    expect(canApprove(UserRole.BA)).toBe(false);
    expect(canRecordClientSignOff(UserRole.PROGRAM_MANAGER)).toBe(true);
    expect(canRecordClientSignOff(UserRole.ADMIN)).toBe(false);
    expect(canEditStory(UserRole.BA, 'draft')).toBe(true);
    expect(canEditStory(UserRole.BA, 'approved')).toBe(false);
    expect(canEditStory(UserRole.PROGRAM_MANAGER, 'done')).toBe(true);
    expect(canEditStory(UserRole.QA, 'draft')).toBe(false);
    expect(canViewRequirements(UserRole.BA)).toBe(true);
    expect(seesAllProjects(UserRole.BA)).toBe(false);
    expect(canRecordResults(UserRole.BA)).toBe(false);
  });

  it('working stories, client sign-off states, At risk label', () => {
    expect(['approved', 'in_progress', 'done'].every((s) => isWorkingStory(s as any))).toBe(true);
    expect(isWorkingStory('draft')).toBe(false);
    expect(canTakeClientSignOff('in_review')).toBe(true);
    expect(canTakeClientSignOff('signed_off')).toBe(true);
    expect(canTakeClientSignOff('draft')).toBe(false);
    expect(canTakeClientSignOff('client_signed_off')).toBe(false);
    expect(showsAtRisk({ atRisk: true }, 'in_review')).toBe(true);
    expect(showsAtRisk({ atRisk: true }, 'client_signed_off')).toBe(false);
    expect(showsAtRisk({ atRisk: false }, 'in_review')).toBe(false);
  });

  it('codes are the next number, never reusing one', () => {
    expect(nextCode('US', [])).toBe('US-01');
    expect(nextCode('US', ['US-01', 'US-23', 'X-99'])).toBe('US-24');
    expect(nextCode('US', ['US-99'])).toBe('US-100');
    expect(nextCode('E', ['E1', 'E6', 'E10'])).toBe('E11');
  });

  it('TRK numbers and Requirement ID tokens', () => {
    for (const v of ['TRK-123', 'trk 123', ' #123 ', '123', 'TRK123']) expect(parseTrk(v)).toBe(123);
    for (const v of ['', 'abc', 'TRK-', '12a', null, undefined]) expect(parseTrk(v)).toBeNull();
    expect(requirementTokens(' ln-10, LN-11;us-03 / LN-10 ')).toEqual(['LN-10', 'LN-11', 'US-03']);
    expect(requirementTokens(null)).toEqual([]);
  });

  it('suggestions: story code first, else a traced requirement', () => {
    const stories = [
      { code: 'US-02', requirements: ['LN-09', 'LN-10'] },
      { code: 'US-03', requirements: ['LN-04'] },
    ];
    expect(suggestStories('us-03', stories).map((m) => [m.story.code, m.via])).toEqual([['US-03', 'US-03']]);
    expect(suggestStories('LN-10, LN-04', stories).map((m) => [m.story.code, m.via])).toEqual([
      ['US-02', 'LN-10'],
      ['US-03', 'LN-04'],
    ]);
    expect(suggestStories('NFR-1', stories)).toEqual([]);
    expect(suggestStories(null, stories)).toEqual([]);
  });

  it('BA may call Requirements, sign-in/session and the app frame calls only', () => {
    for (const p of ['/requirements', '/requirements/srs', '/requirements/srs/1/tree', '/auth/refresh', '/auth/logout', '/notifications', '/notifications/unread-count', '/client-portal/me', '/own-metrics-visibility/me', '/requirements/']) {
      expect([p, baMayCall(p)]).toEqual([p, true]);
    }
    for (const p of ['/requirementsx', '/issues', '/projects', '/client-portal/tickets', '/own-metrics-visibility', '/users/me', '/notificationsx', '/', '', '/auth']) {
      expect([p, baMayCall(p)]).toEqual([p, false]);
    }
  });
});
