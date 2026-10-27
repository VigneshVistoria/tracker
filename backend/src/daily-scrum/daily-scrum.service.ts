import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { effectiveDueDate } from '../tasks/pm-review';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskBlockingDefect } from '../tasks/task-blocking-defect.entity';
import { TaskDependencyTicket } from '../task-dependency-tickets/task-dependency-ticket.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { AuditActions, AuditLogService } from '../audit/audit-log.service';
import { TestExecution, TestResult } from '../test-cases/test-execution.entity';
import { DEVELOPER_EQUIVALENT_ROLES, User, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { UpdateTeamSettingsDto } from './dto/update-team-settings.dto';
import { computeScrumWindow, isValidTimeZone, ScrumWindow, TEAM_SETTINGS_DEFAULTS } from './daily-scrum-window';
import {
  computeDailyScrum,
  EXCLUDED_STATUSES,
  ScrumEventInput,
  ScrumPerson,
  ScrumQaInput,
  ScrumTeam,
} from './daily-scrum.compute';

// People who appear on Daily Scrum - the ones who carry tickets.
export const SCRUM_PEOPLE_ROLES: UserRole[] = [...DEVELOPER_EQUIVALENT_ROLES, UserRole.QA];

// Same "resolved" set TasksService.findOpenBlockingDefects() and Status
// Review use - a copy, since Daily Scrum is additive and never changes
// existing Tasks logic.
const BLOCKING_DEFECT_RESOLVED_STATUSES = ['Pass', 'Junk', 'Closed'];
// Copies of TasksService's QA_PENDING_STATUSES / OPEN_DEFECT_STATUSES, for
// QA's queue numbers - same definitions the QA Review and My Defects pages
// count with.
const QA_PENDING_STATUSES = ['Feedback', 'Re-Feedback'];
const OPEN_DEFECT_STATUSES = ['Development', 'Feedback', 'Re-Feedback', 'Escalated', 'Returned to QA', 'Not Ready for Testing'];

// Audit actions that tell us a ticket was given to someone.
const ASSIGNMENT_ACTIONS = [
  AuditActions.TASK_CREATED,
  AuditActions.TASK_DEFECT_CREATED,
  AuditActions.TASK_ASSIGNED,
  AuditActions.TASK_REASSIGNED,
  AuditActions.TASK_ESCALATION_REASSIGNED,
];
// Audit actions about a ticket the person already holds.
const TASK_STATE_ACTIONS: Record<string, string> = {
  [AuditActions.TASK_HELD]: 'put_on_hold',
  [AuditActions.TASK_RELEASED_FROM_HOLD]: 'released_from_hold',
  [AuditActions.TASK_CLOSED]: 'closed',
  [AuditActions.TASK_REOPENED]: 'reopened',
};

export interface TeamSettingsView {
  timeZone: string;
  workdayStart: string;
  workdayEnd: string;
  // true when the tenant has no saved row and the defaults are in use.
  isDefault: boolean;
  updatedAt: Date | null;
  updatedByUserId: number | null;
  updatedByName: string | null;
}

export interface ScrumMeta {
  window: ScrumWindow;
  settings: TeamSettingsView;
}

// Read-only, except for the team settings row. Never writes to tickets,
// reviews, dependencies, SLA or KPI tables - every number comes from
// computeDailyScrum().
@Injectable()
export class DailyScrumService {
  constructor(
    @InjectRepository(TeamSettings) private readonly settingsRepository: Repository<TeamSettings>,
    @InjectRepository(ProjectTask) private readonly tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TaskBlockingDefect) private readonly blockingRepository: Repository<TaskBlockingDefect>,
    @InjectRepository(TaskDependencyTicket) private readonly ticketsRepository: Repository<TaskDependencyTicket>,
    @InjectRepository(TaskQaReview) private readonly reviewsRepository: Repository<TaskQaReview>,
    @InjectRepository(AuditLog) private readonly auditRepository: Repository<AuditLog>,
    @InjectRepository(TestExecution) private readonly executionsRepository: Repository<TestExecution>,
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------- Settings ----------

  // Never writes - a tenant without a row gets the defaults.
  async getSettings(tenantId: number): Promise<TeamSettingsView> {
    const row = await this.settingsRepository.findOne({ where: { tenantId } });
    if (!row) return { ...TEAM_SETTINGS_DEFAULTS, isDefault: true, updatedAt: null, updatedByUserId: null, updatedByName: null };
    const editor = row.updatedByUserId ? await this.usersService.findByIdAndTenant(row.updatedByUserId, tenantId) : null;
    return {
      timeZone: isValidTimeZone(row.timeZone) ? row.timeZone : TEAM_SETTINGS_DEFAULTS.timeZone,
      workdayStart: row.workdayStart,
      workdayEnd: row.workdayEnd,
      isDefault: false,
      updatedAt: row.updatedAt,
      updatedByUserId: row.updatedByUserId,
      updatedByName: editor ? editor.fullName || editor.email : null,
    };
  }

  // The settings row and its audit entry are saved in one transaction, so
  // a change can never land without its audit row.
  async updateSettings(
    dto: UpdateTeamSettingsDto,
    currentUser: { id: number; email: string; role: UserRole },
    tenantId: number,
  ): Promise<TeamSettingsView> {
    const before = await this.getSettings(tenantId);
    const after = {
      timeZone: dto.timeZone !== undefined ? dto.timeZone.trim() : before.timeZone,
      workdayStart: dto.workdayStart ?? before.workdayStart,
      workdayEnd: dto.workdayEnd ?? before.workdayEnd,
    };
    if (!isValidTimeZone(after.timeZone)) {
      throw new BadRequestException(`"${after.timeZone}" is not a recognised time zone (example: Africa/Addis_Ababa).`);
    }
    if (after.workdayStart >= after.workdayEnd) {
      throw new BadRequestException('Working hours start must be before working hours end.');
    }

    await this.settingsRepository.manager.transaction(async (em) => {
      const repo = em.getRepository(TeamSettings);
      await repo.save(repo.create({ tenantId, ...after, updatedByUserId: currentUser.id }));
      await this.auditLogService.recordWithin(em, {
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        action: AuditActions.DAILY_SCRUM_SETTINGS_UPDATED,
        tenantId,
        entityType: 'TeamSettings',
        entityId: tenantId,
        details: {
          before: { timeZone: before.timeZone, workdayStart: before.workdayStart, workdayEnd: before.workdayEnd },
          after,
        },
      });
    });
    return this.getSettings(tenantId);
  }

  // ---------- Scrum ----------

  async getMine(user: User, tenantId: number, now = new Date()): Promise<ScrumMeta & { person: ScrumPerson }> {
    const { meta, team } = await this.build(tenantId, [user], now);
    return { ...meta, person: team.people[0] };
  }

  async getPerson(userId: number, tenantId: number, now = new Date()): Promise<ScrumMeta & { person: ScrumPerson }> {
    const user = await this.usersService.findByIdAndTenant(userId, tenantId);
    if (!user || !SCRUM_PEOPLE_ROLES.includes(user.role)) {
      throw new NotFoundException(`User #${userId} is not a Developer, Designer, DevOps or QA in this team.`);
    }
    const { meta, team } = await this.build(tenantId, [user], now);
    return { ...meta, person: team.people[0] };
  }

  async getTeam(tenantId: number, now = new Date()): Promise<ScrumMeta & ScrumTeam> {
    const users = (await this.usersService.findAll(tenantId)).filter((u) => SCRUM_PEOPLE_ROLES.includes(u.role));
    users.sort((a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email) || a.id - b.id);
    const { meta, team } = await this.build(tenantId, users, now);
    return { ...meta, ...team };
  }

  private async build(tenantId: number, users: User[], now: Date): Promise<{ meta: ScrumMeta; team: ScrumTeam }> {
    const settings = await this.getSettings(tenantId);
    const window = computeScrumWindow(now, settings.timeZone);
    const personIds = users.map((u) => u.id);
    const allUsers = await this.usersService.findAll(tenantId);
    const userNames = new Map(allUsers.map((u) => [u.id, u.fullName || u.email]));

    const tasks = personIds.length
      ? await this.tasksRepository.find({
          where: { tenantId, assigneeUserId: In(personIds), status: Not(In(EXCLUDED_STATUSES)) },
        })
      : [];
    const taskIds = tasks.map((t) => t.id);

    const openTickets = personIds.length
      ? await this.ticketsRepository.find({
          where: [
            { tenantId, status: 'open', ownerUserId: In(personIds) },
            ...(taskIds.length ? [{ tenantId, status: 'open' as const, parentTaskId: In(taskIds) }] : []),
          ],
        })
      : [];

    const pendingPeer = personIds.length
      ? await this.reviewsRepository.find({
          where: { tenantId, reviewType: 'peer', status: 'pending', reviewerUserId: In(personIds) },
        })
      : [];

    const events = await this.loadEvents(tenantId, personIds, window.since);

    // Every ticket referenced by a dependency, peer review or event, for
    // titles/status/assignee - one lookup.
    const refIds = new Set<number>([...openTickets.map((d) => d.parentTaskId), ...pendingPeer.map((r) => r.taskId)]);
    const refTasks = refIds.size
      ? await this.tasksRepository.find({
          where: { tenantId, id: In([...refIds]) },
          select: ['id', 'title', 'status', 'dueDate', 'assigneeUserId'],
        })
      : [];
    const refById = new Map(refTasks.map((t) => [t.id, t]));

    const qaByUserId = new Map<number, ScrumQaInput>();
    for (const u of users.filter((u) => u.role === UserRole.QA)) {
      qaByUserId.set(u.id, await this.loadQa(tenantId, u.id, window.since));
    }

    const team = computeDailyScrum({
      people: users.map((u) => ({ userId: u.id, name: u.fullName || u.email, role: u.role })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assigneeUserId: t.assigneeUserId,
        // PM review gate: working days spent waiting for a PM extend it.
        dueDate: effectiveDueDate(t),
        isDefect: t.isDefect,
        priority: t.priority,
        projectName: t.projectName,
        moduleName: t.moduleName,
      })),
      blockedTaskIds: await this.findBlockedTaskIds(tenantId, taskIds),
      openDependencies: openTickets
        .filter((d) => refById.has(d.parentTaskId))
        .map((d) => {
          const parent = refById.get(d.parentTaskId)!;
          return {
            id: d.id,
            title: d.title,
            parentTaskId: d.parentTaskId,
            parentTaskTitle: parent.title,
            parentTaskStatus: parent.status,
            parentTaskDueDate: parent.dueDate,
            parentAssigneeUserId: parent.assigneeUserId,
            ownerUserId: d.ownerUserId,
            createdByUserId: d.createdByUserId,
            createdAt: d.createdAt,
          };
        }),
      pendingPeerReviews: pendingPeer
        .filter((r) => refById.has(r.taskId))
        .map((r) => {
          const t = refById.get(r.taskId)!;
          return {
            taskId: r.taskId,
            title: t.title,
            taskStatus: t.status,
            assigneeUserId: t.assigneeUserId,
            reviewerUserId: r.reviewerUserId,
            roundNumber: r.roundNumber,
            submittedAt: r.submittedAt,
          };
        }),
      events,
      qaByUserId,
      userNames,
      today: window.today,
    });

    return { meta: { window, settings }, team };
  }

  // "Since last working day": review rounds submitted or decided, tickets
  // given to someone, hold/release/close/reopen on their tickets, defects
  // QA raised, and dependency tickets raised or resolved - all inside the
  // window, for the people on the page. Nothing about a Junk ticket.
  private async loadEvents(tenantId: number, personIds: number[], since: Date): Promise<ScrumEventInput[]> {
    if (personIds.length === 0) return [];
    const people = new Set(personIds);
    const raw: Array<ScrumEventInput & { taskId: number | null }> = [];

    const rounds = await this.reviewsRepository.find({
      where: [
        { tenantId, submittedAt: MoreThanOrEqual(since) },
        { tenantId, reviewedAt: MoreThanOrEqual(since) },
      ],
    });
    for (const r of rounds) {
      // A reverted round's submission lives on in the pending round that
      // replaced it, and its decision was undone - nothing to report.
      if (r.status === 'reverted') continue;
      const type = r.reviewType === 'peer' ? 'Peer review' : r.reviewType === 'pm' ? 'PM review' : 'QA';
      if (r.submittedAt >= since) {
        raw.push({ userId: r.submittedByUserId, at: r.submittedAt, kind: 'submitted_for_review', taskId: r.taskId, title: '', detail: `${type}, round ${r.roundNumber}` });
      }
      // Pulled back from QA by a PM before QA decided it - the developer
      // hears it was sent back; it is no review by the PM.
      if (r.status === 'withdrawn') {
        if (r.reviewedAt && r.reviewedAt >= since) {
          raw.push({ userId: r.submittedByUserId, at: r.reviewedAt, kind: 'review_sent_back', taskId: r.taskId, title: '', detail: 'PM, before QA review' });
        }
        continue;
      }
      // QA could not start testing (2026-10-27) - sent back to the
      // developer, but not a review verdict.
      if (r.status === 'not_ready') {
        if (r.reviewedAt && r.reviewedAt >= since) {
          const detail = `QA, not ready for testing${r.notReadyReason ? `: ${r.notReadyReason}` : ''}`;
          raw.push({ userId: r.submittedByUserId, at: r.reviewedAt, kind: 'review_sent_back', taskId: r.taskId, title: '', detail });
          if (r.reviewedByUserId) {
            raw.push({ userId: r.reviewedByUserId, at: r.reviewedAt, kind: 'reviewed_not_ready', taskId: r.taskId, title: '', detail });
          }
        }
        continue;
      }
      if (r.reviewedAt && r.reviewedAt >= since && r.status !== 'pending') {
        const outcome = r.status === 'approved' ? 'review_passed' : r.status === 'rejected' ? 'review_sent_back' : 'review_escalated';
        raw.push({ userId: r.submittedByUserId, at: r.reviewedAt, kind: outcome, taskId: r.taskId, title: '', detail: type });
        if (r.reviewedByUserId) {
          raw.push({ userId: r.reviewedByUserId, at: r.reviewedAt, kind: `reviewed_${r.status}`, taskId: r.taskId, title: '', detail: type });
        }
      }
    }

    const audits = await this.auditRepository.find({
      where: {
        tenantId,
        entityType: 'ProjectTask',
        createdAt: MoreThanOrEqual(since),
        action: In([...ASSIGNMENT_ACTIONS, ...Object.keys(TASK_STATE_ACTIONS)]),
      },
    });
    const stateTaskIds = new Set<number>();
    for (const a of audits) {
      let details: Record<string, any> = {};
      try {
        details = a.details ? JSON.parse(a.details) : {};
      } catch {
        details = {};
      }
      if (ASSIGNMENT_ACTIONS.includes(a.action as any)) {
        if (typeof details.assigneeUserId === 'number') {
          raw.push({ userId: details.assigneeUserId, at: a.createdAt, kind: a.action === AuditActions.TASK_DEFECT_CREATED ? 'defect_assigned' : 'assigned', taskId: a.entityId, title: '' });
        }
        if (a.action === AuditActions.TASK_DEFECT_CREATED && a.userId) {
          raw.push({ userId: a.userId, at: a.createdAt, kind: 'raised_defect', taskId: a.entityId, title: '' });
        }
      } else {
        stateTaskIds.add(a.entityId);
        // userId filled from the ticket's assignee below.
        raw.push({ userId: -1, at: a.createdAt, kind: TASK_STATE_ACTIONS[a.action], taskId: a.entityId, title: '' });
      }
    }

    const tickets = await this.ticketsRepository.find({
      where: [
        { tenantId, createdAt: MoreThanOrEqual(since) },
        { tenantId, resolvedAt: MoreThanOrEqual(since) },
      ],
    });
    for (const d of tickets) {
      if (d.createdAt >= since) {
        raw.push({ userId: d.ownerUserId, at: d.createdAt, kind: 'dependency_received', taskId: d.parentTaskId, title: '', detail: d.title });
        raw.push({ userId: d.createdByUserId, at: d.createdAt, kind: 'dependency_raised', taskId: d.parentTaskId, title: '', detail: d.title });
      }
      if (d.resolvedAt && d.resolvedAt >= since) {
        raw.push({ userId: d.ownerUserId, at: d.resolvedAt, kind: 'dependency_resolved', taskId: d.parentTaskId, title: '', detail: d.title });
        raw.push({ userId: d.createdByUserId, at: d.resolvedAt, kind: 'dependency_cleared', taskId: d.parentTaskId, title: '', detail: d.title });
      }
    }

    const ids = [...new Set(raw.map((e) => e.taskId).filter((id): id is number => id != null))];
    const refTasks = ids.length
      ? await this.tasksRepository.find({ where: { tenantId, id: In(ids) }, select: ['id', 'title', 'status', 'assigneeUserId'] })
      : [];
    const byId = new Map(refTasks.map((t) => [t.id, t]));

    return raw
      .map((e) => {
        const t = e.taskId != null ? byId.get(e.taskId) : undefined;
        const userId = e.userId === -1 && t ? t.assigneeUserId : e.userId;
        return { ...e, userId, title: t?.title ?? '' };
      })
      .filter((e) => {
        const t = e.taskId != null ? byId.get(e.taskId) : undefined;
        return people.has(e.userId) && !!t && t.status !== 'Junk';
      });
  }

  private async loadQa(tenantId: number, userId: number, since: Date): Promise<ScrumQaInput> {
    const runs = await this.executionsRepository.find({
      where: { tenantId, executedByUserId: userId, executedAt: MoreThanOrEqual(since) },
      select: ['id', 'result'],
    });
    const count = (r: TestResult) => runs.filter((x) => x.result === r).length;
    return {
      executions: { passed: count(TestResult.PASSED), failed: count(TestResult.FAILED), blocked: count(TestResult.BLOCKED), total: runs.length },
      // Same definition as the QA Review list and its badge (2026-10-13):
      // every waiting task plus the waiting defects this QA raised.
      // pendingQa = the QA summary's Waiting + Re-feedback tiles together;
      // resubmissions = Re-feedback alone.
      queue: {
        pendingQa: await this.tasksRepository.count({
          where: [
            { tenantId, isDefect: false, status: In(QA_PENDING_STATUSES) },
            { tenantId, isDefect: true, createdByUserId: userId, status: In(QA_PENDING_STATUSES) },
          ],
        }),
        resubmissions: await this.tasksRepository.count({
          where: [
            { tenantId, isDefect: false, status: 'Re-Feedback' },
            { tenantId, isDefect: true, createdByUserId: userId, status: 'Re-Feedback' },
          ],
        }),
        myOpenDefects: await this.tasksRepository.count({
          where: { tenantId, isDefect: true, createdByUserId: userId, status: In(OPEN_DEFECT_STATUSES) },
        }),
      },
    };
  }

  // Same two sources as Status Review / TasksService.findOpenBlockingDefects():
  // an unresolved defect spun off the task, or one linked to it as blocking.
  private async findBlockedTaskIds(tenantId: number, taskIds: number[]): Promise<number[]> {
    if (taskIds.length === 0) return [];
    const blocked = new Set<number>();
    const spunOff = await this.tasksRepository.find({
      where: { tenantId, isDefect: true, parentTaskId: In(taskIds), status: Not(In(BLOCKING_DEFECT_RESOLVED_STATUSES)) },
      select: ['id', 'parentTaskId'],
    });
    for (const d of spunOff) blocked.add(d.parentTaskId);
    const links = await this.blockingRepository.find({ where: { tenantId, taskId: In(taskIds) } });
    if (links.length > 0) {
      const openLinked = await this.tasksRepository.find({
        where: { tenantId, isDefect: true, id: In([...new Set(links.map((l) => l.defectId))]), status: Not(In(BLOCKING_DEFECT_RESOLVED_STATUSES)) },
        select: ['id'],
      });
      const openIds = new Set(openLinked.map((d) => d.id));
      for (const l of links) if (openIds.has(l.defectId)) blocked.add(l.taskId);
    }
    return [...blocked];
  }
}
