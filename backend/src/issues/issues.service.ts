import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Issue, IssueMode, IssueStatus } from './issue.entity';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { UsersService } from '../users/users.service';
import { ProjectsService } from '../projects/projects.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class IssuesService {
  constructor(
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    private usersService: UsersService,
    private projectsService: ProjectsService,
    private eventsGateway: EventsGateway,
    private eventEmitter: EventEmitter2,
  ) {}

  findAll(): Promise<Issue[]> {
    return this.issuesRepository.find({ order: { createdAt: 'DESC' } });
  }

  findByAssignee(userId: number): Promise<Issue[]> {
    return this.issuesRepository.find({
      where: { assigneeUserId: userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Issue> {
    const issue = await this.issuesRepository.findOne({ where: { id } });
    if (!issue) {
      throw new NotFoundException(`Issue #${id} not found`);
    }
    return issue;
  }

  async create(dto: CreateIssueDto, userId: number | null, userEmail: string): Promise<Issue> {
    const issue = this.issuesRepository.create({
      title: dto.title,
      description: dto.description,
      createdByUserId: userId,
      createdByEmail: userEmail,
      mode: dto.mode || IssueMode.MANUAL,
      showstopper: dto.showstopper ?? false,
    });

    await this.applyAssigneeAndProject(issue, dto);

    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueCreated(saved);
    if (saved.assigneeUserId) {
      this.eventEmitter.emit('issue.assigned', { issue: saved });
    }
    return saved;
  }

  async update(id: number, dto: UpdateIssueDto): Promise<Issue> {
    const issue = await this.findOne(id);
    const previousAssigneeUserId = issue.assigneeUserId;

    if (dto.title !== undefined) issue.title = dto.title;
    if (dto.description !== undefined) issue.description = dto.description;
    if (dto.mode !== undefined) issue.mode = dto.mode;
    if (dto.showstopper !== undefined) issue.showstopper = dto.showstopper;

    if (dto.status !== undefined) {
      issue.status = dto.status;
      // closedOn tracks the moment a status change lands on Closed, and
      // clears itself if the issue is later reopened.
      if (dto.status === IssueStatus.CLOSED) {
        if (!issue.closedOn) issue.closedOn = new Date();
      } else {
        issue.closedOn = null;
      }
    }

    await this.applyAssigneeAndProject(issue, dto);

    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);

    // Only notify when the assignee actually changed to someone new -
    // not on every unrelated edit (status change, description tweak, etc).
    if (saved.assigneeUserId && saved.assigneeUserId !== previousAssigneeUserId) {
      this.eventEmitter.emit('issue.assigned', { issue: saved });
    }

    return saved;
  }

  // Looks up the assignee/project by id and denormalizes their display info
  // onto the issue, so listing issues doesn't require extra joins.
  private async applyAssigneeAndProject(
    issue: Issue,
    dto: CreateIssueDto | UpdateIssueDto,
  ): Promise<void> {
    if (dto.assigneeUserId !== undefined) {
      if (dto.assigneeUserId === null) {
        issue.assigneeUserId = null;
        issue.assigneeEmail = null;
      } else {
        const assignee = await this.usersService.findById(dto.assigneeUserId);
        if (assignee) {
          issue.assigneeUserId = assignee.id;
          issue.assigneeEmail = assignee.email;
        }
      }
    }

    if (dto.projectId !== undefined) {
      if (dto.projectId === null) {
        issue.projectId = null;
        issue.projectName = null;
      } else {
        const project = await this.projectsService.findOne(dto.projectId);
        issue.projectId = project.id;
        issue.projectName = project.name;
      }
    }
  }
}
