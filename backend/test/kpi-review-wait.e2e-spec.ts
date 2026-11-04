import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './setup/test-app';
import { seedFixtures, Fixtures } from './setup/fixtures';
import { KpiService } from '../src/kpi/kpi.service';

// KPI overdue % / target miss % do not charge review wait (QA, peer, PM)
// to the developer - user decision 2026-11-04.
describe('KPI: review wait is not the developer\'s (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let f: Fixtures;
  let phaseId: number;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    ds = t.dataSource;
    f = await seedFixtures(ds);
    await ds.query(`TRUNCATE project_tasks, task_qa_reviews, task_dependency_tickets, task_blocking_defects, kpi_period_score, audit_logs RESTART IDENTITY CASCADE`);
    phaseId = (await ds.query(
      `INSERT INTO phases ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "name") VALUES ($1, $2, 'Project A', $3, 'Medical Claim', 'Build') RETURNING id`,
      [f.tenants.t1, f.projects.pA, f.modules.mA],
    ))[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const task = async (title: string, status: string, dueDate: string, completedAt: string | null = null) =>
    (await ds.query(
      `INSERT INTO project_tasks ("tenantId", "projectId", "projectName", "moduleId", "moduleName", "phaseId", "phaseName", title, description, status, "estimatedHours", "dueDate", "completedAt", "assigneeUserId", "assigneeEmail", "createdByUserId", "createdByEmail")
       VALUES ($1, $2, 'Project A', $3, 'Medical Claim', $4, 'Build', $5, 'x', $6, 4, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [f.tenants.t1, f.projects.pA, f.modules.mA, phaseId, title, status, dueDate, completedAt, f.users.devA.id, f.users.devA.email, f.users.pm.id, f.users.pm.email],
    ))[0].id as number;
  const round = (taskId: number, n: number, status: string, submittedAt: string, reviewedAt: string | null) =>
    ds.query(
      `INSERT INTO task_qa_reviews ("tenantId", "taskId", "roundNumber", "submittedByUserId", "submittedByEmail", "reviewType", status, "submittedAt", "reviewedAt", "reviewedByUserId", "reviewedByEmail", resolution)
       VALUES ($1, $2, $3, $4, $5, 'qa', $6, $7, $8, $9, $10, '<p>Fixed</p>')`,
      [f.tenants.t1, taskId, n, f.users.devA.id, f.users.devA.email, status, submittedAt, reviewedAt, reviewedAt ? f.users.qaB.id : null, reviewedAt ? f.users.qaB.email : null],
    );

  it('target miss judges the passing submission with earlier review wait added; QA wait is never overdue', async () => {
    // A: due Wed 7 Oct. QA took Mon 5 -> Wed 7 (2 working days) to reject;
    // fixed and resubmitted Thu 8 Oct (within due + 2 = Fri 9); QA passed it 20 Oct.
    const a = await task('A', 'Pass', '2026-10-07', '2026-10-20T10:00:00Z');
    await round(a, 1, 'rejected', '2026-10-05T09:00:00Z', '2026-10-07T09:00:00Z');
    await round(a, 2, 'approved', '2026-10-08T09:00:00Z', '2026-10-20T10:00:00Z');
    // B: first submitted Mon 12 Oct, after its due date - late either way.
    const b = await task('B', 'Pass', '2026-10-07', '2026-10-13T10:00:00Z');
    await round(b, 1, 'approved', '2026-10-12T09:00:00Z', '2026-10-13T10:00:00Z');
    // C: waiting for QA since 6 Oct, past its due date - with QA, not overdue.
    const c = await task('C', 'Feedback', '2026-10-07');
    await round(c, 1, 'pending', '2026-10-06T09:00:00Z', null);

    const rows = await app.get(KpiService).generatePeriod('monthly', new Date('2026-10-15T12:00:00Z'), f.tenants.t1);
    const mine = rows.find((r: any) => r.assigneeUserId === f.users.devA.id && r.projectId === f.projects.pA)!;
    expect(mine).toMatchObject({ ticketsDue: 3, ticketsCompleted: 2 });
    // Before this change: target miss 100 (both completedAt after the due date), overdue 33.33.
    expect(Number(mine.targetMissPercent)).toBe(50);
    expect(Number(mine.overduePercent)).toBe(0);
  });
});
