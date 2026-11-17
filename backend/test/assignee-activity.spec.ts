import { assigneeActivity, ACTIVITY_AUDIT_ACTIONS } from '../src/tasks/assignee-activity';

// Developer home "My work" (2026-11-17): "Not started" vs "In progress"
// for a Development task - only what the CURRENT assignee did since the
// task was given to them counts. Display only.
describe('assigneeActivity', () => {
  const ME = 7;
  const OTHER = 8;
  const task = { id: 1, assigneeUserId: ME, createdAt: new Date('2026-11-01T09:00:00Z') };
  let n = 0;
  const audit = (action: string, userId: number, at: string, details: any = null) => ({
    id: ++n, tenantId: 1, action, entityType: 'ProjectTask', entityId: 1, userId, userRole: null, createdAt: new Date(at), details,
  });
  const run = (audits: any[], notes: any[] = []) => assigneeActivity([task], audits, notes)[0];

  it('nothing by the assignee -> no last activity; assignedAt falls back to creation', () => {
    expect(run([])).toEqual({ taskId: 1, assignedAt: '2026-11-01T09:00:00.000Z', lastActivityAt: null, lastSubmittedAt: null });
  });

  it('assignedAt = the latest hand-over to the current assignee', () => {
    const r = run([
      audit('task_assigned', OTHER, '2026-11-02T00:00:00Z', { assigneeUserId: ME }),
      audit('task_reassigned', OTHER, '2026-11-05T00:00:00Z', { previousAssigneeUserId: OTHER, assigneeUserId: ME }),
      audit('task_reassigned', OTHER, '2026-11-04T00:00:00Z', { previousAssigneeUserId: ME, assigneeUserId: OTHER }),
    ]);
    expect(r.assignedAt).toBe('2026-11-05T00:00:00.000Z');
    expect(r.lastActivityAt).toBeNull();
  });

  it('a status change or progress note by the assignee after assignment counts (latest wins)', () => {
    const r = run(
      [audit('task_assigned', OTHER, '2026-11-02T00:00:00Z', { assigneeUserId: ME }), audit('task_released_from_hold', ME, '2026-11-03T00:00:00Z')],
      [{ taskId: 1, authorUserId: ME, createdAt: new Date('2026-11-06T10:00:00Z') }],
    );
    expect(r.lastActivityAt).toBe('2026-11-06T10:00:00.000Z');
  });

  it('the assignee\'s own edits count too (fields, due date confirmed)', () => {
    expect(run([audit('task_updated', ME, '2026-11-07T00:00:00Z', { previous: {}, updated: { title: 'x' } })]).lastActivityAt).toBe('2026-11-07T00:00:00.000Z');
    expect(run([audit('task_due_date_committed', ME, '2026-11-08T00:00:00Z', { confirmed: true, dueDate: '2026-11-20' })]).lastActivityAt).toBe('2026-11-08T00:00:00.000Z');
  });

  it('lastSubmittedAt = the latest review round; null when never submitted', () => {
    expect(run([]).lastSubmittedAt).toBeNull();
    const r = assigneeActivity([task], [], [], [
      { taskId: 1, submittedAt: new Date('2026-11-04T00:00:00Z') },
      { taskId: 1, submittedAt: new Date('2026-11-09T00:00:00Z') },
      { taskId: 2, submittedAt: new Date('2026-11-12T00:00:00Z') },
    ])[0];
    expect(r.lastSubmittedAt).toBe('2026-11-09T00:00:00.000Z');
  });

  it('ignores activity before the latest assignment, by other people and the assignment itself', () => {
    const r = run(
      [
        audit('task_qa_submitted', ME, '2026-11-02T00:00:00Z'),
        audit('task_reassigned', OTHER, '2026-11-05T00:00:00Z', { previousAssigneeUserId: OTHER, assigneeUserId: ME }),
        audit('task_held', OTHER, '2026-11-06T00:00:00Z'),
        audit('task_updated', ME, '2026-11-04T00:00:00Z', { previous: {}, updated: { title: 'x' } }),
        audit('task_updated', OTHER, '2026-11-07T00:00:00Z', { previous: {}, updated: { title: 'x' } }),
        audit('task_assigned', ME, '2026-11-05T00:00:00Z', { assigneeUserId: ME }),
      ],
      [
        { taskId: 1, authorUserId: ME, createdAt: new Date('2026-11-03T00:00:00Z') },
        { taskId: 1, authorUserId: OTHER, createdAt: new Date('2026-11-08T00:00:00Z') },
        { taskId: 2, authorUserId: ME, createdAt: new Date('2026-11-08T00:00:00Z') },
      ],
    );
    expect(r.lastActivityAt).toBeNull();
  });

  it('assignment and creation actions are never activity', () => {
    for (const a of ['task_created', 'task_defect_created', 'task_assigned', 'task_reassigned', 'task_escalation_reassigned']) {
      expect(ACTIVITY_AUDIT_ACTIONS).not.toContain(a);
    }
    expect(ACTIVITY_AUDIT_ACTIONS).toContain('task_qa_submitted');
    expect(ACTIVITY_AUDIT_ACTIONS).toContain('task_updated');
  });
});
