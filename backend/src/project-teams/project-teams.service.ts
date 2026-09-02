import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectTeam } from './project-team.entity';
import { CreateProjectTeamDto } from './dto/create-project-team.dto';
import { UpdateProjectTeamDto } from './dto/update-project-team.dto';
import { ProjectsService } from '../projects/projects.service';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';

@Injectable()
export class ProjectTeamsService {
  constructor(
    @InjectRepository(ProjectTeam)
    private projectTeamsRepository: Repository<ProjectTeam>,
    private projectsService: ProjectsService,
    private auditLogService: AuditLogService,
  ) {}

  // Dropdowns that let someone assign a Team TO something (Project
  // Planning's Team field) call this with no options - only Active Teams
  // should be offered going forward, same convention as
  // ModulesService.findAllForProject.
  findAllForProject(
    projectId: number,
    tenantId: number,
    options: { includeInactive?: boolean } = {},
  ): Promise<ProjectTeam[]> {
    const where: Record<string, unknown> = { projectId, tenantId };
    if (!options.includeInactive) where.status = 'Active';
    return this.projectTeamsRepository.find({ where, order: { name: 'ASC' } });
  }

  // Tenant-wide (or project-filtered) list including Inactive - powers the
  // Project Teams list page.
  findAllWithStatus(tenantId: number, projectId?: number): Promise<ProjectTeam[]> {
    const where: Record<string, unknown> = { tenantId };
    if (projectId != null) where.projectId = projectId;
    return this.projectTeamsRepository.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: number, tenantId: number): Promise<ProjectTeam> {
    const team = await this.projectTeamsRepository.findOne({ where: { id, tenantId } });
    if (!team) {
      throw new NotFoundException(`Team #${id} not found`);
    }
    return team;
  }

  private async assertNameAvailable(projectId: number, name: string, tenantId: number, excludeId?: number): Promise<void> {
    const existing = await this.projectTeamsRepository.findOne({ where: { projectId, name, tenantId } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`A Team named "${name}" already exists in this Project.`);
    }
  }

  async create(dto: CreateProjectTeamDto, user: { id: number; email: string }, tenantId: number): Promise<ProjectTeam> {
    const project = await this.projectsService.findOne(dto.projectId, tenantId);
    await this.assertNameAvailable(project.id, dto.name, tenantId);

    const team = this.projectTeamsRepository.create({
      projectId: project.id,
      projectName: project.name,
      name: dto.name,
      status: dto.status ?? 'Active',
      createdByUserId: user.id,
      tenantId,
    });
    const saved = await this.projectTeamsRepository.save(team);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.PROJECT_TEAM_CREATED,
      tenantId,
      entityType: 'ProjectTeam',
      entityId: saved.id,
      details: { projectId: saved.projectId, name: saved.name, status: saved.status },
    });

    return saved;
  }

  async update(
    id: number,
    dto: UpdateProjectTeamDto,
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<ProjectTeam> {
    const team = await this.findOne(id, tenantId);
    if (dto.name !== undefined && dto.name !== team.name) {
      await this.assertNameAvailable(team.projectId, dto.name, tenantId, id);
    }
    const previous = { ...team };

    if (dto.name !== undefined) team.name = dto.name;
    if (dto.status !== undefined) team.status = dto.status;

    const saved = await this.projectTeamsRepository.save(team);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.PROJECT_TEAM_UPDATED,
      tenantId,
      entityType: 'ProjectTeam',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }

  async setStatus(
    id: number,
    status: 'Active' | 'Inactive',
    user: { id: number; email: string },
    tenantId: number,
  ): Promise<ProjectTeam> {
    const team = await this.findOne(id, tenantId);
    team.status = status;
    const saved = await this.projectTeamsRepository.save(team);

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: status === 'Active' ? AuditActions.PROJECT_TEAM_ACTIVATED : AuditActions.PROJECT_TEAM_DEACTIVATED,
      tenantId,
      entityType: 'ProjectTeam',
      entityId: saved.id,
    });

    return saved;
  }
}
