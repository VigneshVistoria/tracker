import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProjectTask } from './project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { TasksService } from './tasks.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { isValidTimeZone, TEAM_SETTINGS_DEFAULTS } from '../team-settings/time-zone';
import { resolveQaSummaryPeriod, ResolvedPeriod } from './qa-summary-period';

// QA Review summary (2026-10-13) - the five tiles at the top of the QA
// Review page and the drill-down list behind each one. Read-only: it only
// ever SELECTs, so it can't move a ticket, an SLA or a KPI number.
//
// Rules (confirmed with the user 2026-10-13):
// - Junk and Hold tickets (by current status) are left out of every tile.
//   There are no Epic/Story containers in this app.
// - Each ticket appears once per tile. buildTiles() below is the only
//   place rows come from - summary() just counts its lists and items()
//   returns one of them, so a tile's number always equals its rows.
// - Defects raised: defects the QA created in the period.
// - Approved / Rejected: tickets with at least one QA-round approval /
//   rejection by the QA in the period (Peer Review rounds never count).
//   Escalations to PM are not rejections and are left out.
// - Waiting / Re-feedback (right now, no dates): the QA Review list
//   (TasksService.findQaQueue() with defects) split by status, so they
//   never overlap and together equal the page and its sidebar badge.
//   Waiting = Feedback (first submission), Re-feedback = Re-Feedback (any
//   later round, same as the list's Resubmissions card - this includes a
//   ticket sent back to QA after an approval, not only after a rejection).
//   Split confirmed with the user 2026-10-13 (option A).
// - QA sees only their own numbers. Admin/PM/Executive pick one QA or All.
//   Executive stays tasks-only, same as the QA Review list.
// - The period is resolved here, in the team's time zone (team_settings),
//   not in the viewer's browser - see qa-summary-period.ts (2026-10-13).

export const QA_SUMMARY_TILES = ['defectsRaised', 'approved', 'rejected', 'waiting', 'refeedback'] as const;
export type QaSummaryTile = (typeof QA_SUMMARY_TILES)[number];

const VIEW_ROLES: UserRole[] = [UserRole.QA, UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];
const EXCLUDED_STATUSES = ['Junk', 'Hold'];

export interface QaSummaryQuery {
  period?: string;
  // Custom only: YYYY-MM-DD, both included.
  from?: string;
  to?: string;
  qaUserId?: string;
  projectId?: string;
  developerUserId?: string;
}

export interface QaSummaryRow {
  id: number;
  title: string;
  isDefect: boolean;
  projectId: number;
  projectName: string;
  moduleName: string;
  developerUserId: number | null;
  developerName: string | null;
  // null on a waiting task: any QA can pick it up, nobody owns it yet.
  qaUserId: number | null;
  qaName: string | null;
  happenedAt: Date;
  status: string;
  // Round number of the pending round (Waiting/Re-feedback), else null.
  round: number | null;
  // Rejected: rejections by the QA in the period. Waiting/Re-feedback:
  // every earlier QA rejection. Otherwise null.
  rejections: number | null;
  // Approved: approvals by the QA in the period, else null.
  approvals: number | null;
}

interface Scope {
  tenantId: number;
  range: ResolvedPeriod;
  from: Date;
  to: Date;
  // null = All QAs.
  qaUserId: number | null;
  includeDefects: boolean;
  projectId: number | null;
  developerUserId: number | null;
}

interface DecidedRound {
  taskId: number;
  reviewedByUserId: number;
  submittedByUserId: number;
  reviewedAt: Date;
}

@Injectable()
export class QaSummaryService {
  constructor(
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    private tasksService: TasksService,
    private usersService: UsersService,
    @InjectRepository(TeamSettings)
    private teamSettingsRepository: Repository<TeamSettings>,
  ) {}

  async summary(query: QaSummaryQuery, currentUser: { id: number; role: UserRole }, tenantId: number) {
    const scope = await this.resolveScope(query, currentUser, tenantId);
    const { tiles, projects, developers } = await this.buildTiles(scope, currentUser);
    const counts = Object.fromEntries(QA_SUMMARY_TILES.map((t) => [t, tiles[t].length])) as Record<QaSummaryTile, number>;
    const decided = counts.approved + counts.rejected;
    const qaUsers = await this.usersService.findByRole(UserRole.QA, tenantId);
    const qas =
      currentUser.role === UserRole.QA
        ? []
        : qaUsers.map((u) => ({ id: u.id, name: u.fullName || u.email })).sort((a, b) => a.name.localeCompare(b.name));
    // Display only (2026-10-13): with exactly one QA-role user, the
    // drill-down shows their name instead of "Any QA" on tasks nobody has
    // picked up - the shared queue is that one person's queue. Users have
    // no active flag, so every QA-role user in the tenant counts. Rows,
    // routing and qaUserId are unchanged.
    const soleQaName = qaUsers.length === 1 ? qaUsers[0].fullName || qaUsers[0].email : null;
    return {
      counts,
      passRate: decided === 0 ? null : Math.round((counts.approved / decided) * 100),
      range: { period: scope.range.period, from: scope.range.fromDate, to: scope.range.toDate, timeZone: scope.range.timeZone },
      includeDefects: scope.includeDefects,
      qas,
      soleQaName,
      projects,
      developers,
    };
  }

  async items(tile: string | undefined, query: QaSummaryQuery, currentUser: { id: number; role: UserRole }, tenantId: number) {
    if (!QA_SUMMARY_TILES.includes(tile as QaSummaryTile)) {
      throw new BadRequestException(`tile must be one of: ${QA_SUMMARY_TILES.join(', ')}.`);
    }
    const scope = await this.resolveScope(query, currentUser, tenantId);
    const { tiles } = await this.buildTiles(scope, currentUser);
    return tiles[tile as QaSummaryTile];
  }

  private async resolveScope(query: QaSummaryQuery, currentUser: { id: number; role: UserRole }, tenantId: number): Promise<Scope> {
    if (!VIEW_ROLES.includes(currentUser.role)) {
      throw new ForbiddenException('Only QA, Admin, Executive, or Program Manager can view the QA summary.');
    }
    const settings = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    const timeZone = isValidTimeZone(settings?.timeZone) ? settings!.timeZone : TEAM_SETTINGS_DEFAULTS.timeZone;
    const range = resolveQaSummaryPeriod(query, new Date(), timeZone);

    let qaUserId = optionalId(query.qaUserId, 'qaUserId');
    if (currentUser.role === UserRole.QA) {
      if (qaUserId !== null && qaUserId !== currentUser.id) {
        throw new ForbiddenException('QA can only view their own numbers.');
      }
      qaUserId = currentUser.id;
    }
    return {
      tenantId,
      range,
      from: range.from,
      to: range.to,
      qaUserId,
      includeDefects: currentUser.role !== UserRole.EXECUTIVE,
      projectId: optionalId(query.projectId, 'projectId'),
      developerUserId: optionalId(query.developerUserId, 'developerUserId'),
    };
  }

  // Every tile's rows, before and after the Project/Developer filters -
  // the filter dropdowns are built from the unfiltered rows so picking a
  // project never empties its own dropdown.
  private async buildTiles(scope: Scope, currentUser: { id: number; role: UserRole }) {
    const [defectsRaised, approved, rejected, waitingAll] = await Promise.all([
      this.defectsRaisedRows(scope),
      this.decidedRows(scope, 'approved'),
      this.decidedRows(scope, 'rejected'),
      this.waitingRows(scope, currentUser),
    ]);
    const unfiltered: Record<QaSummaryTile, QaSummaryRow[]> = {
      defectsRaised,
      approved,
      rejected,
      waiting: waitingAll.filter((r) => r.status === 'Feedback'),
      refeedback: waitingAll.filter((r) => r.status === 'Re-Feedback'),
    };
    await this.fillNames(Object.values(unfiltered).flat(), scope.tenantId);

    const projects = new Map<number, string>();
    const developers = new Map<number, string>();
    for (const row of Object.values(unfiltered).flat()) {
      projects.set(row.projectId, row.projectName);
      if (row.developerUserId != null) developers.set(row.developerUserId, row.developerName || `User #${row.developerUserId}`);
    }

    const keep = (r: QaSummaryRow) =>
      (scope.projectId === null || r.projectId === scope.projectId) &&
      (scope.developerUserId === null || r.developerUserId === scope.developerUserId);
    const byNewest = (a: QaSummaryRow, b: QaSummaryRow) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime() || b.id - a.id;
    const tiles = Object.fromEntries(
      QA_SUMMARY_TILES.map((t) => [t, unfiltered[t].filter(keep).sort(byNewest)]),
    ) as Record<QaSummaryTile, QaSummaryRow[]>;

    const toOptions = (m: Map<number, string>) => [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    return { tiles, projects: toOptions(projects), developers: toOptions(developers) };
  }

  private async defectsRaisedRows(scope: Scope): Promise<QaSummaryRow[]> {
    if (!scope.includeDefects) return [];
    const qb = this.tasksRepository
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId AND t.isDefect = true', { tenantId: scope.tenantId })
      .andWhere('t.status NOT IN (:...excluded)', { excluded: EXCLUDED_STATUSES })
      .andWhere('t.createdAt >= :from AND t.createdAt < :to', { from: scope.from, to: scope.to });
    if (scope.qaUserId !== null) qb.andWhere('t.createdByUserId = :qa', { qa: scope.qaUserId });
    const defects = await qb.getMany();
    return defects.map((t) => this.row(t, { developerUserId: t.assigneeUserId, qaUserId: t.createdByUserId, happenedAt: t.createdAt }));
  }

  // One row per ticket with at least one QA-round decision of this kind by
  // the QA in the period. "When" and "QA" come from the latest such
  // decision; the developer is whoever submitted that round.
  private async decidedRows(scope: Scope, decision: 'approved' | 'rejected'): Promise<QaSummaryRow[]> {
    const qb = this.qaReviewsRepository
      .createQueryBuilder('r')
      .innerJoin(ProjectTask, 't', 't.id = r.taskId AND t.tenantId = r.tenantId')
      .select(['r.taskId AS "taskId"', 'r.reviewedByUserId AS "reviewedByUserId"', 'r.submittedByUserId AS "submittedByUserId"', 'r.reviewedAt AS "reviewedAt"'])
      .where("r.tenantId = :tenantId AND r.reviewType = 'qa' AND r.status = :decision", { tenantId: scope.tenantId, decision })
      .andWhere('r.reviewedAt >= :from AND r.reviewedAt < :to', { from: scope.from, to: scope.to })
      .andWhere('t.status NOT IN (:...excluded)', { excluded: EXCLUDED_STATUSES })
      .orderBy('r.reviewedAt', 'DESC')
      .addOrderBy('r.id', 'DESC');
    if (scope.qaUserId !== null) qb.andWhere('r.reviewedByUserId = :qa', { qa: scope.qaUserId });
    if (!scope.includeDefects) qb.andWhere('t.isDefect = false');
    const rounds: DecidedRound[] = await qb.getRawMany();
    if (rounds.length === 0) return [];

    // Newest first, so the first round seen per ticket is its latest.
    const latest = new Map<number, DecidedRound>();
    const decisions = new Map<number, number>();
    for (const r of rounds) {
      if (!latest.has(r.taskId)) latest.set(r.taskId, r);
      decisions.set(r.taskId, (decisions.get(r.taskId) || 0) + 1);
    }
    const tickets = await this.tasksRepository.find({ where: { tenantId: scope.tenantId, id: In([...latest.keys()]) } });
    return tickets.map((t) => {
      const r = latest.get(t.id)!;
      return this.row(t, {
        developerUserId: r.submittedByUserId,
        qaUserId: r.reviewedByUserId,
        happenedAt: r.reviewedAt,
        rejections: decision === 'rejected' ? decisions.get(t.id)! : null,
        approvals: decision === 'approved' ? decisions.get(t.id)! : null,
      });
    });
  }

  // The QA Review list itself, so Waiting can never disagree with it.
  // "All" means every waiting task plus every QA's waiting defects.
  private async waitingRows(scope: Scope, currentUser: { id: number; role: UserRole }): Promise<QaSummaryRow[]> {
    const defectsFor = !scope.includeDefects
      ? undefined
      : scope.qaUserId === null
        ? { id: currentUser.id, role: UserRole.PROGRAM_MANAGER }
        : { id: scope.qaUserId, role: UserRole.QA };
    const { tasks } = await this.tasksService.findQaQueue(scope.tenantId, undefined, defectsFor);
    if (tasks.length === 0) return [];

    const rounds = await this.qaReviewsRepository
      .createQueryBuilder('r')
      .where("r.tenantId = :tenantId AND r.taskId IN (:...ids) AND r.reviewType = 'qa' AND r.status IN ('pending', 'rejected')", {
        tenantId: scope.tenantId,
        ids: tasks.map((t) => t.id),
      })
      .getMany();
    const pending = new Map<number, TaskQaReview>();
    const rejections = new Map<number, number>();
    for (const r of rounds) {
      if (r.status === 'pending') pending.set(r.taskId, r);
      else rejections.set(r.taskId, (rejections.get(r.taskId) || 0) + 1);
    }
    return tasks.map((t) => {
      const p = pending.get(t.id);
      return this.row(t, {
        developerUserId: t.assigneeUserId,
        qaUserId: t.isDefect ? t.createdByUserId : null,
        happenedAt: p?.submittedAt ?? t.updatedAt,
        round: p?.roundNumber ?? null,
        rejections: rejections.get(t.id) || 0,
      });
    });
  }

  private row(
    t: ProjectTask,
    extra: {
      developerUserId: number | null;
      qaUserId: number | null;
      happenedAt: Date;
      round?: number | null;
      rejections?: number | null;
      approvals?: number | null;
    },
  ): QaSummaryRow {
    return {
      id: t.id,
      title: t.title,
      isDefect: t.isDefect,
      projectId: t.projectId,
      projectName: t.projectName,
      moduleName: t.moduleName,
      developerUserId: extra.developerUserId ?? null,
      developerName: null,
      qaUserId: extra.qaUserId ?? null,
      qaName: null,
      happenedAt: extra.happenedAt,
      status: t.status,
      round: extra.round ?? null,
      rejections: extra.rejections ?? null,
      approvals: extra.approvals ?? null,
    };
  }

  // One batch lookup for every developer/QA name across all tiles.
  private async fillNames(rows: QaSummaryRow[], tenantId: number) {
    const ids = new Set<number>();
    for (const r of rows) {
      if (r.developerUserId != null) ids.add(r.developerUserId);
      if (r.qaUserId != null) ids.add(r.qaUserId);
    }
    if (ids.size === 0) return;
    const users = await this.usersService.findByIds([...ids], tenantId);
    const names = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    for (const r of rows) {
      if (r.developerUserId != null) r.developerName = names.get(r.developerUserId) || null;
      if (r.qaUserId != null) r.qaName = names.get(r.qaUserId) || null;
    }
  }
}

function optionalId(value: string | undefined, name: string): number | null {
  if (value === undefined || value === '' || value === 'all') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestException(`${name} must be a positive whole number.`);
  return n;
}
