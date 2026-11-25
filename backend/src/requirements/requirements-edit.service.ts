import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { SrsDocument } from './entities/srs-document.entity';
import { SrsEpic } from './entities/srs-epic.entity';
import { SrsStory } from './entities/srs-story.entity';
import { SrsCriterion } from './entities/srs-criterion.entity';
import { SrsStoryRequirement } from './entities/srs-story-requirement.entity';
import {
  AT_RISK_REASON_MIN,
  REQUIREMENTS_AUDIT,
  canApprove,
  canEditStory,
  canWrite,
  isClientSigned,
  minTextProblem,
  nextCode,
} from './requirements';
import { RequirementsService, recomputeStoryStatus } from './requirements.service';
import { ApproveAtRiskDto, CreateCriterionDto, CreateEpicDto, CreateStoryDto, ReorderCriteriaDto, UpdateCriterionDto, UpdateEpicDto, UpdateStoryDto } from './dto/requirements.dto';

// Requirements traceability Stage 2 - epics, user stories, acceptance
// criteria and story approval. Roles (requirements.ts): BA/PM/Admin write
// (BA only on Draft stories), PM/Admin approve. Soft delete only, refused
// while a story has linked tickets or any Pass/Fail result. Everything is
// audited.
@Injectable()
export class RequirementsEditService {
  constructor(
    private requirements: RequirementsService,
    private dataSource: DataSource,
    private auditLogService: AuditLogService,
  ) {}

  private audit(em: EntityManager, user: User, tenantId: number, action: string, entityType: string, entityId: number, details: Record<string, unknown>) {
    return this.auditLogService.recordWithin(em, { userId: user.id, userEmail: user.email, userRole: user.role, action, tenantId, entityType, entityId, details });
  }

  private assertWriter(user: User) {
    if (!canWrite(user.role)) throw new ForbiddenException('Only BA, Program Manager or Admin can change requirements.');
  }

  private async srsForWrite(srsId: number, user: User, tenantId: number): Promise<SrsDocument> {
    await this.requirements.assertViewer(user, tenantId);
    this.assertWriter(user);
    return this.requirements.loadVisibleSrs(srsId, user, tenantId);
  }

  private async liveEpic(em: EntityManager, epicId: number, tenantId: number): Promise<SrsEpic> {
    const epic = await em.findOne(SrsEpic, { where: { id: epicId, tenantId, deletedAt: IsNull() } });
    if (!epic) throw new NotFoundException('Epic not found.');
    return epic;
  }

  // The story, its SRS (visible to this user), switch + view checked.
  async loadStory(storyId: number, user: User, tenantId: number): Promise<{ story: SrsStory; srs: SrsDocument }> {
    await this.requirements.assertViewer(user, tenantId);
    const story = await this.dataSource.getRepository(SrsStory).findOne({ where: { id: storyId, tenantId, deletedAt: IsNull() } });
    if (!story) throw new NotFoundException('Story not found.');
    const srs = await this.requirements.loadVisibleSrs(story.srsId, user, tenantId);
    return { story, srs };
  }

  private assertCanEditStory(user: User, story: SrsStory) {
    this.assertWriter(user);
    if (!canEditStory(user.role, story.status)) throw new ForbiddenException('Only a Program Manager or Admin can change an approved story.');
  }

  // Requirement ids must be live requirements of this SRS.
  private async checkRequirements(em: EntityManager, srsId: number, ids: number[]): Promise<number[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const found = await em.query(`SELECT id FROM srs_requirements WHERE "srsId" = $1 AND id = ANY($2) AND "deletedAt" IS NULL`, [srsId, unique]);
    if (found.length !== unique.length) throw new BadRequestException('Some requirement IDs are not in this SRS.');
    return unique;
  }

  private async requirementCodes(em: EntityManager, ids: number[]): Promise<string[]> {
    if (!ids.length) return [];
    return (await em.query(`SELECT code FROM srs_requirements WHERE id = ANY($1) ORDER BY "sortOrder", id`, [ids])).map((r: any) => r.code);
  }

  // A story with linked tickets or any Pass/Fail ever recorded is kept.
  private async assertStoryDeletable(em: EntityManager, storyId: number) {
    const [{ tickets }] = await em.query(`SELECT count(*)::int AS tickets FROM srs_story_tickets WHERE "storyId" = $1`, [storyId]);
    if (tickets > 0) throw new ConflictException('This story has linked tickets - unlink them first.');
    const [{ results }] = await em.query(`SELECT count(*)::int AS results FROM srs_criterion_results WHERE "storyId" = $1`, [storyId]);
    if (results > 0) throw new ConflictException('This story has Pass/Fail results, so it is kept for the record.');
  }

  // ---- requirements list (pickers) ----

  async requirementsList(srsId: number, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    const srs = await this.requirements.loadVisibleSrs(srsId, user, tenantId);
    return this.dataSource.query(`SELECT id, code, text, priority FROM srs_requirements WHERE "srsId" = $1 AND "deletedAt" IS NULL ORDER BY "sortOrder", id`, [srs.id]);
  }

  // ---- epics ----

  async createEpic(srsId: number, dto: CreateEpicDto, user: User, tenantId: number) {
    const srs = await this.srsForWrite(srsId, user, tenantId);
    const now = new Date();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_documents WHERE id = $1 FOR UPDATE`, [srs.id]);
      const all: Array<{ code: string; sortOrder: number }> = await em.query(`SELECT code, "sortOrder" FROM srs_epics WHERE "srsId" = $1`, [srs.id]);
      const code = nextCode('E', all.map((e) => e.code));
      const sortOrder = all.reduce((m, e) => Math.max(m, e.sortOrder), 0) + 1;
      const saved = await em.save(em.create(SrsEpic, { tenantId, srsId: srs.id, code, name: dto.name.trim(), srsSection: dto.srsSection?.trim() || null, sortOrder, createdAt: now, updatedAt: now }));
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.EPIC_CREATED, 'SrsEpic', saved.id, { srsId: srs.id, code, name: saved.name, srsSection: saved.srsSection });
      return { id: saved.id, code };
    });
  }

  async updateEpic(epicId: number, dto: UpdateEpicDto, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    this.assertWriter(user);
    return this.dataSource.transaction(async (em) => {
      const epic = await this.liveEpic(em, epicId, tenantId);
      await this.requirements.loadVisibleSrs(epic.srsId, user, tenantId);
      const before = { name: epic.name, srsSection: epic.srsSection };
      const after = { name: dto.name !== undefined ? dto.name.trim() : epic.name, srsSection: dto.srsSection !== undefined ? dto.srsSection.trim() || null : epic.srsSection };
      await em.update(SrsEpic, { id: epic.id }, { ...after, updatedAt: new Date() });
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.EPIC_UPDATED, 'SrsEpic', epic.id, { code: epic.code, before, after });
      return { id: epic.id };
    });
  }

  async deleteEpic(epicId: number, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    this.assertWriter(user);
    return this.dataSource.transaction(async (em) => {
      const epic = await this.liveEpic(em, epicId, tenantId);
      await this.requirements.loadVisibleSrs(epic.srsId, user, tenantId);
      const [{ n }] = await em.query(`SELECT count(*)::int AS n FROM srs_stories WHERE "epicId" = $1 AND "deletedAt" IS NULL`, [epic.id]);
      if (n > 0) throw new ConflictException('This epic still has stories - move or delete them first.');
      await em.update(SrsEpic, { id: epic.id }, { deletedAt: new Date(), deletedByUserId: user.id });
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.EPIC_DELETED, 'SrsEpic', epic.id, { code: epic.code, name: epic.name });
      return { id: epic.id };
    });
  }

  // ---- stories ----

  async createStory(epicId: number, dto: CreateStoryDto, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    this.assertWriter(user);
    const now = new Date();
    return this.dataSource.transaction(async (em) => {
      const epic = await this.liveEpic(em, epicId, tenantId);
      const srs = await this.requirements.loadVisibleSrs(epic.srsId, user, tenantId);
      await em.query(`SELECT id FROM srs_documents WHERE id = $1 FOR UPDATE`, [srs.id]);
      const reqIds = await this.checkRequirements(em, srs.id, dto.requirementIds ?? []);
      const all: Array<{ code: string; sortOrder: number }> = await em.query(`SELECT code, "sortOrder" FROM srs_stories WHERE "srsId" = $1`, [srs.id]);
      const code = nextCode('US', all.map((s) => s.code));
      const sortOrder = all.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1;
      const story = await em.save(
        em.create(SrsStory, {
          tenantId,
          srsId: srs.id,
          epicId: epic.id,
          code,
          title: dto.title.trim(),
          asA: dto.asA?.trim() || null,
          iWant: dto.iWant?.trim() || null,
          soThat: dto.soThat?.trim() || null,
          status: 'draft',
          sortOrder,
          createdByUserId: user.id,
          createdAt: now,
          updatedAt: now,
        }),
      );
      if (reqIds.length) await em.insert(SrsStoryRequirement, reqIds.map((requirementId) => ({ storyId: story.id, requirementId })));
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.STORY_CREATED, 'SrsStory', story.id, {
        srsId: srs.id,
        code,
        epic: epic.code,
        title: story.title,
        requirements: await this.requirementCodes(em, reqIds),
      });
      return { id: story.id, code };
    });
  }

  async updateStory(storyId: number, dto: UpdateStoryDto, user: User, tenantId: number) {
    const { story, srs } = await this.loadStory(storyId, user, tenantId);
    this.assertCanEditStory(user, story);
    return this.dataSource.transaction(async (em) => {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const patch: Partial<SrsStory> = {};
      const text = (k: 'title' | 'asA' | 'iWant' | 'soThat', v: string | undefined) => {
        if (v === undefined) return;
        const next = k === 'title' ? v.trim() : v.trim() || null;
        if (next !== story[k]) {
          before[k] = story[k];
          after[k] = next;
          (patch as any)[k] = next;
        }
      };
      text('title', dto.title);
      text('asA', dto.asA);
      text('iWant', dto.iWant);
      text('soThat', dto.soThat);
      if (dto.epicId !== undefined && dto.epicId !== story.epicId) {
        const epic = await this.liveEpic(em, dto.epicId, tenantId);
        if (epic.srsId !== srs.id) throw new BadRequestException('The epic must be in the same SRS.');
        const old = await em.findOne(SrsEpic, { where: { id: story.epicId } });
        before.epic = old?.code;
        after.epic = epic.code;
        patch.epicId = epic.id;
      }
      if (dto.requirementIds !== undefined) {
        const ids = await this.checkRequirements(em, srs.id, dto.requirementIds);
        const current = (await em.find(SrsStoryRequirement, { where: { storyId: story.id } })).map((r) => r.requirementId);
        const same = current.length === ids.length && current.every((id) => ids.includes(id));
        if (!same) {
          before.requirements = await this.requirementCodes(em, current);
          after.requirements = await this.requirementCodes(em, ids);
          await em.delete(SrsStoryRequirement, { storyId: story.id });
          if (ids.length) await em.insert(SrsStoryRequirement, ids.map((requirementId) => ({ storyId: story.id, requirementId })));
        }
      }
      if (!Object.keys(after).length) return { id: story.id, changed: false };
      if (Object.keys(patch).length) await em.update(SrsStory, { id: story.id }, { ...patch, updatedAt: new Date() });
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.STORY_UPDATED, 'SrsStory', story.id, { code: story.code, status: story.status, before, after });
      return { id: story.id, changed: true };
    });
  }

  async deleteStory(storyId: number, user: User, tenantId: number) {
    const { story } = await this.loadStory(storyId, user, tenantId);
    this.assertCanEditStory(user, story);
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_stories WHERE id = $1 FOR UPDATE`, [story.id]);
      await this.assertStoryDeletable(em, story.id);
      await em.update(SrsStory, { id: story.id }, { deletedAt: new Date(), deletedByUserId: user.id });
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.STORY_DELETED, 'SrsStory', story.id, { code: story.code, title: story.title, status: story.status });
      return { id: story.id };
    });
  }

  // Approve: PM/Admin, Draft stories, only once the SRS is client-signed.
  async approve(storyId: number, user: User, tenantId: number) {
    const { story, srs } = await this.loadStory(storyId, user, tenantId);
    if (!canApprove(user.role)) throw new ForbiddenException('Only a Program Manager or Admin can approve stories.');
    if (story.status !== 'draft') throw new BadRequestException('Only a Draft story can be approved.');
    if (!isClientSigned(srs.status)) throw new BadRequestException('The SRS is not signed off by the client yet. Record the client sign-off first, or use "Approve at risk" with a reason.');
    return this.approveWithin(story, user, tenantId, null);
  }

  // Approve at risk: PM/Admin, before client sign-off, reason required.
  async approveAtRisk(storyId: number, dto: ApproveAtRiskDto, user: User, tenantId: number) {
    const { story, srs } = await this.loadStory(storyId, user, tenantId);
    if (!canApprove(user.role)) throw new ForbiddenException('Only a Program Manager or Admin can approve stories.');
    if (story.status !== 'draft') throw new BadRequestException('Only a Draft story can be approved.');
    if (isClientSigned(srs.status)) throw new BadRequestException('The SRS is already signed off by the client - use Approve.');
    const problem = minTextProblem(dto.reason, AT_RISK_REASON_MIN, 'a reason');
    if (problem) throw new BadRequestException(problem);
    return this.approveWithin(story, user, tenantId, dto.reason.trim());
  }

  private approveWithin(story: SrsStory, user: User, tenantId: number, atRiskReason: string | null) {
    const now = new Date();
    return this.dataSource.transaction(async (em) => {
      const [row] = await em.query(`SELECT status FROM srs_stories WHERE id = $1 FOR UPDATE`, [story.id]);
      if (row.status !== 'draft') throw new BadRequestException('Only a Draft story can be approved.');
      await em.update(SrsStory, { id: story.id }, {
        status: 'approved',
        approvedByUserId: user.id,
        approvedAt: now,
        updatedAt: now,
        ...(atRiskReason ? { atRisk: true, atRiskReason, atRiskByUserId: user.id, atRiskAt: now } : {}),
      });
      // Results recorded before approval, or tickets, move it on at once.
      const { after } = await recomputeStoryStatus(em, story.id);
      await this.audit(em, user, tenantId, atRiskReason ? REQUIREMENTS_AUDIT.STORY_APPROVED_AT_RISK : REQUIREMENTS_AUDIT.STORY_APPROVED, 'SrsStory', story.id, {
        code: story.code,
        status: after,
        ...(atRiskReason ? { reason: atRiskReason } : {}),
      });
      return { id: story.id, status: after, atRisk: !!atRiskReason };
    });
  }

  // ---- criteria ----

  private async liveCriteria(em: EntityManager, storyId: number) {
    return em.find(SrsCriterion, { where: { storyId, deletedAt: IsNull() }, order: { position: 'ASC', id: 'ASC' } });
  }

  async createCriterion(storyId: number, dto: CreateCriterionDto, user: User, tenantId: number) {
    const { story } = await this.loadStory(storyId, user, tenantId);
    this.assertCanEditStory(user, story);
    const now = new Date();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_stories WHERE id = $1 FOR UPDATE`, [story.id]);
      const live = await this.liveCriteria(em, story.id);
      const position = live.length + 1;
      const saved = await em.save(em.create(SrsCriterion, { tenantId, storyId: story.id, position, text: dto.text.trim(), result: 'not_run', createdAt: now, updatedAt: now }));
      // A new, untested criterion means a Done story is no longer done.
      const status = await recomputeStoryStatus(em, story.id);
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.CRITERION_CREATED, 'SrsCriterion', saved.id, { story: story.code, criterion: `AC${position}`, text: saved.text, storyStatus: status });
      return { id: saved.id, position };
    });
  }

  // Changing the text of a tested criterion resets it to Not run; the old
  // result stays in srs_criterion_results (append-only).
  async updateCriterion(criterionId: number, dto: UpdateCriterionDto, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    const criterion = await this.dataSource.getRepository(SrsCriterion).findOne({ where: { id: criterionId, tenantId, deletedAt: IsNull() } });
    if (!criterion) throw new NotFoundException('Criterion not found.');
    const { story } = await this.loadStory(criterion.storyId, user, tenantId);
    this.assertCanEditStory(user, story);
    const text = dto.text.trim();
    if (text === criterion.text) return { id: criterion.id, changed: false, reset: false };
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_stories WHERE id = $1 FOR UPDATE`, [story.id]);
      const reset = criterion.result !== 'not_run';
      await em.update(SrsCriterion, { id: criterion.id }, {
        text,
        updatedAt: new Date(),
        ...(reset ? { result: 'not_run', resultNote: null, resultByUserId: null, resultAt: null, resultBeforeApproval: false } : {}),
      });
      const status = await recomputeStoryStatus(em, story.id);
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.CRITERION_UPDATED, 'SrsCriterion', criterion.id, {
        story: story.code,
        criterion: `AC${criterion.position}`,
        before: criterion.text,
        after: text,
        ...(reset ? { resultReset: criterion.result } : {}),
        storyStatus: status,
      });
      return { id: criterion.id, changed: true, reset };
    });
  }

  async deleteCriterion(criterionId: number, user: User, tenantId: number) {
    await this.requirements.assertViewer(user, tenantId);
    const criterion = await this.dataSource.getRepository(SrsCriterion).findOne({ where: { id: criterionId, tenantId, deletedAt: IsNull() } });
    if (!criterion) throw new NotFoundException('Criterion not found.');
    const { story } = await this.loadStory(criterion.storyId, user, tenantId);
    this.assertCanEditStory(user, story);
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_stories WHERE id = $1 FOR UPDATE`, [story.id]);
      const [{ results }] = await em.query(`SELECT count(*)::int AS results FROM srs_criterion_results WHERE "criterionId" = $1`, [criterion.id]);
      if (results > 0) throw new ConflictException('This criterion has Pass/Fail results, so it is kept for the record. Edit its text instead.');
      const [{ covered }] = await em.query(`SELECT count(*)::int AS covered FROM srs_ticket_criteria WHERE "criterionId" = $1`, [criterion.id]);
      if (covered > 0) throw new ConflictException('A linked ticket covers this criterion - change that link first.');
      await em.update(SrsCriterion, { id: criterion.id }, { deletedAt: new Date(), deletedByUserId: user.id });
      // Renumber the rest: AC1..n stay continuous.
      const rest = await this.liveCriteria(em, story.id);
      for (const [i, c] of rest.entries()) if (c.position !== i + 1) await em.update(SrsCriterion, { id: c.id }, { position: i + 1 });
      const status = await recomputeStoryStatus(em, story.id);
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.CRITERION_DELETED, 'SrsCriterion', criterion.id, { story: story.code, criterion: `AC${criterion.position}`, text: criterion.text, storyStatus: status });
      return { id: criterion.id };
    });
  }

  async reorderCriteria(storyId: number, dto: ReorderCriteriaDto, user: User, tenantId: number) {
    const { story } = await this.loadStory(storyId, user, tenantId);
    this.assertCanEditStory(user, story);
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM srs_stories WHERE id = $1 FOR UPDATE`, [story.id]);
      const live = await this.liveCriteria(em, story.id);
      const ids = dto.criterionIds;
      if (ids.length !== live.length || new Set(ids).size !== ids.length || !live.every((c) => ids.includes(c.id))) {
        throw new BadRequestException('Send every criterion of the story exactly once.');
      }
      const before = live.map((c) => c.id);
      for (const [i, id] of ids.entries()) await em.update(SrsCriterion, { id }, { position: i + 1 });
      await this.audit(em, user, tenantId, REQUIREMENTS_AUDIT.CRITERIA_REORDERED, 'SrsStory', story.id, { story: story.code, before, after: ids });
      return { id: story.id };
    });
  }

  // ---- story page ----

  async storyPage(storyId: number, user: User, tenantId: number) {
    const { story, srs } = await this.loadStory(storyId, user, tenantId);
    const tree = await this.requirements.buildTree(srs, user);
    const epic = tree.epics.find((e: any) => e.stories.some((s: any) => s.id === story.id))!;
    const node = epic.stories.find((s: any) => s.id === story.id)!;
    const [requirements, history, people] = await Promise.all([
      this.dataSource.query(
        `SELECT r.id, r.code, r.text, r.priority FROM srs_story_requirements l JOIN srs_requirements r ON r.id = l."requirementId"
          WHERE l."storyId" = $1 AND r."deletedAt" IS NULL ORDER BY r."sortOrder", r.id`,
        [story.id],
      ),
      this.dataSource.query(
        `SELECT h."criterionId", h.result, h.note, h."beforeApproval", h."recordedAt", u."fullName" AS "by"
           FROM srs_criterion_results h LEFT JOIN users u ON u.id = h."recordedByUserId"
          WHERE h."storyId" = $1 ORDER BY h."recordedAt" DESC, h.id DESC LIMIT 200`,
        [story.id],
      ),
      this.dataSource.query(`SELECT id, "fullName", email FROM users WHERE id = ANY($1)`, [[story.createdByUserId, story.approvedByUserId, story.atRiskByUserId].filter(Boolean)]),
    ]);
    const name = (id: number | null) => {
      const p = (people as any[]).find((u) => u.id === id);
      return p ? p.fullName || p.email : null;
    };
    return {
      srs: tree.srs,
      epic: { id: epic.id, code: epic.code, name: epic.name, srsSection: epic.srsSection },
      epics: tree.epics.map((e: any) => ({ id: e.id, code: e.code, name: e.name })),
      story: {
        ...node,
        createdBy: name(story.createdByUserId),
        approvedBy: name(story.approvedByUserId),
        approvedAt: story.approvedAt,
        atRiskBy: story.atRisk ? name(story.atRiskByUserId) : null,
        atRiskAt: story.atRisk ? story.atRiskAt : null,
        requirementDetails: requirements,
        history,
      },
      permissions: {
        ...tree.permissions,
        canEdit: canEditStory(user.role, story.status),
        canApprove: canApprove(user.role) && story.status === 'draft',
        approveNeedsRisk: !isClientSigned(srs.status),
      },
    };
  }
}

// Ids of live stories in an SRS whose status allows tickets and results.
export async function workingStoryIds(em: EntityManager | DataSource, srsId: number): Promise<number[]> {
  const rows = await em.query(`SELECT id FROM srs_stories WHERE "srsId" = $1 AND "deletedAt" IS NULL AND status IN ('approved', 'in_progress', 'done')`, [srsId]);
  return rows.map((r: any) => Number(r.id));
}

