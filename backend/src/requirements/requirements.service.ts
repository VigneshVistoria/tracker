import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { SrsDocument } from './entities/srs-document.entity';
import { SrsEpic } from './entities/srs-epic.entity';
import { SrsStory } from './entities/srs-story.entity';
import { SrsCriterion } from './entities/srs-criterion.entity';
import { SrsCriterionResult } from './entities/srs-criterion-result.entity';
import { SrsStoryTicket } from './entities/srs-story-ticket.entity';
import {
  CriterionResult,
  REQUIREMENTS_AUDIT,
  REQUIREMENTS_SETTINGS_ROLES,
  StoryFacts,
  averagePercent,
  canApprove,
  canCloseClientItems,
  canEditStory,
  canLinkTickets,
  canRecordClientSignOff,
  canRecordResults,
  canTakeClientSignOff,
  canWrite,
  isWorkingStory,
  showsAtRisk,
  canViewRequirements,
  failReasonProblem,
  isStoryDone,
  nextStoryStatus,
  resolveRequirementsTree,
  seesAllProjects,
  storyPercent,
  storyState,
  summaryStrip,
} from './requirements';
import { SaveCriterionResultDto, SaveRequirementsSettingsDto } from './dto/requirements.dto';

// Requirements traceability Stage 1 - see ./requirements.ts. Reads tickets,
// Blocker flags and dependency tickets; never writes to any of them.
@Injectable()
export class RequirementsService {
  constructor(
    @InjectRepository(TeamSettings) private teamSettingsRepository: Repository<TeamSettings>,
    @InjectRepository(SrsDocument) private srsRepository: Repository<SrsDocument>,
    @InjectRepository(SrsEpic) private epicsRepository: Repository<SrsEpic>,
    @InjectRepository(SrsStory) private storiesRepository: Repository<SrsStory>,
    @InjectRepository(SrsCriterion) private criteriaRepository: Repository<SrsCriterion>,
    @InjectRepository(SrsStoryTicket) private ticketsRepository: Repository<SrsStoryTicket>,
    private dataSource: DataSource,
    private auditLogService: AuditLogService,
  ) {}

  // ---- switch + access ----

  async isOn(tenantId: number): Promise<boolean> {
    const row = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    return resolveRequirementsTree(row?.requirementsTree);
  }

  async forMe(user: User, tenantId: number) {
    const on = await this.isOn(tenantId);
    return {
      on,
      canView: on && canViewRequirements(user.role),
      canRecordResults: on && canRecordResults(user.role),
      canManageSettings: REQUIREMENTS_SETTINGS_ROLES.includes(user.role),
      isBa: user.role === 'ba',
    };
  }

  // 404 (not 403) while the switch is OFF, so the feature does not exist.
  async assertOn(tenantId: number) {
    if (!(await this.isOn(tenantId))) throw new NotFoundException();
  }

  async assertViewer(user: User, tenantId: number) {
    await this.assertOn(tenantId);
    if (!canViewRequirements(user.role)) throw new ForbiddenException('You do not have access to Requirements.');
  }

  // Project ids this user may see, or null for "every project".
  async visibleProjectIds(user: User): Promise<number[] | null> {
    if (seesAllProjects(user.role)) return null;
    const rows: Array<{ projectsId: number }> = await this.dataSource.query(`SELECT "projectsId" FROM user_projects WHERE "usersId" = $1`, [user.id]);
    return rows.map((r) => Number(r.projectsId));
  }

  async loadVisibleSrs(srsId: number, user: User, tenantId: number): Promise<SrsDocument> {
    const srs = await this.srsRepository.findOne({ where: { id: srsId, tenantId, deletedAt: IsNull() } });
    if (!srs) throw new NotFoundException('SRS not found.');
    const visible = await this.visibleProjectIds(user);
    // Not on the project: same answer as "does not exist".
    if (visible && !visible.includes(srs.projectId)) throw new NotFoundException('SRS not found.');
    return srs;
  }

  // ---- settings ----

  private assertSettingsEditor(user: User) {
    if (!REQUIREMENTS_SETTINGS_ROLES.includes(user.role)) throw new ForbiddenException('Only Admin or Program Manager can change the Requirements setting.');
  }

  async settings(user: User, tenantId: number) {
    this.assertSettingsEditor(user);
    return { requirementsTree: await this.isOn(tenantId) };
  }

  async saveSettings(dto: SaveRequirementsSettingsDto, user: User, tenantId: number) {
    this.assertSettingsEditor(user);
    const before = await this.isOn(tenantId);
    const existing = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    if (existing) {
      await this.teamSettingsRepository.update({ tenantId }, { requirementsTree: dto.requirementsTree, updatedByUserId: user.id });
    } else {
      await this.teamSettingsRepository.save(this.teamSettingsRepository.create({ tenantId, requirementsTree: dto.requirementsTree, updatedByUserId: user.id }));
    }
    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: REQUIREMENTS_AUDIT.SETTINGS_UPDATED,
      tenantId,
      entityType: 'TeamSettings',
      entityId: tenantId,
      details: { before: { requirementsTree: before }, after: { requirementsTree: dto.requirementsTree } },
    });
    return this.settings(user, tenantId);
  }

  // ---- list ----

  async list(user: User, tenantId: number) {
    await this.assertViewer(user, tenantId);
    const visible = await this.visibleProjectIds(user);
    const params: any[] = [tenantId];
    let scope = '';
    if (visible) {
      if (!visible.length) return [];
      params.push(visible);
      scope = `AND d."projectId" = ANY($2)`;
    }
    const rows = await this.dataSource.query(
      `SELECT d.id, d.name, d.version, d.status, d."issuedOn", d."projectId", p.name AS "projectName"
         FROM srs_documents d JOIN projects p ON p.id = d."projectId"
        WHERE d."tenantId" = $1 AND d."deletedAt" IS NULL ${scope}
        ORDER BY p.name, d.name, d.version`,
      params,
    );
    return rows.map((r: any) => ({ ...r, issuedOn: dateOnly(r.issuedOn) }));
  }

  // ---- tree ----

  async tree(srsId: number, user: User, tenantId: number) {
    await this.assertViewer(user, tenantId);
    const srs = await this.loadVisibleSrs(srsId, user, tenantId);
    return this.buildTree(srs, user);
  }

  async buildTree(srs: SrsDocument, user: User) {
    const live = { srsId: srs.id, deletedAt: IsNull() };
    const [project, epics, stories, requirementCount] = await Promise.all([
      this.dataSource.query(`SELECT name FROM projects WHERE id = $1`, [srs.projectId]),
      this.epicsRepository.find({ where: live, order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.storiesRepository.find({ where: live, order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.dataSource.query(`SELECT count(*)::int AS n FROM srs_requirements WHERE "srsId" = $1 AND "deletedAt" IS NULL`, [srs.id]),
    ]);
    const storyIds = stories.map((s) => s.id);
    const [criteria, traces, links, reviewers] = await Promise.all([
      storyIds.length ? this.criteriaRepository.find({ where: { storyId: In(storyIds), deletedAt: IsNull() }, order: { position: 'ASC', id: 'ASC' } }) : [],
      storyIds.length
        ? this.dataSource.query(
            `SELECT l."storyId", r.code FROM srs_story_requirements l JOIN srs_requirements r ON r.id = l."requirementId"
              WHERE l."storyId" = ANY($1) AND r."deletedAt" IS NULL ORDER BY r."sortOrder", r.id`,
            [storyIds],
          )
        : [],
      storyIds.length
        ? this.dataSource.query(
            `SELECT st.id AS "linkId", st."storyId", st.kind, t.id AS "taskId", t.title, t.status, u."fullName" AS "assigneeName", t."assigneeEmail",
                    COALESCE((SELECT array_agg(tc."criterionId" ORDER BY tc."criterionId") FROM srs_ticket_criteria tc WHERE tc."storyTicketId" = st.id), '{}') AS "criterionIds"
               FROM srs_story_tickets st JOIN project_tasks t ON t.id = st."taskId"
               LEFT JOIN users u ON u.id = t."assigneeUserId"
              WHERE st."storyId" = ANY($1) AND t."tenantId" = $2
              ORDER BY st.kind, t.id`,
            [storyIds, srs.tenantId],
          )
        : [],
      srs.reviewerUserIds?.length ? this.dataSource.query(`SELECT id, "fullName", email FROM users WHERE id = ANY($1) AND "tenantId" = $2`, [srs.reviewerUserIds, srs.tenantId]) : [],
    ]);
    const clientItems: any[] = storyIds.length
      ? await this.dataSource.query(
          `SELECT l."storyId", i.id, i.number, i.question FROM srs_client_item_stories l JOIN srs_client_items i ON i.id = l."itemId"
            WHERE l."storyId" = ANY($1) AND i.status = 'open' AND i."deletedAt" IS NULL ORDER BY i.number`,
          [storyIds],
        )
      : [];
    const taskIds = [...new Set(links.map((l: any) => Number(l.taskId)))];
    const [blockers, dependencies] = taskIds.length
      ? await Promise.all([
          this.dataSource.query(`SELECT "taskId", reason FROM task_flags WHERE kind = 'blocker' AND "clearedAt" IS NULL AND "taskId" = ANY($1) ORDER BY "setAt"`, [taskIds]),
          this.dataSource.query(`SELECT "parentTaskId" AS "taskId", title FROM task_dependency_tickets WHERE status = 'open' AND "parentTaskId" = ANY($1) ORDER BY id`, [taskIds]),
        ])
      : [[], []];

    const by = <T>(rows: T[], key: (r: T) => number) => {
      const m = new Map<number, T[]>();
      for (const r of rows) m.set(key(r), [...(m.get(key(r)) || []), r]);
      return m;
    };
    const criteriaByStory = by(criteria, (c) => c.storyId);
    const tracesByStory = by(traces as any[], (t) => Number(t.storyId));
    const linksByStory = by(links as any[], (l) => Number(l.storyId));
    const blockersByTask = by(blockers as any[], (b) => Number(b.taskId));
    const depsByTask = by(dependencies as any[], (d) => Number(d.taskId));
    const clientItemsByStory = by(clientItems, (c) => Number(c.storyId));

    const storyNodes = stories.map((s) => {
      const cs = criteriaByStory.get(s.id) || [];
      const results = cs.map((c) => c.result as CriterionResult);
      const tickets = (linksByStory.get(s.id) || []).map((l: any) => ({
        linkId: Number(l.linkId),
        criterionIds: (l.criterionIds || []).map(Number),
        taskId: Number(l.taskId),
        trk: `TRK-${l.taskId}`,
        kind: l.kind,
        title: l.title,
        status: l.status,
        assignee: l.assigneeName || l.assigneeEmail || null,
      }));
      const storyTaskIds = [...new Set(tickets.map((t) => t.taskId))];
      const blockedBy = storyTaskIds.flatMap((id) => (blockersByTask.get(id) || []).map((b: any) => ({ trk: `TRK-${id}`, reason: b.reason })));
      const dependsOn = storyTaskIds.flatMap((id) => (depsByTask.get(id) || []).map((d: any) => ({ trk: `TRK-${id}`, title: d.title })));
      const openClientItems = (clientItemsByStory.get(s.id) || []).map((c: any) => ({ id: Number(c.id), number: Number(c.number), question: c.question }));
      // An open client item blocks its stories until it is closed (Stage 2).
      const facts: StoryFacts = { results, blocked: blockedBy.length > 0 || openClientItems.length > 0, dependency: dependsOn.length > 0, ticketCount: tickets.length };
      return {
        epicId: s.epicId,
        facts,
        node: {
          id: s.id,
          code: s.code,
          title: s.title,
          asA: s.asA,
          iWant: s.iWant,
          soThat: s.soThat,
          status: s.status,
          atRisk: showsAtRisk(s, srs.status),
          atRiskReason: s.atRisk ? s.atRiskReason : null,
          clientItems: openClientItems,
          canEdit: canEditStory(user.role, s.status),
          canRecordResults: canRecordResults(user.role) && isWorkingStory(s.status),
          canLinkTickets: canLinkTickets(user.role) && isWorkingStory(s.status),
          requirements: (tracesByStory.get(s.id) || []).map((t: any) => t.code),
          percent: storyPercent(results),
          passed: results.filter((r) => r === 'pass').length,
          total: results.length,
          state: storyState(facts),
          blockedBy,
          dependsOn,
          criteria: cs.map((c) => ({
            id: c.id,
            position: c.position,
            text: c.text,
            result: c.result,
            note: c.resultNote,
            resultAt: c.resultAt,
            beforeApproval: c.result !== 'not_run' && c.resultBeforeApproval,
          })),
          tickets,
        },
      };
    });

    const epicNodes = epics.map((e) => {
      const mine = storyNodes.filter((s) => s.epicId === e.id);
      return {
        id: e.id,
        code: e.code,
        name: e.name,
        srsSection: e.srsSection,
        percent: averagePercent(mine.map((s) => s.node.percent)),
        storiesDone: mine.filter((s) => isStoryDone(s.facts.results)).length,
        stories: mine.map((s) => s.node),
      };
    });
    const summary = summaryStrip(storyNodes.map((s) => s.facts));
    return {
      srs: {
        id: srs.id,
        name: srs.name,
        version: srs.version,
        status: srs.status,
        issuedOn: dateOnly(srs.issuedOn),
        projectId: srs.projectId,
        projectName: project[0]?.name ?? null,
        reviewers: (reviewers as any[]).map((r) => r.fullName || r.email),
        clientName: srs.clientName,
        clientSignedOn: dateOnly(srs.clientSignedOn),
        clientFileName: srs.clientFileName,
        requirementCount: requirementCount[0].n,
        epicCount: epics.length,
        storyCount: stories.length,
        percent: summary.percent,
        storiesDone: summary.storiesDone,
      },
      summary,
      epics: epicNodes,
      permissions: {
        canRecordResults: canRecordResults(user.role),
        canWrite: canWrite(user.role),
        canApprove: canApprove(user.role),
        canLinkTickets: canLinkTickets(user.role),
        canCloseClientItems: canCloseClientItems(user.role),
        canRecordClientSignOff: canRecordClientSignOff(user.role) && canTakeClientSignOff(srs.status),
      },
    };
  }

  // ---- Pass / Fail ----

  async saveResult(criterionId: number, dto: SaveCriterionResultDto, user: User, tenantId: number) {
    await this.assertViewer(user, tenantId);
    if (!canRecordResults(user.role)) throw new ForbiddenException('Only QA, Program Manager or Admin can record Pass/Fail.');
    const criterion = await this.criteriaRepository.findOne({ where: { id: criterionId, tenantId, deletedAt: IsNull() } });
    if (!criterion) throw new NotFoundException('Criterion not found.');
    const story = await this.storiesRepository.findOne({ where: { id: criterion.storyId, tenantId, deletedAt: IsNull() } });
    if (!story) throw new NotFoundException('Criterion not found.');
    // Sign-off locks the SRS text, not testing: results stay allowed.
    const srs = await this.loadVisibleSrs(story.srsId, user, tenantId);
    if (!isWorkingStory(story.status)) throw new BadRequestException('Only Approved stories can get Pass/Fail. Approve the story first.');
    let note: string | null = null;
    if (dto.result === 'fail') {
      const problem = failReasonProblem(dto.note);
      if (problem) throw new BadRequestException(problem);
      note = dto.note!.trim();
    }
    const beforeApproval = story.status === 'draft';
    const now = new Date();

    await this.dataSource.transaction(async (em) => {
      // Lock the story so two results at once can't both compute its status.
      await em.query(`SELECT id FROM srs_stories WHERE id = $1 FOR UPDATE`, [story.id]);
      await em.update(SrsCriterion, { id: criterion.id }, { result: dto.result, resultNote: note, resultByUserId: user.id, resultAt: now, resultBeforeApproval: beforeApproval, updatedAt: now });
      await em.insert(SrsCriterionResult, {
        tenantId,
        criterionId: criterion.id,
        storyId: story.id,
        result: dto.result,
        note,
        storyStatus: story.status,
        beforeApproval,
        recordedByUserId: user.id,
        recordedAt: now,
      });
      const results = (await em.find(SrsCriterion, { where: { storyId: story.id, deletedAt: IsNull() } })).map((c) => c.result as CriterionResult);
      const hasTickets = (await em.count(SrsStoryTicket, { where: { storyId: story.id } })) > 0;
      const status = nextStoryStatus(story.status, results, hasTickets);
      if (status !== story.status) await em.update(SrsStory, { id: story.id }, { status, updatedAt: now });
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: REQUIREMENTS_AUDIT.CRITERION_RESULT,
        tenantId,
        entityType: 'SrsCriterion',
        entityId: criterion.id,
        details: {
          srsId: srs.id,
          story: story.code,
          criterion: `AC${criterion.position}`,
          before: criterion.result,
          after: dto.result,
          note,
          beforeApproval,
          storyStatusBefore: story.status,
          storyStatusAfter: status,
        },
      });
    });
    return this.buildTree(srs, user);
  }
}

// Recomputes a story's status after its criteria, results or tickets
// changed (see nextStoryStatus). Call inside the transaction that changed them.
export async function recomputeStoryStatus(em: EntityManager, storyId: number): Promise<{ before: string; after: string }> {
  const [row] = await em.query(`SELECT status FROM srs_stories WHERE id = $1 FOR UPDATE`, [storyId]);
  const results = (await em.find(SrsCriterion, { where: { storyId, deletedAt: IsNull() } })).map((c) => c.result as CriterionResult);
  const hasTickets = (await em.count(SrsStoryTicket, { where: { storyId } })) > 0;
  const after = nextStoryStatus(row.status, results, hasTickets);
  if (after !== row.status) await em.update(SrsStory, { id: storyId }, { status: after, updatedAt: new Date() });
  return { before: row.status, after };
}

export { dateOnly };

// node-postgres returns DATE columns as a JS Date at local midnight; send
// the plain YYYY-MM-DD the database holds.
function dateOnly(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
