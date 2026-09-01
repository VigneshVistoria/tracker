import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IssueCategoryOption } from './issue-category.entity';
import { CreateIssueCategoryDto } from './dto/create-issue-category.dto';
import { UpdateIssueCategoryDto } from './dto/update-issue-category.dto';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { Issue } from '../issues/issue.entity';

// Category names that Issue.category is matched against by 3 downstream
// services for real logic (risk scoring, showstopper-claim validation) -
// see modules.service.ts, weekly-reports.service.ts,
// showstopper-validator.service.ts. Renaming or deleting these would
// silently break that logic for any future issue tagged with them, so
// both are blocked regardless of current usage.
const PROTECTED_NAMES = ['Critical', 'Showstopper'];

@Injectable()
export class IssueCategoriesService {
  constructor(
    @InjectRepository(IssueCategoryOption)
    private categoriesRepository: Repository<IssueCategoryOption>,
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    private auditLogService: AuditLogService,
  ) {}

  private async assertNameAvailable(name: string, tenantId: number, excludeId?: number): Promise<void> {
    const existing = await this.categoriesRepository.findOne({ where: { name, tenantId } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`An issue category named "${name}" already exists.`);
    }
  }

  private assertNotProtected(name: string): void {
    if (PROTECTED_NAMES.includes(name)) {
      throw new ConflictException(
        `"${name}" is a protected category used by risk scoring and showstopper validation, and can't be renamed or deleted.`,
      );
    }
  }

  findAll(tenantId: number): Promise<IssueCategoryOption[]> {
    return this.categoriesRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async findOneOrFail(id: number, tenantId: number): Promise<IssueCategoryOption> {
    const category = await this.categoriesRepository.findOne({ where: { id, tenantId } });
    if (!category) {
      throw new NotFoundException(`Issue category #${id} not found`);
    }
    return category;
  }

  async create(
    dto: CreateIssueCategoryDto,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<IssueCategoryOption> {
    await this.assertNameAvailable(dto.name, tenantId);
    const category = this.categoriesRepository.create({ ...dto, tenantId });
    const saved = await this.categoriesRepository.save(category);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.ISSUE_CATEGORY_CREATED,
      tenantId,
      entityType: 'IssueCategoryOption',
      entityId: saved.id,
      details: { ...dto },
    });

    return saved;
  }

  async update(
    id: number,
    dto: UpdateIssueCategoryDto,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<IssueCategoryOption> {
    const category = await this.findOneOrFail(id, tenantId);
    if (dto.name !== undefined && dto.name !== category.name) {
      this.assertNotProtected(category.name);
      await this.assertNameAvailable(dto.name, tenantId, id);
    }
    const previous = { ...category };

    if (dto.name !== undefined) category.name = dto.name;
    if (dto.description !== undefined) category.description = dto.description;

    const saved = await this.categoriesRepository.save(category);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.ISSUE_CATEGORY_UPDATED,
      tenantId,
      entityType: 'IssueCategoryOption',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  async setActive(
    id: number,
    isActive: boolean,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<IssueCategoryOption> {
    const category = await this.findOneOrFail(id, tenantId);
    category.isActive = isActive;
    const saved = await this.categoriesRepository.save(category);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: isActive ? AuditActions.ISSUE_CATEGORY_ACTIVATED : AuditActions.ISSUE_CATEGORY_DEACTIVATED,
      tenantId,
      entityType: 'IssueCategoryOption',
      entityId: saved.id,
    });

    return saved;
  }

  async remove(id: number, user: { id: number; email: string }, tenantId: number): Promise<void> {
    const category = await this.findOneOrFail(id, tenantId);
    this.assertNotProtected(category.name);

    const inUseCount = await this.issuesRepository.count({ where: { category: category.name, tenantId } });
    if (inUseCount > 0) {
      throw new ConflictException(
        `Can't delete "${category.name}" - it's currently used by ${inUseCount} issue(s). Deactivate it instead.`,
      );
    }

    await this.categoriesRepository.delete(id);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.ISSUE_CATEGORY_DELETED,
      tenantId,
      entityType: 'IssueCategoryOption',
      entityId: id,
      details: { deleted: category },
    });
  }
}
