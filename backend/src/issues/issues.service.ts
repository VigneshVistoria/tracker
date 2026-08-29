import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not, IsNull } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Issue, IssueMode, IssueStatus, ShowstopperReviewStatus } from './issue.entity';
import { Priority } from '../common/priority.enum';
import { Sprint } from '../sprints/sprint.entity';
import { ProjectModule } from '../modules/project-module.entity';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { CreateDependencyDto } from './dto/create-dependency.dto';
import { UsersService } from '../users/users.service';
import { UserRole, User } from '../users/user.entity';
import { ProjectsService } from '../projects/projects.service';
import { EventsGateway } from '../events/events.gateway';
import { AuditLogService, AuditActions } from '../audit/audit-log.service';
import { SlaService } from '../sla/sla.service';
import { ShowstopperValidatorService } from './showstopper-validator.service';

// Section 1/3: these are the only roles allowed to file a ticket through
// this endpoint. Developer is deliberately excluded - see
// IssuesController.create() for the enforcement point and
// recordBlockedCreationAttempt() below for what happens when it's violated.
const ROLES_ALLOWED_TO_CREATE_TICKETS: UserRole[] = [
  UserRole.ADMIN,
  UserRole.PROGRAM_MANAGER,
  UserRole.QA,
  UserRole.EXECUTIVE,
  // Clients file UAT feedback / post-go-live support requests through
  // this same endpoint - source gets auto-tagged 'Client Feedback' below,
  // same as Executive/PM gets 'Leadership Request'.
  UserRole.CLIENT,
];

@Injectable()
export class IssuesService {
  constructor(
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    @InjectRepository(Sprint)
    private sprintsRepository: Repository<Sprint>,
    @InjectRepository(ProjectModule)
    private modulesRepository: Repository<ProjectModule>,
    private usersService: UsersService,
    private projectsService: ProjectsService,
    private eventsGateway: EventsGateway,
    private eventEmitter: EventEmitter2,
    private auditLogService: AuditLogService,
    private slaService: SlaService,
    private showstopperValidatorService: ShowstopperValidatorService,
  ) {}

  // Exposed so the controller can check a role against the same list this
  // service enforces, without duplicating it.
  static isAllowedToCreateTickets(role: UserRole): boolean {
    return ROLES_ALLOWED_TO_CREATE_TICKETS.includes(role);
  }

  findAll(tenantId: number): Promise<Issue[]> {
    return this.issuesRepository.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  findByAssignee(userId: number, tenantId: number): Promise<Issue[]> {
    return this.issuesRepository.find({
      where: { assigneeUserId: userId, tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  // Dependency tickets (parentIssueId set) currently owned by this user -
  // the "received dependencies" inbox. Ordered newest-first, same as
  // every other issue listing in this service.
  findReceivedDependencies(userId: number, tenantId: number): Promise<Issue[]> {
    return this.issuesRepository.find({
      where: { assigneeUserId: userId, parentIssueId: Not(IsNull()), tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  // Client visibility - only the tickets they filed themselves, never the
  // full internal list, another client's tickets, or anything by project.
  findByCreator(userId: number, tenantId: number): Promise<Issue[]> {
    return this.issuesRepository.find({
      where: { createdByUserId: userId, tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  // Used for Program Manager visibility - everything in any project they're
  // assigned to, not just their own assigned issues.
  findByProjects(projectIds: number[], tenantId: number): Promise<Issue[]> {
    if (projectIds.length === 0) return Promise.resolve([]);
    return this.issuesRepository.find({
      where: { projectId: In(projectIds), tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number, tenantId: number): Promise<Issue> {
    const issue = await this.issuesRepository.findOne({ where: { id, tenantId } });
    if (!issue) {
      throw new NotFoundException(`Issue #${id} not found`);
    }
    return issue;
  }

  // Same as findOne, but also returns the dependency tickets spun off
  // from this issue, if any - used by the issue detail page.
  async findOneWithDependencies(id: number, tenantId: number): Promise<Issue & { dependencies: Issue[] }> {
    const issue = await this.findOne(id, tenantId);
    const dependencies = await this.issuesRepository.find({
      where: { parentIssueId: id, tenantId },
      order: { createdAt: 'ASC' },
    });
    return { ...issue, dependencies };
  }

  // creatorRole drives Section 34: an Executive or Program Manager filing
  // a ticket is always treated as a "Leadership Request" - forced to High
  // priority regardless of what (if anything) was passed in, tagged with
  // a source, and flagged for a separate notification to QA. Everyone
  // else's priority is whatever they picked (or null, same as before).
  async create(
    dto: CreateIssueDto,
    userId: number | null,
    userEmail: string,
    tenantId: number,
    creatorRole?: UserRole | null,
  ): Promise<Issue> {
    const isLeadershipRequest =
      creatorRole === UserRole.EXECUTIVE || creatorRole === UserRole.PROGRAM_MANAGER;
    const isClientFeedback = creatorRole === UserRole.CLIENT;

    const issue = this.issuesRepository.create({
      title: dto.title,
      description: dto.description,
      createdByUserId: userId,
      createdByEmail: userEmail,
      mode: dto.mode || IssueMode.MANUAL,
      showstopper: dto.showstopper ?? false,
      storyPoints: dto.storyPoints,
      category: dto.category,
      priority: isLeadershipRequest ? Priority.HIGH : dto.priority ?? null,
      source: isLeadershipRequest ? 'Leadership Request' : isClientFeedback ? 'Client Feedback' : null,
      tenantId,
    });

    await this.applyAssigneeAndProject(issue, dto, tenantId);

    let saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueCreated(saved);
    if (saved.assigneeUserId) {
      this.eventEmitter.emit('issue.assigned', { issue: saved });
    }
    if (isLeadershipRequest) {
      this.eventEmitter.emit('issue.leadershipRequestCreated', { issue: saved });
    }
    if (saved.showstopper) {
      saved = await this.handleShowstopperFlagged(saved);
    }

    await this.auditLogService.record({
      userId,
      userEmail,
      userRole: creatorRole ?? null,
      action: AuditActions.TICKET_CREATED,
      tenantId,
      entityType: 'Issue',
      entityId: saved.id,
      details: { title: saved.title, priority: saved.priority, source: saved.source },
    });

    return saved;
  }

  // Fires on the false -> true showstopper transition only (at creation,
  // or via update() below) - never on an unrelated edit to an
  // already-showstopper ticket, same "only notify on the change that
  // matters" reasoning update() already applies to assignee changes.
  // Does two independent things: emails the team with the SLA deadline
  // (Feature 3), and runs the classification heuristic, flagging the
  // ticket for a Program Manager/QA/Admin to confirm or downgrade if it
  // looks questionable (Feature 4) - the email fires either way, since
  // it's about making sure a claimed showstopper gets seen fast, not a
  // verdict on whether the claim is legitimate.
  private async handleShowstopperFlagged(issue: Issue): Promise<Issue> {
    const sla = await this.slaService.computeForIssueStandalone(issue);
    this.eventEmitter.emit('issue.showstopperFlagged', {
      issue,
      slaTargetHours: sla.targetHours,
      dueAt: sla.dueAt,
    });

    if (!issue.createdByUserId) {
      return issue;
    }

    const recentTickets = await this.issuesRepository.find({
      where: { createdByUserId: issue.createdByUserId, tenantId: issue.tenantId },
      order: { createdAt: 'DESC' },
      take: 6, // 5 "recent" + the one just created/updated, filtered out below
    });
    const recentTicketsExcludingThisOne = recentTickets.filter((t) => t.id !== issue.id);

    const result = this.showstopperValidatorService.evaluate(issue, recentTicketsExcludingThisOne);
    if (result.verdict !== 'questionable') {
      return issue;
    }

    issue.showstopperReviewStatus = ShowstopperReviewStatus.PENDING;
    issue.showstopperFlagReasons = JSON.stringify(result.reasons);
    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);

    await this.auditLogService.record({
      userId: issue.createdByUserId,
      userEmail: issue.createdByEmail,
      action: AuditActions.SHOWSTOPPER_FLAGGED_FOR_REVIEW,
      tenantId: issue.tenantId,
      entityType: 'Issue',
      entityId: saved.id,
      details: { confidence: result.confidence, reasons: result.reasons },
    });

    return saved;
  }

  // Section 3/34: called by the controller when a role outside
  // ROLES_ALLOWED_TO_CREATE_TICKETS (i.e. Developer) attempts to file a
  // ticket. Lives here (rather than in the controller) so every surface
  // that will eventually create tickets - REST today, the Teams `#desc`
  // command in Phase 2 - can reuse the same audit trail and Administrator
  // notification just by calling this before rejecting the attempt.
  async recordBlockedCreationAttempt(user: Pick<User, 'id' | 'email' | 'role' | 'tenantId'>, dto: CreateIssueDto): Promise<void> {
    await this.auditLogService.record({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: AuditActions.TICKET_CREATION_BLOCKED,
      tenantId: user.tenantId,
      entityType: 'Issue',
      details: { attemptedTitle: dto.title },
    });
    this.eventEmitter.emit('issue.creationBlocked', {
      attemptedByEmail: user.email,
      attemptedByRole: user.role,
      attemptedTitle: dto.title,
      tenantId: user.tenantId,
    });
  }

  // Spins off a new issue from a parent, linked via parentIssueId, and
  // assigns it to the chosen "dependency owner". A normal issue in every
  // other respect - same default status (Backlog), same workflow.
  async createDependency(
    parentId: number,
    dto: CreateDependencyDto,
    userId: number,
    userEmail: string,
    tenantId: number,
  ): Promise<Issue> {
    const parent = await this.findOne(parentId, tenantId);

    // Performance Dashboard's late-dependency penalty: frozen at this
    // exact moment, using the parent's status/assignee as they are right
    // now - never recalculated later even if the parent's status or
    // assignee changes afterward (see the entity comments on both
    // columns for why).
    const wasCreatedMidDevelopment = parent.status !== IssueStatus.BACKLOG;

    const issue = this.issuesRepository.create({
      title: dto.title,
      description: dto.description,
      createdByUserId: userId,
      createdByEmail: userEmail,
      mode: IssueMode.MANUAL,
      showstopper: false,
      storyPoints: dto.storyPoints,
      parentIssueId: parent.id,
      wasCreatedMidDevelopment,
      lateDependencyAttributedToUserId: wasCreatedMidDevelopment ? parent.assigneeUserId : null,
      tenantId,
    });

    await this.applyAssigneeAndProject(issue, {
      assigneeUserId: dto.assigneeUserId,
      projectId: dto.projectId ?? parent.projectId ?? undefined,
    } as UpdateIssueDto, tenantId);

    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueCreated(saved);
    if (saved.assigneeUserId) {
      this.eventEmitter.emit('issue.assigned', { issue: saved });
    }
    return saved;
  }

  // Only these forward moves are allowed for a regular (non-admin) user via
  // the generic update endpoint. Moving into "In Review", "QA Testing", or
  // "Ready for Production" must go through submitForReview()/approve()/
  // qaApprove() instead, since those steps carry side effects
  // (notifications, approval tracking) that a plain field edit shouldn't
  // silently trigger. QA_FAILED -> IN_PROGRESS is a plain self-service move
  // though, same as BACKLOG <-> IN_PROGRESS - it's just the assignee
  // picking the ticket back up, with no side effects of its own.
  private static ALLOWED_SELF_SERVICE_TRANSITIONS: Partial<Record<IssueStatus, IssueStatus[]>> = {
    [IssueStatus.BACKLOG]: [IssueStatus.IN_PROGRESS],
    [IssueStatus.IN_PROGRESS]: [IssueStatus.BACKLOG],
    [IssueStatus.QA_FAILED]: [IssueStatus.IN_PROGRESS],
  };

  async update(id: number, dto: UpdateIssueDto, tenantId: number, actingUser?: { id: number; role: UserRole }): Promise<Issue> {
    const issue = await this.findOne(id, tenantId);
    const previousAssigneeUserId = issue.assigneeUserId;
    const previousShowstopper = issue.showstopper;

    if (dto.title !== undefined) issue.title = dto.title;
    if (dto.description !== undefined) issue.description = dto.description;
    if (dto.mode !== undefined) issue.mode = dto.mode;
    if (dto.showstopper !== undefined) issue.showstopper = dto.showstopper;
    if (dto.storyPoints !== undefined) issue.storyPoints = dto.storyPoints;
    if (dto.category !== undefined) issue.category = dto.category;

    if (dto.status !== undefined && dto.status !== issue.status) {
      const isAdmin = actingUser?.role === UserRole.ADMIN;
      if (!isAdmin) {
        const allowed = IssuesService.ALLOWED_SELF_SERVICE_TRANSITIONS[issue.status] || [];
        if (!allowed.includes(dto.status)) {
          throw new BadRequestException(
            `Can't move an issue from "${issue.status}" to "${dto.status}" this way. ` +
              'Use "Submit for Review", the Program Manager approval actions, or the QA actions instead.',
          );
        }
      }
      issue.status = dto.status;
      // closedOn tracks the moment a status change lands on Ready for
      // Production, and clears itself if the issue is later reopened/sent
      // back.
      if (dto.status === IssueStatus.READY_FOR_PRODUCTION) {
        if (!issue.closedOn) issue.closedOn = new Date();
      } else {
        issue.closedOn = null;
      }
    }

    await this.applyAssigneeAndProject(issue, dto, tenantId);

    let saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);

    // Only notify when the assignee actually changed to someone new -
    // not on every unrelated edit (status change, description tweak, etc).
    if (saved.assigneeUserId && saved.assigneeUserId !== previousAssigneeUserId) {
      this.eventEmitter.emit('issue.assigned', { issue: saved });
    }

    // Same "only on the change that matters" reasoning - only the
    // false -> true transition triggers the SLA email/heuristic, not
    // every save of an already-showstopper ticket.
    if (saved.showstopper && !previousShowstopper) {
      saved = await this.handleShowstopperFlagged(saved);
    }

    return saved;
  }

  // The assignee marks their work done and hands it to the Program
  // Manager. Only valid from "In Progress".
  async submitForReview(id: number, userId: number, userEmail: string, tenantId: number): Promise<Issue> {
    const issue = await this.findOne(id, tenantId);
    if (issue.status !== IssueStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Only an issue that's "In Progress" can be submitted for review (this one is "${issue.status}").`,
      );
    }
    issue.status = IssueStatus.IN_REVIEW;
    issue.submittedForReviewAt = new Date();
    issue.lastRejectionReason = null;

    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);
    this.eventEmitter.emit('issue.submittedForReview', { issue: saved, submittedByEmail: userEmail });
    return saved;
  }

  // Program Manager approves - moves to QA Testing (not straight to done
  // anymore; QA still has to sign off) and records who/when. Only valid
  // from "In Review".
  async approve(id: number, reviewerId: number, reviewerEmail: string, tenantId: number): Promise<Issue> {
    const issue = await this.findOne(id, tenantId);
    if (issue.status !== IssueStatus.IN_REVIEW) {
      throw new BadRequestException(
        `Only an issue that's "In Review" can be approved (this one is "${issue.status}").`,
      );
    }
    issue.status = IssueStatus.QA_TESTING;
    issue.reviewedByUserId = reviewerId;
    issue.reviewedByEmail = reviewerEmail;
    issue.reviewedAt = new Date();

    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);
    this.eventEmitter.emit('issue.approved', { issue: saved });
    return saved;
  }

  // Program Manager sends it back - returns to In Progress with an
  // optional note on what needs fixing. Only valid from "In Review".
  async reject(id: number, reviewerId: number, reviewerEmail: string, tenantId: number, reason?: string): Promise<Issue> {
    const issue = await this.findOne(id, tenantId);
    if (issue.status !== IssueStatus.IN_REVIEW) {
      throw new BadRequestException(
        `Only an issue that's "In Review" can be sent back (this one is "${issue.status}").`,
      );
    }
    issue.status = IssueStatus.IN_PROGRESS;
    issue.submittedForReviewAt = null;
    issue.reviewedByUserId = reviewerId;
    issue.reviewedByEmail = reviewerEmail;
    issue.reviewedAt = new Date();
    issue.lastRejectionReason = reason || null;
    issue.reopenedCount += 1;

    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);
    this.eventEmitter.emit('issue.rejected', { issue: saved, reason });
    return saved;
  }

  // QA passes it - the workflow's terminal state. Only valid from
  // "QA Testing".
  async qaApprove(id: number, qaUserId: number, qaUserEmail: string, tenantId: number): Promise<Issue> {
    const issue = await this.findOne(id, tenantId);
    if (issue.status !== IssueStatus.QA_TESTING) {
      throw new BadRequestException(
        `Only an issue that's "QA Testing" can be marked Ready for Production (this one is "${issue.status}").`,
      );
    }
    issue.status = IssueStatus.READY_FOR_PRODUCTION;
    issue.closedOn = new Date();
    issue.qaReviewedByUserId = qaUserId;
    issue.qaReviewedByEmail = qaUserEmail;
    issue.qaReviewedAt = new Date();

    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);
    this.eventEmitter.emit('issue.qaApproved', { issue: saved });
    return saved;
  }

  // QA finds a problem - sends it to QA Failed (not directly back to In
  // Progress, so a QA-flagged rework is trackable separately from a normal
  // first-pass build) with an optional note. The assignee moves it into In
  // Progress themselves, whenever they're ready to start fixing it - see
  // ALLOWED_SELF_SERVICE_TRANSITIONS above. Only valid from "QA Testing".
  async qaReject(id: number, qaUserId: number, qaUserEmail: string, tenantId: number, reason?: string): Promise<Issue> {
    const issue = await this.findOne(id, tenantId);
    if (issue.status !== IssueStatus.QA_TESTING) {
      throw new BadRequestException(
        `Only an issue that's "QA Testing" can be sent back (this one is "${issue.status}").`,
      );
    }
    issue.status = IssueStatus.QA_FAILED;
    issue.submittedForReviewAt = null;
    issue.qaReviewedByUserId = qaUserId;
    issue.qaReviewedByEmail = qaUserEmail;
    issue.qaReviewedAt = new Date();
    issue.lastRejectionReason = reason || null;
    issue.reopenedCount += 1;

    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);
    this.eventEmitter.emit('issue.qaRejected', { issue: saved, reason });
    return saved;
  }

  // The review queue - every showstopper claim still waiting on a human
  // decision. Newest first, same as every other listing here.
  findFlaggedShowstoppers(tenantId: number): Promise<Issue[]> {
    return this.issuesRepository.find({
      where: { showstopperReviewStatus: ShowstopperReviewStatus.PENDING, tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  // A Program Manager/QA/Admin's confirm-or-downgrade decision on a
  // flagged showstopper. Confirm just clears the Pending flag - the
  // showstopper stays as-is. Downgrade also flips showstopper back to
  // false, since the whole point of downgrading is "this shouldn't have
  // jumped the queue."
  async decideShowstopperReview(
    id: number,
    decision: 'confirm' | 'downgrade',
    reviewer: { id: number; email: string },
    tenantId: number,
  ): Promise<Issue> {
    const issue = await this.findOne(id, tenantId);
    if (issue.showstopperReviewStatus !== ShowstopperReviewStatus.PENDING) {
      throw new BadRequestException(`Issue #${id} has no pending showstopper review to decide.`);
    }

    issue.showstopperReviewStatus =
      decision === 'confirm' ? ShowstopperReviewStatus.CONFIRMED : ShowstopperReviewStatus.DOWNGRADED;
    if (decision === 'downgrade') {
      issue.showstopper = false;
    }
    issue.showstopperReviewedByUserId = reviewer.id;
    issue.showstopperReviewedByEmail = reviewer.email;
    issue.showstopperReviewedAt = new Date();

    const saved = await this.issuesRepository.save(issue);
    this.eventsGateway.emitIssueUpdated(saved);

    await this.auditLogService.record({
      userId: reviewer.id,
      userEmail: reviewer.email,
      action: AuditActions.SHOWSTOPPER_REVIEW_DECIDED,
      tenantId,
      entityType: 'Issue',
      entityId: saved.id,
      details: { decision },
    });

    return saved;
  }

  // Looks up the assignee/project by id and denormalizes their display info
  // onto the issue, so listing issues doesn't require extra joins.
  private async applyAssigneeAndProject(
    issue: Issue,
    dto: CreateIssueDto | UpdateIssueDto,
    tenantId: number,
  ): Promise<void> {
    if (dto.assigneeUserId !== undefined) {
      if (dto.assigneeUserId === null) {
        issue.assigneeUserId = null;
        issue.assigneeEmail = null;
      } else {
        const assignee = await this.usersService.findByIdAndTenant(dto.assigneeUserId, tenantId);
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
        const project = await this.projectsService.findOne(dto.projectId, tenantId);
        issue.projectId = project.id;
        issue.projectName = project.name;
      }
    }

    if (dto.sprintId !== undefined) {
      if (dto.sprintId === null) {
        issue.sprintId = null;
        issue.sprintName = null;
      } else {
        const sprint = await this.sprintsRepository.findOne({ where: { id: dto.sprintId, tenantId } });
        if (!sprint) {
          throw new NotFoundException(`Sprint #${dto.sprintId} not found`);
        }
        issue.sprintId = sprint.id;
        issue.sprintName = sprint.name;
      }
    }

    if (dto.moduleId !== undefined) {
      if (dto.moduleId === null) {
        issue.moduleId = null;
        issue.moduleName = null;
      } else {
        const module = await this.modulesRepository.findOne({ where: { id: dto.moduleId, tenantId } });
        if (!module) {
          throw new NotFoundException(`Module #${dto.moduleId} not found`);
        }
        issue.moduleId = module.id;
        issue.moduleName = module.name;
      }
    }
  }
}
