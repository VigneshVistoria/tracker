import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { TechReview } from './tech-review.entity';
import { TechReviewEvidence } from './tech-review-evidence.entity';
import { Project } from '../projects/project.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { DEVELOPER_EQUIVALENT_ROLES, User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { PerformanceTrackingService } from '../performance-tracking/performance-tracking.service';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TEAM_SETTINGS_DEFAULTS, dateInZone, isValidTimeZone } from '../team-settings/time-zone';
import {
  MONTH,
  TECH_REVIEW_AUDIT,
  TECH_REVIEW_EVIDENCE_ROLES,
  TECH_REVIEW_SEE_ALL_ROLES,
  averageScore,
  previousMonth,
  scoresProblem,
} from './tech-reviews';
import { AddTechReviewEvidenceDto, CreateTechReviewDto, UpdateTechReviewDto } from './dto/tech-reviews.dto';

const nameOf = (u: User | undefined) => (u ? u.fullName || u.email : 'Unknown');
const clean = (v: string | null | undefined) => (v ?? '').trim() || null;

// Performance Tracking Q5 - technical review. See ./tech-reviews.ts.
@Injectable()
export class TechReviewsService {
  constructor(
    @InjectRepository(TechReview) private reviews: Repository<TechReview>,
    @InjectRepository(TechReviewEvidence) private evidence: Repository<TechReviewEvidence>,
    @InjectRepository(User) private users: Repository<User>,
    private tracking: PerformanceTrackingService,
    private auditLogService: AuditLogService,
    private dataSource: DataSource,
  ) {}

  private async thisMonth(tenantId: number) {
    const settings = await this.dataSource.getRepository(TeamSettings).findOne({ where: { tenantId } });
    return dateInZone(new Date(), isValidTimeZone(settings?.timeZone) ? settings!.timeZone : TEAM_SETTINGS_DEFAULTS.timeZone).slice(0, 7);
  }

  // Developer, Designer and DevOps - the people measured (smoke-test user left out).
  private async measured(tenantId: number) {
    const people = await this.users.find({ where: { tenantId, role: In(DEVELOPER_EQUIVALENT_ROLES) }, order: { fullName: 'ASC' } });
    return people.filter((u) => u.email !== process.env.SMOKE_TEST_EMAIL);
  }

  private async access(user: User, tenantId: number) {
    const th = await this.tracking.thresholds(tenantId);
    const isReviewer = th.techReviewerUserIds.includes(user.id);
    const seesAll = isReviewer || TECH_REVIEW_SEE_ALL_ROLES.includes(user.role);
    if (!seesAll && !DEVELOPER_EQUIVALENT_ROLES.includes(user.role)) throw new ForbiddenException('You cannot see technical reviews.');
    return { th, isReviewer, seesAll };
  }

  async list(month: string | undefined, user: User, tenantId: number) {
    const { th, isReviewer, seesAll } = await this.access(user, tenantId);
    const m = month ?? (await this.thisMonth(tenantId));
    if (!MONTH.test(m)) throw new BadRequestException('Month must be YYYY-MM.');
    const rows = await this.reviews.find({ where: { tenantId, month: m, ...(seesAll ? {} : { revieweeUserId: user.id }) }, order: { reviewedAt: 'ASC', id: 'ASC' } });
    const evidence = rows.length ? await this.evidence.find({ where: { tenantId, reviewId: In(rows.map((r) => r.id)) }, order: { createdAt: 'ASC', id: 'ASC' } }) : [];
    const ids = new Set<number>([...rows.flatMap((r) => [r.revieweeUserId, r.reviewerUserId]), ...evidence.map((e) => e.addedByUserId)]);
    const names = new Map((ids.size ? await this.users.find({ where: { tenantId, id: In([...ids]) } }) : []).map((u) => [u.id, u]));
    const projects = await this.dataSource.getRepository(Project).find({ where: { tenantId, performanceTrackingEnabled: true }, order: { name: 'ASC' } });
    const people = seesAll ? await this.measured(tenantId) : [user];
    return {
      month: m,
      required: th.techReviewsPerMonth,
      criteria: th.techReviewCriteria,
      canReview: isReviewer && projects.length > 0,
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      people: people.map((p) => {
        const mine = rows.filter((r) => r.revieweeUserId === p.id);
        const avg = mine.length ? Math.round((mine.reduce((s, r) => s + Number(r.average), 0) / mine.length) * 100) / 100 : null;
        return { userId: p.id, name: nameOf(p), count: mine.length, average: avg };
      }),
      reviews: rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        revieweeUserId: r.revieweeUserId,
        revieweeName: nameOf(names.get(r.revieweeUserId)),
        reviewerUserId: r.reviewerUserId,
        reviewerName: nameOf(names.get(r.reviewerUserId)),
        itemTitle: r.itemTitle,
        taskId: r.taskId,
        itemLink: r.itemLink,
        scores: r.scores,
        average: Number(r.average),
        comment: r.comment,
        reviewedAt: r.reviewedAt,
        canEdit: isReviewer && r.reviewerUserId === user.id,
        canAddEvidence: (isReviewer && r.reviewerUserId === user.id) || r.revieweeUserId === user.id || TECH_REVIEW_EVIDENCE_ROLES.includes(user.role),
        evidence: evidence
          .filter((e) => e.reviewId === r.id)
          .map((e) => ({ id: e.id, note: e.note, link: e.link, addedByName: nameOf(names.get(e.addedByUserId)), createdAt: e.createdAt })),
      })),
    };
  }

  // The project a review belongs to: its task's, else the one picked. Must be tracked.
  private async projectFor(taskId: number | null | undefined, projectId: number | null | undefined, tenantId: number) {
    let id = projectId ?? null;
    if (taskId) {
      const task = await this.dataSource.getRepository(ProjectTask).findOne({ where: { id: taskId, tenantId } });
      if (!task || task.status === 'Junk') throw new BadRequestException(`Task #${taskId} not found.`);
      id = task.projectId;
    }
    if (!id) throw new BadRequestException('Pick the project (or give a task number).');
    const project = await this.dataSource.getRepository(Project).findOne({ where: { id, tenantId } });
    if (!project?.performanceTrackingEnabled) throw new BadRequestException('Performance Tracking is off for that project.');
    return project.id;
  }

  async create(dto: CreateTechReviewDto, user: User, tenantId: number) {
    const { th, isReviewer } = await this.access(user, tenantId);
    if (!isReviewer) throw new ForbiddenException('Only the named technical reviewers can write a review.');
    if (dto.revieweeUserId === user.id) throw new BadRequestException('You cannot review your own work.');
    const reviewee = (await this.measured(tenantId)).find((p) => p.id === dto.revieweeUserId);
    if (!reviewee) throw new BadRequestException('Only a Developer, Designer or DevOps account can be reviewed.');
    const now = await this.thisMonth(tenantId);
    if (dto.month !== now && dto.month !== previousMonth(now)) throw new BadRequestException('Only this month or last month can be reviewed.');
    const done = await this.reviews.count({ where: { tenantId, revieweeUserId: reviewee.id, month: dto.month } });
    if (done >= th.techReviewsPerMonth) throw new BadRequestException(`${nameOf(reviewee)} already has ${done} review(s) for ${dto.month} (${th.techReviewsPerMonth} a month).`);
    const problem = scoresProblem(dto.scores, th.techReviewCriteria);
    if (problem) throw new BadRequestException(problem);
    const projectId = await this.projectFor(dto.taskId, dto.projectId, tenantId);
    const saved = await this.dataSource.transaction(async (em) => {
      const row = await em.save(
        em.create(TechReview, {
          tenantId,
          projectId,
          revieweeUserId: reviewee.id,
          reviewerUserId: user.id,
          month: dto.month,
          itemTitle: dto.itemTitle.trim(),
          taskId: dto.taskId ?? null,
          itemLink: clean(dto.itemLink),
          scores: dto.scores,
          average: String(averageScore(dto.scores)),
          comment: clean(dto.comment),
        }),
      );
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TECH_REVIEW_AUDIT.CREATED,
        tenantId,
        entityType: 'TechReview',
        entityId: row.id,
        details: { revieweeUserId: row.revieweeUserId, month: row.month, projectId, itemTitle: row.itemTitle, taskId: row.taskId, scores: row.scores, average: Number(row.average) },
      });
      return row;
    });
    return this.list(saved.month, user, tenantId);
  }

  private async own(id: number, user: User, tenantId: number) {
    const review = await this.reviews.findOne({ where: { id, tenantId } });
    if (!review) throw new NotFoundException(`Review #${id} not found.`);
    return review;
  }

  async update(id: number, dto: UpdateTechReviewDto, user: User, tenantId: number) {
    const { isReviewer } = await this.access(user, tenantId);
    const review = await this.own(id, user, tenantId);
    if (!isReviewer || review.reviewerUserId !== user.id) throw new ForbiddenException('Only the reviewer who wrote it can edit a review.');
    const changes: Partial<TechReview> = {};
    if (dto.itemTitle !== undefined) changes.itemTitle = dto.itemTitle.trim();
    if (dto.itemLink !== undefined) changes.itemLink = clean(dto.itemLink);
    if (dto.comment !== undefined) changes.comment = clean(dto.comment);
    if (dto.taskId !== undefined && (dto.taskId ?? null) !== review.taskId) {
      changes.taskId = dto.taskId ?? null;
      if (dto.taskId) changes.projectId = await this.projectFor(dto.taskId, null, tenantId);
    }
    if (dto.scores !== undefined) {
      // A review keeps the rubric it was scored on.
      const problem = scoresProblem(dto.scores, Object.keys(review.scores));
      if (problem) throw new BadRequestException(problem);
      changes.scores = dto.scores;
      changes.average = String(averageScore(dto.scores));
    }
    const keys = Object.keys(changes) as (keyof TechReview)[];
    const differs = keys.filter((k) => JSON.stringify((review as any)[k] ?? null) !== JSON.stringify((changes as any)[k] ?? null) && !(k === 'average' && Number(review.average) === Number(changes.average)));
    if (differs.length === 0) return this.list(review.month, user, tenantId);
    const before = Object.fromEntries(differs.map((k) => [k, (review as any)[k] ?? null]));
    const after = Object.fromEntries(differs.map((k) => [k, (changes as any)[k] ?? null]));
    await this.dataSource.transaction(async (em) => {
      await em.update(TechReview, { id: review.id, tenantId }, changes);
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TECH_REVIEW_AUDIT.UPDATED,
        tenantId,
        entityType: 'TechReview',
        entityId: review.id,
        details: { before, after },
      });
    });
    return this.list(review.month, user, tenantId);
  }

  async addEvidence(id: number, dto: AddTechReviewEvidenceDto, user: User, tenantId: number) {
    const { isReviewer } = await this.access(user, tenantId);
    const review = await this.own(id, user, tenantId);
    const may = (isReviewer && review.reviewerUserId === user.id) || review.revieweeUserId === user.id || TECH_REVIEW_EVIDENCE_ROLES.includes(user.role);
    if (!may) throw new ForbiddenException('Only the reviewer, the person reviewed, a PM or an Admin can add evidence.');
    await this.dataSource.transaction(async (em) => {
      const row = await em.save(em.create(TechReviewEvidence, { tenantId, reviewId: review.id, note: dto.note.trim(), link: clean(dto.link), addedByUserId: user.id }));
      await this.auditLogService.recordWithin(em, {
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: TECH_REVIEW_AUDIT.EVIDENCE_ADDED,
        tenantId,
        entityType: 'TechReview',
        entityId: review.id,
        details: { evidenceId: row.id, note: row.note, link: row.link },
      });
    });
    return this.list(review.month, user, tenantId);
  }
}
