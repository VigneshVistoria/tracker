import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dependency, DependencyStatus } from './dependency.entity';
import { CreateDependencyDto } from './dto/create-dependency.dto';
import { UpdateDependencyDto } from './dto/update-dependency.dto';
import { IssuesService } from '../issues/issues.service';
import { UserRole } from '../users/user.entity';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

const STATUSES_THAT_CLOSE: DependencyStatus[] = [DependencyStatus.RESOLVED, DependencyStatus.CLOSED];

@Injectable()
export class DependenciesService {
  constructor(
    @InjectRepository(Dependency)
    private dependenciesRepository: Repository<Dependency>,
    private issuesService: IssuesService,
    private auditLogService: AuditLogService,
  ) {}

  // Blocked-and-overdue first, matching the inbox's default triage order:
  // an item that's actively blocking work and past its required-by date
  // should never be buried under newer-but-lower-stakes rows.
  private static readonly DEFAULT_ORDER = {
    blocking: 'DESC' as const,
    requiredByDate: 'ASC' as const,
  };

  async findOne(id: number): Promise<Dependency> {
    const dependency = await this.dependenciesRepository.findOne({ where: { id } });
    if (!dependency) {
      throw new NotFoundException(`Dependency #${id} not found`);
    }
    return dependency;
  }

  findReceived(ownerUserId: number): Promise<Dependency[]> {
    return this.dependenciesRepository.find({
      where: { ownerUserId },
      order: DependenciesService.DEFAULT_ORDER,
    });
  }

  findSent(createdByUserId: number): Promise<Dependency[]> {
    return this.dependenciesRepository.find({
      where: { createdByUserId },
      order: DependenciesService.DEFAULT_ORDER,
    });
  }

  findAll(): Promise<Dependency[]> {
    return this.dependenciesRepository.find({ order: DependenciesService.DEFAULT_ORDER });
  }

  canView(dependency: Dependency, user: { id: number; role: UserRole }): boolean {
    if (user.role === UserRole.ADMIN || user.role === UserRole.EXECUTIVE || user.role === UserRole.PROGRAM_MANAGER) {
      return true;
    }
    return dependency.ownerUserId === user.id || dependency.createdByUserId === user.id;
  }

  async create(
    dto: CreateDependencyDto,
    createdByUserId: number,
    createdByEmail: string,
  ): Promise<Dependency> {
    // Standalone dependencies are rejected here so both the REST API and
    // any future Teams #dependency command go through the same check -
    // this throws NotFoundException if impactedIssueId doesn't exist.
    await this.issuesService.findOne(dto.impactedIssueId);

    const dependency = this.dependenciesRepository.create({
      ...dto,
      blocking: dto.blocking ?? false,
      status: DependencyStatus.OPEN,
      createdByUserId,
      createdByEmail,
    });
    const saved = await this.dependenciesRepository.save(dependency);

    await this.auditLogService.record({
      userId: createdByUserId,
      userEmail: createdByEmail,
      action: AuditActions.DEPENDENCY_CREATED,
      entityType: 'dependency',
      entityId: saved.id,
      details: { impactedIssueId: saved.impactedIssueId, ownerEmail: saved.ownerEmail, priority: saved.priority },
    });

    return saved;
  }

  async update(
    id: number,
    dto: UpdateDependencyDto,
    currentUser: { id: number; email: string; role: UserRole },
  ): Promise<Dependency> {
    const dependency = await this.findOne(id);
    if (!this.canEdit(dependency, currentUser)) {
      throw new ForbiddenException('You do not have access to edit this dependency.');
    }

    Object.assign(dependency, dto);
    const saved = await this.dependenciesRepository.save(dependency);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.DEPENDENCY_UPDATED,
      entityType: 'dependency',
      entityId: saved.id,
      details: dto as Record<string, unknown>,
    });

    return saved;
  }

  async updateStatus(
    id: number,
    status: DependencyStatus,
    currentUser: { id: number; email: string; role: UserRole },
  ): Promise<Dependency> {
    const dependency = await this.findOne(id);
    if (!this.canEdit(dependency, currentUser)) {
      throw new ForbiddenException('You do not have access to update this dependency.');
    }

    const fromStatus = dependency.status;
    dependency.status = status;

    if (STATUSES_THAT_CLOSE.includes(status) && !dependency.resolvedAt) {
      dependency.resolvedAt = new Date();
    }
    if (status === DependencyStatus.ESCALATED && !dependency.escalatedAt) {
      dependency.escalatedAt = new Date();
    }

    const saved = await this.dependenciesRepository.save(dependency);

    await this.auditLogService.record({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action: AuditActions.DEPENDENCY_STATUS_CHANGED,
      entityType: 'dependency',
      entityId: saved.id,
      details: { from: fromStatus, to: status },
    });

    return saved;
  }

  // Only the person a dependency is waiting on, whoever filed it, or an
  // Admin/Program Manager override may edit it or move its status -
  // Executive stays read-only here same as everywhere else, and an
  // unrelated third party has no business touching it.
  private canEdit(dependency: Dependency, user: { id: number; role: UserRole }): boolean {
    if (user.role === UserRole.ADMIN || user.role === UserRole.PROGRAM_MANAGER) {
      return true;
    }
    return dependency.ownerUserId === user.id || dependency.createdByUserId === user.id;
  }
}
