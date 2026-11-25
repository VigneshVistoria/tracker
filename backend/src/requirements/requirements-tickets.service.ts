import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { SrsDocument } from './entities/srs-document.entity';
import { SrsStory } from './entities/srs-story.entity';
import { SrsStoryTicket } from './entities/srs-story-ticket.entity';
import { SrsTicketCriterion } from './entities/srs-ticket-criterion.entity';
import { REQUIREMENTS_AUDIT, TicketKind, canLinkTickets, isWorkingStory, parseTrk, suggestStories } from './requirements';
import { RequirementsService, recomputeStoryStatus } from './requirements.service';
import { LinkTicketDto, MapTicketsDto, MapTicketsQueryDto, MoveTicketDto } from './dto/requirements.dto';

// Requirements traceability Stage 2 - linking Tracker tickets to stories
// (PM/Admin). Only tickets of the SRS's own project, never Junk, and only
// Approved / In progress / Done stories. Linking reads project_tasks and
// NEVER writes to it - status, hours, assignee and every performance
// figure are untouched. Suggestions come from a ticket's "Requirement ID"
// and are only ever confirmed by the PM.
const JUNK = 'Junk';
const MAP_LIMIT = 300;

@Injectable()
export class RequirementsTicketsService {
  constructor(
    private requirements: RequirementsService,
    private dataSource: DataSource,
    private auditLogService: AuditLogService,
  ) {}

  private audit(em: EntityManager, user: User, tenantId: number, action: string, entityId: number, details: Record<string, unknown>) {
    return this.auditLogService.recordWithin(em, { userId: user.id, userEmail: user.email, userRole: user.role, action, tenantId, entityType: 'SrsStoryTicket', entityId, details });
  }

  private assertLinker(user: User) {
    if (!canLinkTickets(user.role)) throw new ForbiddenException('Only a Program Manager or Admin can link tickets.');
  }

  private async workingStory(em: EntityManager | DataSource, storyId: number, tenantId: number, user: User): Promise<{ story: SrsStory; srs: SrsDocument }> {
    const story = await em.getRepository(SrsStory).findOne({ where: { id: storyId, tenantId } });
    if (!story || story.deletedAt) throw new NotFoundException('Story not found.');
    const srs = await this.requirements.loadVisibleSrs(story.srsId, user, tenantId);
    if (!isWorkingStory(story.status)) throw new BadRequestException('Tickets can be linked only to Approved, In progress or Done stories.');
    return { story, srs };
  }

  // A ticket that may be linked to this SRS: same tenant + project, not Junk.
  private async eligibleTask(em: EntityManager | DataSource, taskId: number, srs: SrsDocument) {
    const [task] = await em.query(
      `SELECT t.id, t.title, t.status, t."projectId", t."isDefect", t."requirementId", u."fullName" AS "assigneeName", t."assigneeEmail"
         FROM project_tasks t LEFT JOIN users u ON u.id = t."assigneeUserId"
        WHERE t.id = $1 AND t."tenantId" = $2`,
      [taskId, srs.tenantId],
    );
    if (!task) throw new NotFoundException(`TRK-${taskId} not found.`);
    if (Number(task.projectId) !== srs.projectId) throw new BadRequestException(`TRK-${taskId} is not in this SRS's project.`);
    if (task.status === JUNK) throw new BadRequestException(`TRK-${taskId} is in Junk.`);
    return task;
  }

  private async checkCriteria(em: EntityManager, storyId: number, ids: number[] | undefined): Promise<number[]> {
    const unique = [...new Set(ids ?? [])];
    if (!unique.length) return [];
    const found = await em.query(`SELECT id FROM srs_criteria WHERE "storyId" = $1 AND id = ANY($2) AND "deletedAt" IS NULL`, [storyId, unique]);
    if (found.length !== unique.length) throw new BadRequestException('Some criteria are not on this story.');
    return unique;
  }

  // ---- story page: find a ticket by TRK number ----

  async lookup(storyId: number, trk: string, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    this.assertLinker(user);
    const { srs } = await this.workingStory(this.dataSource, storyId, tenantId, user);
    const taskId = parseTrk(trk);
    if (!taskId) throw new BadRequestException('Type a TRK number, e.g. TRK-123.');
    const task = await this.eligibleTask(this.dataSource, taskId, srs);
    const links = await this.dataSource.query(
      `SELECT st.kind, s.code FROM srs_story_tickets st JOIN srs_stories s ON s.id = st."storyId" WHERE st."taskId" = $1 AND s."deletedAt" IS NULL ORDER BY s.code, st.kind`,
      [taskId],
    );
    return { taskId, trk: `TRK-${taskId}`, title: task.title, status: task.status, isDefect: task.isDefect, assignee: task.assigneeName || task.assigneeEmail || null, links };
  }

  // ---- link / unlink / move ----

  private async linkWithin(em: EntityManager, story: SrsStory, taskId: number, kinds: TicketKind[], criterionIds: number[], user: User, tenantId: number) {
    const created: Array<{ id: number; kind: TicketKind }> = [];
    for (const kind of [...new Set(kinds)]) {
      const exists = await em.findOne(SrsStoryTicket, { where: { storyId: story.id, taskId, kind } });
      if (exists) continue;
      const link = await em.save(em.create(SrsStoryTicket, { tenantId, storyId: story.id, taskId, kind, linkedByUserId: user.id, linkedAt: new Date() }));
      if (criterionIds.length) await em.insert(SrsTicketCriterion, criterionIds.map((criterionId) => ({ storyTicketId: link.id, criterionId })));
      created.push({ id: link.id, kind });
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.TICKET_LINKED, link.id, { story: story.code, trk: `TRK-${taskId}`, kind, criterionIds });
    }
    return created;
  }

  async link(storyId: number, dto: LinkTicketDto, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    this.assertLinker(user);
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_stories WHERE id = $1 FOR UPDATE`, [storyId]);
      const { story, srs } = await this.workingStory(em, storyId, tenantId, user);
      await this.eligibleTask(em, dto.taskId, srs);
      const criterionIds = await this.checkCriteria(em, story.id, dto.criterionIds);
      const created = await this.linkWithin(em, story, dto.taskId, dto.kinds, criterionIds, user, tenantId);
      if (!created.length) throw new ConflictException(`TRK-${dto.taskId} is already linked to ${story.code} as ${dto.kinds.map((k) => k.toUpperCase()).join(' and ')}.`);
      const status = await recomputeStoryStatus(em, story.id);
      return { created, storyStatus: status.after };
    });
  }

  private async loadLink(em: EntityManager, linkId: number, tenantId: number, user: User) {
    await em.query(`SELECT id FROM srs_story_tickets WHERE id = $1 FOR UPDATE`, [linkId]);
    const link = await em.findOne(SrsStoryTicket, { where: { id: linkId, tenantId } });
    if (!link) throw new NotFoundException('Link not found.');
    const story = await em.findOne(SrsStory, { where: { id: link.storyId, tenantId } });
    if (!story) throw new NotFoundException('Link not found.');
    const srs = await this.requirements.loadVisibleSrs(story.srsId, user, tenantId);
    return { link, story, srs };
  }

  async unlink(linkId: number, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    this.assertLinker(user);
    return this.dataSource.transaction(async (em) => {
      const { link, story } = await this.loadLink(em, linkId, tenantId, user);
      const covered = (await em.find(SrsTicketCriterion, { where: { storyTicketId: link.id } })).map((c) => c.criterionId);
      await em.delete(SrsStoryTicket, { id: link.id }); // its criteria go with it (ON DELETE CASCADE)
      const status = await recomputeStoryStatus(em, story.id);
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.TICKET_UNLINKED, link.id, { story: story.code, trk: `TRK-${link.taskId}`, kind: link.kind, criterionIds: covered, storyStatus: status });
      return { id: link.id, storyStatus: status.after };
    });
  }

  // Moves one link (one kind) to another working story of the same SRS. The
  // criteria it covered belonged to the old story, so they are dropped.
  async move(linkId: number, dto: MoveTicketDto, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    this.assertLinker(user);
    return this.dataSource.transaction(async (em) => {
      const { link, story, srs } = await this.loadLink(em, linkId, tenantId, user);
      if (dto.storyId === story.id) throw new BadRequestException('The ticket is already on this story.');
      await em.query(`SELECT id FROM srs_stories WHERE id = $1 FOR UPDATE`, [dto.storyId]);
      const target = await this.workingStory(em, dto.storyId, tenantId, user);
      if (target.srs.id !== srs.id) throw new BadRequestException('A ticket can only move to a story in the same SRS.');
      const clash = await em.findOne(SrsStoryTicket, { where: { storyId: target.story.id, taskId: link.taskId, kind: link.kind } });
      if (clash) throw new ConflictException(`TRK-${link.taskId} is already linked to ${target.story.code} as ${link.kind.toUpperCase()}.`);
      const covered = (await em.find(SrsTicketCriterion, { where: { storyTicketId: link.id } })).map((c) => c.criterionId);
      await em.delete(SrsTicketCriterion, { storyTicketId: link.id });
      await em.update(SrsStoryTicket, { id: link.id }, { storyId: target.story.id, linkedByUserId: user.id, linkedAt: new Date() });
      const from = await recomputeStoryStatus(em, story.id);
      const to = await recomputeStoryStatus(em, target.story.id);
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.TICKET_MOVED, link.id, {
        trk: `TRK-${link.taskId}`,
        kind: link.kind,
        from: story.code,
        to: target.story.code,
        droppedCriterionIds: covered,
        fromStatus: from,
        toStatus: to,
      });
      return { id: link.id, storyId: target.story.id };
    });
  }

  // ---- map existing tickets ----

  private async srsForMapping(srsId: number, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    this.assertLinker(user);
    return this.requirements.loadVisibleSrs(srsId, user, tenantId);
  }

  // Tickets of the SRS's project (never Junk) with their current links.
  async mapTickets(srsId: number, query: MapTicketsQueryDto, user: User, tenantId: number) {
    const srs = await this.srsForMapping(srsId, user, tenantId);
    const params: any[] = [srs.tenantId, srs.projectId, JUNK, srs.id];
    const where: string[] = [];
    const trk = query.q ? parseTrk(query.q) : null;
    if (trk) {
      params.push(trk);
      where.push(`t.id = $${params.length}`);
    } else if (query.q?.trim()) {
      params.push(`%${query.q.trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      where.push(`(t.title ILIKE $${params.length} OR t."requirementId" ILIKE $${params.length})`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`t.status = $${params.length}`);
    }
    if (query.assigneeUserId) {
      params.push(query.assigneeUserId);
      where.push(`t."assigneeUserId" = $${params.length}`);
    }
    if (query.mapped === 'mapped') where.push(`EXISTS (SELECT 1 FROM srs_story_tickets x JOIN srs_stories xs ON xs.id = x."storyId" WHERE x."taskId" = t.id AND xs."srsId" = $4 AND xs."deletedAt" IS NULL)`);
    if (query.mapped === 'unmapped') where.push(`NOT EXISTS (SELECT 1 FROM srs_story_tickets x JOIN srs_stories xs ON xs.id = x."storyId" WHERE x."taskId" = t.id AND xs."srsId" = $4 AND xs."deletedAt" IS NULL)`);
    const rows = await this.dataSource.query(
      `SELECT t.id AS "taskId", t.title, t.status, t."isDefect", t."requirementId", t."assigneeUserId", u."fullName" AS "assigneeName", t."assigneeEmail",
              COALESCE((SELECT json_agg(json_build_object('linkId', x.id, 'storyId', xs.id, 'code', xs.code, 'kind', x.kind) ORDER BY xs.code, x.kind)
                          FROM srs_story_tickets x JOIN srs_stories xs ON xs.id = x."storyId"
                         WHERE x."taskId" = t.id AND xs."srsId" = $4 AND xs."deletedAt" IS NULL), '[]') AS links
         FROM project_tasks t LEFT JOIN users u ON u.id = t."assigneeUserId"
        WHERE t."tenantId" = $1 AND t."projectId" = $2 AND t.status <> $3 ${where.map((w) => `AND ${w}`).join(' ')}
        ORDER BY t.id DESC LIMIT ${MAP_LIMIT + 1}`,
      params,
    );
    const [statuses, assignees] = await Promise.all([
      this.dataSource.query(`SELECT DISTINCT status FROM project_tasks WHERE "tenantId" = $1 AND "projectId" = $2 AND status <> $3 ORDER BY status`, [srs.tenantId, srs.projectId, JUNK]),
      this.dataSource.query(
        `SELECT DISTINCT u.id, u."fullName", u.email FROM project_tasks t JOIN users u ON u.id = t."assigneeUserId"
          WHERE t."tenantId" = $1 AND t."projectId" = $2 AND t.status <> $3 ORDER BY u."fullName"`,
        [srs.tenantId, srs.projectId, JUNK],
      ),
    ]);
    return {
      tickets: rows.slice(0, MAP_LIMIT).map((r: any) => ({
        taskId: Number(r.taskId),
        trk: `TRK-${r.taskId}`,
        title: r.title,
        status: r.status,
        isDefect: r.isDefect,
        requirementId: r.requirementId,
        assignee: r.assigneeName || r.assigneeEmail || null,
        links: r.links,
      })),
      truncated: rows.length > MAP_LIMIT,
      limit: MAP_LIMIT,
      statuses: statuses.map((s: any) => s.status),
      assignees: assignees.map((a: any) => ({ id: a.id, name: a.fullName || a.email })),
    };
  }

  // Tickets whose "Requirement ID" names a working story (US-03) or a
  // requirement it traces (LN-10), not linked to that story yet.
  async suggestions(srsId: number, user: User, tenantId: number) {
    const srs = await this.srsForMapping(srsId, user, tenantId);
    const stories: Array<{ id: number; code: string; title: string; requirements: string[] }> = await this.dataSource.query(
      `SELECT s.id, s.code, s.title, COALESCE(array_agg(r.code) FILTER (WHERE r.id IS NOT NULL AND r."deletedAt" IS NULL), '{}') AS requirements
         FROM srs_stories s LEFT JOIN srs_story_requirements l ON l."storyId" = s.id LEFT JOIN srs_requirements r ON r.id = l."requirementId"
        WHERE s."srsId" = $1 AND s."deletedAt" IS NULL AND s.status IN ('approved', 'in_progress', 'done')
        GROUP BY s.id ORDER BY s."sortOrder"`,
      [srs.id],
    );
    if (!stories.length) return { suggestions: [] };
    const tasks = await this.dataSource.query(
      `SELECT t.id, t.title, t.status, t."requirementId", u."fullName" AS "assigneeName", t."assigneeEmail"
         FROM project_tasks t LEFT JOIN users u ON u.id = t."assigneeUserId"
        WHERE t."tenantId" = $1 AND t."projectId" = $2 AND t.status <> $3 AND coalesce(btrim(t."requirementId"), '') <> ''
        ORDER BY t.id DESC`,
      [srs.tenantId, srs.projectId, JUNK],
    );
    const linked = new Set(
      (await this.dataSource.query(`SELECT DISTINCT x."taskId", x."storyId" FROM srs_story_tickets x JOIN srs_stories s ON s.id = x."storyId" WHERE s."srsId" = $1`, [srs.id])).map(
        (r: any) => `${r.taskId}:${r.storyId}`,
      ),
    );
    const suggestions = tasks
      .map((t: any) => ({
        taskId: Number(t.id),
        trk: `TRK-${t.id}`,
        title: t.title,
        status: t.status,
        requirementId: t.requirementId,
        assignee: t.assigneeName || t.assigneeEmail || null,
        stories: suggestStories(t.requirementId, stories)
          .filter((m) => !linked.has(`${t.id}:${m.story.id}`))
          .map((m) => ({ id: m.story.id, code: m.story.code, title: m.story.title, via: m.via })),
      }))
      .filter((s: any) => s.stories.length);
    return { suggestions };
  }

  // Many tickets -> one working story, as Dev and/or QA, optionally with the
  // criteria they cover. Already-linked kinds are skipped and reported.
  async map(srsId: number, dto: MapTicketsDto, user: User, tenantId: number) {
    const srs = await this.srsForMapping(srsId, user, tenantId);
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_stories WHERE id = $1 FOR UPDATE`, [dto.storyId]);
      const { story } = await this.workingStory(em, dto.storyId, tenantId, user);
      if (story.srsId !== srs.id) throw new BadRequestException('The story must be in this SRS.');
      const criterionIds = await this.checkCriteria(em, story.id, dto.criterionIds);
      const linked: string[] = [];
      const skipped: string[] = [];
      for (const taskId of [...new Set(dto.taskIds)]) {
        await this.eligibleTask(em, taskId, srs);
        const created = await this.linkWithin(em, story, taskId, dto.kinds, criterionIds, user, tenantId);
        for (const kind of dto.kinds) {
          const label = `TRK-${taskId} (${kind.toUpperCase()})`;
          if (created.some((c) => c.kind === kind)) linked.push(label);
          else skipped.push(label);
        }
      }
      const status = await recomputeStoryStatus(em, story.id);
      return { story: story.code, linked, skipped, storyStatus: status.after };
    });
  }
}
