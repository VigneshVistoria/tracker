import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sprint } from './sprint.entity';
import { Issue } from '../issues/issue.entity';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { AddIssuesToSprintDto } from './dto/add-issues-to-sprint.dto';
import { ProjectsService } from '../projects/projects.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class SprintsService {
  constructor(
    @InjectRepository(Sprint)
    private sprintsRepository: Repository<Sprint>,
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    private projectsService: ProjectsService,
    private eventsGateway: EventsGateway,
  ) {}

  findAllForProject(projectId: number): Promise<Sprint[]> {
    return this.sprintsRepository.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Sprint> {
    const sprint = await this.sprintsRepository.findOne({ where: { id } });
    if (!sprint) {
      throw new NotFoundException(`Sprint #${id} not found`);
    }
    return sprint;
  }

  // Includes the issues currently planned into this sprint, plus a total
  // of their story points - what the sprint planning UI actually needs to
  // render in one call.
  async findOneWithIssues(id: number): Promise<Sprint & { issues: Issue[]; totalStoryPoints: number }> {
    const sprint = await this.findOne(id);
    const issues = await this.issuesRepository.find({
      where: { sprintId: id },
      order: { createdAt: 'ASC' },
    });
    const totalStoryPoints = issues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
    return { ...sprint, issues, totalStoryPoints };
  }

  async create(dto: CreateSprintDto, userId: number): Promise<Sprint> {
    const project = await this.projectsService.findOne(dto.projectId);
    const sprint = this.sprintsRepository.create({
      projectId: project.id,
      projectName: project.name,
      name: dto.name,
      goal: dto.goal,
      startDate: dto.startDate,
      endDate: dto.endDate,
      createdByUserId: userId,
    });
    const saved = await this.sprintsRepository.save(sprint);
    this.eventsGateway.emitSprintCreated(saved);
    return saved;
  }

  async update(id: number, dto: UpdateSprintDto): Promise<Sprint> {
    const sprint = await this.findOne(id);
    const previousName = sprint.name;

    if (dto.name !== undefined) sprint.name = dto.name;
    if (dto.goal !== undefined) sprint.goal = dto.goal;
    if (dto.startDate !== undefined) sprint.startDate = dto.startDate;
    if (dto.endDate !== undefined) sprint.endDate = dto.endDate;
    if (dto.status !== undefined) sprint.status = dto.status;

    const saved = await this.sprintsRepository.save(sprint);

    // Keep the denormalized sprint name on every issue in this sprint in
    // sync, so the issues list/detail pages never show a stale name.
    if (dto.name !== undefined && dto.name !== previousName) {
      await this.issuesRepository.update({ sprintId: id }, { sprintName: saved.name });
      const affected = await this.issuesRepository.find({ where: { sprintId: id } });
      affected.forEach((issue) => this.eventsGateway.emitIssueUpdated(issue));
    }

    this.eventsGateway.emitSprintUpdated(saved);
    return saved;
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    // Unassign rather than orphan - any issue in this sprint goes back to
    // the backlog instead of pointing at a sprint that no longer exists.
    const affected = await this.issuesRepository.find({ where: { sprintId: id } });
    await this.issuesRepository.update({ sprintId: id }, { sprintId: null, sprintName: null });
    affected.forEach((issue) =>
      this.eventsGateway.emitIssueUpdated({ ...issue, sprintId: null, sprintName: null }),
    );
    await this.sprintsRepository.delete(id);
    this.eventsGateway.emitSprintDeleted(id);
  }

  // Bulk-assigns issues into a sprint - used by both the checkbox
  // multi-select "Add to Sprint" action and drag-and-drop. Issues from a
  // different project than the sprint are skipped rather than erroring
  // out the whole batch, and reported back so the UI can flag them.
  async addIssues(sprintId: number, dto: AddIssuesToSprintDto): Promise<{ added: Issue[]; skipped: number[] }> {
    const sprint = await this.findOne(sprintId);
    const added: Issue[] = [];
    const skipped: number[] = [];

    for (const issueId of dto.issueIds) {
      const issue = await this.issuesRepository.findOne({ where: { id: issueId } });
      if (!issue) {
        skipped.push(issueId);
        continue;
      }
      if (issue.projectId !== sprint.projectId) {
        skipped.push(issueId);
        continue;
      }
      issue.sprintId = sprint.id;
      issue.sprintName = sprint.name;
      const saved = await this.issuesRepository.save(issue);
      this.eventsGateway.emitIssueUpdated(saved);
      added.push(saved);
    }

    if (added.length === 0 && skipped.length > 0) {
      throw new BadRequestException(
        'None of the selected issues could be added - they may belong to a different project than this sprint.',
      );
    }

    return { added, skipped };
  }

  async removeIssue(sprintId: number, issueId: number): Promise<Issue> {
    await this.findOne(sprintId);
    const issue = await this.issuesRepository.findOne({ where: { id: issueId, sprintId } });
    if (!issue) {
      throw new NotFoundException(`Issue #${issueId} is not in sprint #${sprintId}`);
    }
    issue.sprintId = null;
    issue.sprintName = null;
    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);
    return saved;
  }
}
