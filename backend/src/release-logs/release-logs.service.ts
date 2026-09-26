import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Release } from './release.entity';
import { ReleaseItem } from './release-item.entity';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { ProjectsService } from '../projects/projects.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

@Injectable()
export class ReleaseLogsService {
  constructor(
    @InjectRepository(Release)
    private releasesRepository: Repository<Release>,
    @InjectRepository(ReleaseItem)
    private releaseItemsRepository: Repository<ReleaseItem>,
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    private projectsService: ProjectsService,
    private auditLogService: AuditLogService,
  ) {}

  async findAll(tenantId: number, projectId?: number): Promise<(Release & { itemCount: number })[]> {
    const where: Record<string, unknown> = { tenantId };
    if (projectId != null) where.projectId = projectId;
    const releases = await this.releasesRepository.find({ where, order: { releaseDate: 'DESC', id: 'DESC' } });
    if (releases.length === 0) return [];

    const counts = await this.releaseItemsRepository
      .createQueryBuilder('i')
      .select('i.releaseId', 'releaseId')
      .addSelect('COUNT(*)', 'count')
      .where('i.tenantId = :tenantId', { tenantId })
      .groupBy('i.releaseId')
      .getRawMany();
    const countById = new Map(counts.map((c) => [Number(c.releaseId), Number(c.count)]));
    return releases.map((r) => ({ ...r, itemCount: countById.get(r.id) ?? 0 }));
  }

  async findOne(id: number, tenantId: number): Promise<Release> {
    const release = await this.releasesRepository.findOne({ where: { id, tenantId } });
    if (!release) {
      throw new NotFoundException(`Release #${id} not found`);
    }
    return release;
  }

  async findOneWithItems(id: number, tenantId: number): Promise<Release & { items: ReleaseItem[] }> {
    const release = await this.findOne(id, tenantId);
    const items = await this.releaseItemsRepository.find({
      where: { releaseId: id, tenantId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return { ...release, items };
  }

  // Ticket picker for a Release's rows: only tasks in the Release's
  // Project that have at least one QA/Peer Review round, since that's
  // where a Resolution comes from - a task that was never submitted has
  // nothing to fetch.
  async findTicketOptions(projectId: number, tenantId: number): Promise<{ id: number; name: string }[]> {
    const tasks = await this.tasksRepository
      .createQueryBuilder('t')
      .select(['t.id', 't.title'])
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.projectId = :projectId', { projectId })
      .andWhere('EXISTS (SELECT 1 FROM task_qa_reviews r WHERE r."taskId" = t.id AND r."tenantId" = :tenantId)', { tenantId })
      .orderBy('t.id', 'DESC')
      .getMany();
    return tasks.map((t) => ({ id: t.id, name: `#${t.id} - ${t.title}` }));
  }

  private async assertVersionAvailable(
    projectId: number,
    appName: string,
    version: string,
    tenantId: number,
    excludeId?: number,
  ): Promise<void> {
    const existing = await this.releasesRepository.findOne({ where: { projectId, appName, version, tenantId } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`${appName} ${version} already has a Release in this Project.`);
    }
  }

  async create(dto: CreateReleaseDto, user: { id: number; email: string }, tenantId: number): Promise<Release> {
    const project = await this.projectsService.findOne(dto.projectId, tenantId);
    const appName = dto.appName.trim();
    const version = dto.version.trim();
    await this.assertVersionAvailable(project.id, appName, version, tenantId);

    const release = this.releasesRepository.create({
      tenantId,
      projectId: project.id,
      projectName: project.name,
      appName,
      version,
      releaseDate: dto.releaseDate,
      artifacts: dto.artifacts?.trim() || null,
      createdByUserId: user.id,
      createdByEmail: user.email,
    });
    const saved = await this.releasesRepository.save(release);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.RELEASE_CREATED,
      tenantId,
      entityType: 'Release',
      entityId: saved.id,
      details: { projectId: saved.projectId, appName, version, releaseDate: saved.releaseDate },
    });

    return saved;
  }

  async update(id: number, dto: UpdateReleaseDto, user: { id: number; email: string }, tenantId: number): Promise<Release> {
    const release = await this.findOne(id, tenantId);
    const previous = { ...release };

    const appName = dto.appName !== undefined ? dto.appName.trim() : release.appName;
    const version = dto.version !== undefined ? dto.version.trim() : release.version;
    if (appName !== release.appName || version !== release.version) {
      await this.assertVersionAvailable(release.projectId, appName, version, tenantId, id);
    }

    release.appName = appName;
    release.version = version;
    if (dto.releaseDate !== undefined) release.releaseDate = dto.releaseDate;
    if (dto.artifacts !== undefined) release.artifacts = dto.artifacts.trim() || null;

    const saved = await this.releasesRepository.save(release);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.RELEASE_UPDATED,
      tenantId,
      entityType: 'Release',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  // Latest round by roundNumber, QA or Peer - whichever the Assignee
  // submitted most recently is the Resolution that actually shipped.
  private latestReview(taskId: number, tenantId: number): Promise<TaskQaReview | null> {
    return this.qaReviewsRepository.findOne({
      where: { taskId, tenantId },
      order: { roundNumber: 'DESC', id: 'DESC' },
    });
  }

  async addItem(releaseId: number, taskId: number, user: { id: number; email: string }, tenantId: number): Promise<ReleaseItem> {
    const release = await this.findOne(releaseId, tenantId);
    const task = await this.tasksRepository.findOne({ where: { id: taskId, tenantId } });
    if (!task) {
      throw new NotFoundException(`Ticket #${taskId} not found`);
    }
    if (task.projectId !== release.projectId) {
      throw new BadRequestException(`Ticket #${taskId} belongs to ${task.projectName}, not ${release.projectName}.`);
    }
    const existing = await this.releaseItemsRepository.findOne({ where: { releaseId, taskId, tenantId } });
    if (existing) {
      throw new ConflictException(`Ticket #${taskId} is already in this Release.`);
    }

    const review = await this.latestReview(taskId, tenantId);
    if (!review) {
      throw new BadRequestException(`Ticket #${taskId} has no Resolution yet - it hasn't been submitted for review.`);
    }

    const item = this.releaseItemsRepository.create({
      tenantId,
      releaseId,
      taskId,
      taskTitle: task.title,
      resolution: review.resolution,
      sourceReviewId: review.id,
      addedByUserId: user.id,
    });
    const saved = await this.releaseItemsRepository.save(item);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.RELEASE_ITEM_ADDED,
      tenantId,
      entityType: 'Release',
      entityId: releaseId,
      details: { taskId, sourceReviewId: review.id },
    });

    return saved;
  }

  async removeItem(releaseId: number, itemId: number, user: { id: number; email: string }, tenantId: number): Promise<{ removed: true }> {
    await this.findOne(releaseId, tenantId);
    const item = await this.releaseItemsRepository.findOne({ where: { id: itemId, releaseId, tenantId } });
    if (!item) {
      throw new NotFoundException(`Row #${itemId} not found in this Release`);
    }
    await this.releaseItemsRepository.delete({ id: item.id });

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.RELEASE_ITEM_REMOVED,
      tenantId,
      entityType: 'Release',
      entityId: releaseId,
      details: { taskId: item.taskId },
    });

    return { removed: true };
  }
}
