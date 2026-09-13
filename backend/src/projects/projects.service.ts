import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { EventsGateway } from '../events/events.gateway';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { Issue } from '../issues/issue.entity';
import { ProjectModule as ProjectModuleEntity } from '../modules/project-module.entity';
import { Phase } from '../phases/phase.entity';
import { ProjectPlanEntry } from '../project-planning/project-plan-entry.entity';
import { ProjectTeam } from '../project-teams/project-team.entity';
import { Sprint } from '../sprints/sprint.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TestCase } from '../test-cases/test-case.entity';
import { TestExecution } from '../test-cases/test-execution.entity';
import { TimeEntry } from '../time-sheets/time-entry.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private projectsRepository: Repository<Project>,
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    @InjectRepository(ProjectModuleEntity)
    private modulesRepository: Repository<ProjectModuleEntity>,
    @InjectRepository(Phase)
    private phasesRepository: Repository<Phase>,
    @InjectRepository(ProjectPlanEntry)
    private projectPlanEntriesRepository: Repository<ProjectPlanEntry>,
    @InjectRepository(ProjectTeam)
    private projectTeamsRepository: Repository<ProjectTeam>,
    @InjectRepository(Sprint)
    private sprintsRepository: Repository<Sprint>,
    @InjectRepository(ProjectTask)
    private projectTasksRepository: Repository<ProjectTask>,
    @InjectRepository(TestCase)
    private testCasesRepository: Repository<TestCase>,
    @InjectRepository(TestExecution)
    private testExecutionsRepository: Repository<TestExecution>,
    @InjectRepository(TimeEntry)
    private timeEntriesRepository: Repository<TimeEntry>,
    private eventsGateway: EventsGateway,
    private auditLogService: AuditLogService,
  ) {}

  findAll(tenantId: number): Promise<Project[]> {
    return this.projectsRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async findOne(id: number, tenantId: number): Promise<Project> {
    const project = await this.projectsRepository.findOne({ where: { id, tenantId } });
    if (!project) {
      throw new NotFoundException(`Project #${id} not found`);
    }
    return project;
  }

  // Tenant-wide, not scoped under anything else - Project is the top of
  // the Project -> Module -> Phase chain, so there's no narrower scope to
  // check within (unlike Module/Phase, which are unique within their
  // parent).
  private async assertNameAvailable(name: string, tenantId: number, excludeId?: number): Promise<void> {
    const existing = await this.projectsRepository.findOne({ where: { name, tenantId } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`A project named "${name}" already exists.`);
    }
  }

  create(dto: CreateProjectDto, tenantId: number): Promise<Project> {
    const project = this.projectsRepository.create({ ...dto, tenantId });
    return this.projectsRepository.save(project).then((saved) => {
      this.eventsGateway.emitProjectCreated(saved);
      return saved;
    });
  }

  async update(id: number, dto: UpdateProjectDto, user: { id: number; email: string }, tenantId: number): Promise<Project> {
    const project = await this.findOne(id, tenantId);
    if (dto.name !== undefined && dto.name !== project.name) {
      await this.assertNameAvailable(dto.name, tenantId, id);
    }
    const previous = { ...project };

    Object.assign(project, dto);
    const saved = await this.projectsRepository.save(project);

    // Keep every denormalized copy of the project name in sync, same
    // reasoning as Module/Phase/Team do for their own name changes -
    // Project just has far more of them, being the top of the chain.
    // KpiPeriodScore is deliberately excluded - it's an immutable
    // historical snapshot (same as audit log entries), not a live display
    // value, so it should keep whatever name was current when it was
    // generated.
    if (dto.name !== undefined) {
      await this.issuesRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
      await this.modulesRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
      await this.phasesRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
      await this.projectPlanEntriesRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
      await this.projectTeamsRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
      await this.sprintsRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
      await this.projectTasksRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
      await this.testCasesRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
      await this.testExecutionsRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
      await this.timeEntriesRepository.update({ projectId: id, tenantId }, { projectName: saved.name });
    }

    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      action: AuditActions.PROJECT_UPDATED,
      tenantId,
      entityType: 'Project',
      entityId: saved.id,
      details: { previous, updated: dto },
    });

    return saved;
  }
}
