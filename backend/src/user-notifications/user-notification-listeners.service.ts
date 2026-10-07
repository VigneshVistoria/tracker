import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserNotificationsService } from './user-notifications.service';
import { UsersService } from '../users/users.service';
import { Issue } from '../issues/issue.entity';
import { TestCase } from '../test-cases/test-case.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { ClientTicketNotifyEvent } from '../client-portal/client-tickets.service';

// Turns domain events into in-app notifications. "Personal only" scope
// (confirmed with the user 2026-10-06): each notification goes to the one
// person the event is about - no team-wide broadcasts, except escalations,
// which are addressed to the PM role by definition. Email/Teams
// notifications (src/notifications) are separate and unchanged.
//
// Every handler is wrapped so a failure here can never surface as an
// unhandled rejection or affect the request that emitted the event.

export interface TaskAssignedEvent {
  tenantId: number;
  taskId: number;
  title: string;
  assigneeUserId: number;
  actorUserId: number;
  actorEmail: string;
  isDefect?: boolean;
}

export interface TaskReviewDecidedEvent {
  tenantId: number;
  taskId: number;
  title: string;
  assigneeUserId: number | null;
  actorUserId: number;
  actorEmail: string;
  decision: 'approved' | 'rejected';
  reviewType: 'qa' | 'peer';
}

export interface TaskPeerReviewRequestedEvent {
  tenantId: number;
  taskId: number;
  title: string;
  reviewerUserId: number;
  actorUserId: number;
  actorEmail: string;
}

export interface DependencyTicketEvent {
  tenantId: number;
  ticketId: number;
  parentTaskId: number;
  title: string | null;
  recipientUserId: number;
  actorUserId: number;
  actorEmail: string;
}

@Injectable()
export class UserNotificationListenersService {
  private readonly logger = new Logger(UserNotificationListenersService.name);

  constructor(
    private notifications: UserNotificationsService,
    private usersService: UsersService,
  ) {}

  private async actorName(actorUserId: number | null | undefined, fallback: string | null | undefined, tenantId: number) {
    if (!actorUserId) return fallback ?? null;
    const actor = await this.usersService.findByIdAndTenant(actorUserId, tenantId);
    return actor?.fullName || actor?.email || fallback || null;
  }

  private async safely(label: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`${label} notification failed: ${err}`);
    }
  }

  // ---------- Tasks ----------

  @OnEvent('task.assigned')
  onTaskAssigned(e: TaskAssignedEvent) {
    return this.safely('task.assigned', async () => {
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.assigneeUserId,
        type: e.isDefect ? 'defect.assigned' : 'task.assigned',
        title: `${e.isDefect ? 'Defect' : 'Task'} #${e.taskId} assigned to you`,
        body: e.title,
        link: `/tasks/${e.taskId}`,
        actorUserId: e.actorUserId,
        actorName: await this.actorName(e.actorUserId, e.actorEmail, e.tenantId),
      });
    });
  }

  @OnEvent('task.reviewDecided')
  onTaskReviewDecided(e: TaskReviewDecidedEvent) {
    return this.safely('task.reviewDecided', async () => {
      if (!e.assigneeUserId) return;
      const review = e.reviewType === 'peer' ? 'Peer review' : 'QA';
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.assigneeUserId,
        type: e.decision === 'approved' ? 'task.reviewApproved' : 'task.reviewRejected',
        title: e.decision === 'approved' ? `${review} approved task #${e.taskId}` : `${review} sent back task #${e.taskId}`,
        body: e.title,
        link: `/tasks/${e.taskId}`,
        actorUserId: e.actorUserId,
        actorName: await this.actorName(e.actorUserId, e.actorEmail, e.tenantId),
      });
    });
  }

  @OnEvent('task.peerReviewRequested')
  onPeerReviewRequested(e: TaskPeerReviewRequestedEvent) {
    return this.safely('task.peerReviewRequested', async () => {
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.reviewerUserId,
        type: 'task.peerReviewRequested',
        title: `Peer review requested on task #${e.taskId}`,
        body: e.title,
        link: `/tasks/${e.taskId}`,
        actorUserId: e.actorUserId,
        actorName: await this.actorName(e.actorUserId, e.actorEmail, e.tenantId),
      });
    });
  }

  @OnEvent('task.escalatedToPm')
  onTaskEscalated({ task, escalatedByEmail }: { task: ProjectTask; escalatedByEmail: string }) {
    return this.safely('task.escalatedToPm', async () => {
      const pms = await this.usersService.findProgramManagers(task.tenantId);
      await Promise.all(
        pms.map((pm) =>
          this.notifications.create({
            tenantId: task.tenantId,
            userId: pm.id,
            type: 'task.escalated',
            title: `Task #${task.id} needs a PM decision`,
            body: task.title,
            link: `/tasks/${task.id}`,
            actorName: escalatedByEmail,
          }),
        ),
      );
    });
  }

  @OnEvent('dependencyTicket.created')
  onDependencyTicketCreated(e: DependencyTicketEvent) {
    return this.safely('dependencyTicket.created', async () => {
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.recipientUserId,
        type: 'dependency.assigned',
        title: `Dependency on task #${e.parentTaskId} assigned to you`,
        body: e.title,
        link: '/dependency-clearance',
        actorUserId: e.actorUserId,
        actorName: await this.actorName(e.actorUserId, e.actorEmail, e.tenantId),
      });
    });
  }

  @OnEvent('dependencyTicket.resolved')
  onDependencyTicketResolved(e: DependencyTicketEvent) {
    return this.safely('dependencyTicket.resolved', async () => {
      await this.notifications.create({
        tenantId: e.tenantId,
        userId: e.recipientUserId,
        type: 'dependency.resolved',
        title: `Dependency on task #${e.parentTaskId} was cleared`,
        body: e.title,
        link: `/tasks/${e.parentTaskId}`,
        actorUserId: e.actorUserId,
        actorName: await this.actorName(e.actorUserId, e.actorEmail, e.tenantId),
      });
    });
  }

  // ---------- Issues (existing events) ----------

  private issueToAssignee(issue: Issue, type: string, title: string) {
    return this.safely(type, async () => {
      if (!issue?.assigneeUserId) return;
      await this.notifications.create({
        tenantId: issue.tenantId,
        userId: issue.assigneeUserId,
        type,
        title,
        body: issue.title,
        link: `/issues/${issue.id}`,
      });
    });
  }

  @OnEvent('issue.assigned')
  onIssueAssigned({ issue }: { issue: Issue }) {
    return this.issueToAssignee(issue, 'issue.assigned', `Issue #${issue.id} assigned to you`);
  }

  @OnEvent('issue.approved')
  onIssueApproved({ issue }: { issue: Issue }) {
    return this.issueToAssignee(issue, 'issue.approved', `Issue #${issue.id} approved - now with QA`);
  }

  @OnEvent('issue.rejected')
  onIssueRejected({ issue }: { issue: Issue }) {
    return this.issueToAssignee(issue, 'issue.rejected', `Issue #${issue.id} sent back for more work`);
  }

  @OnEvent('issue.qaApproved')
  onIssueQaApproved({ issue }: { issue: Issue }) {
    return this.issueToAssignee(issue, 'issue.qaApproved', `Issue #${issue.id} passed QA`);
  }

  @OnEvent('issue.qaRejected')
  onIssueQaRejected({ issue }: { issue: Issue }) {
    return this.issueToAssignee(issue, 'issue.qaRejected', `Issue #${issue.id} failed QA`);
  }

  @OnEvent('issue.slaDueSoon')
  onIssueSlaDueSoon({ issue }: { issue: Issue }) {
    return this.issueToAssignee(issue, 'issue.slaDueSoon', `Issue #${issue.id} is due within the hour`);
  }

  // ---------- Client portal tickets (Stage 2) ----------
  // ClientTicketsService has already picked the recipients (and never
  // includes a client user on an internal note); this only delivers.
  // Personal notifications only - nothing goes to the tenant-wide room.

  @OnEvent('clientTicket.notify')
  onClientTicketNotify(e: ClientTicketNotifyEvent) {
    return this.safely(e.type, async () => {
      for (const r of e.recipients) {
        await this.notifications.create({
          tenantId: e.tenantId,
          userId: r.userId,
          type: e.type,
          title: e.title,
          body: e.body,
          link: r.link,
          actorUserId: e.actorUserId,
          actorName: await this.actorName(e.actorUserId, null, e.tenantId),
        });
      }
    });
  }

  // ---------- Test cases (existing event) ----------

  @OnEvent('testCases.reviewed')
  onTestCasesReviewed({ testCases, decision }: { testCases: TestCase[]; decision: string }) {
    return this.safely('testCases.reviewed', async () => {
      const approved = decision === 'approve';
      await Promise.all(
        (testCases || [])
          .filter((tc) => tc.submittedForReviewByUserId)
          .map((tc) =>
            this.notifications.create({
              tenantId: tc.tenantId,
              userId: tc.submittedForReviewByUserId as number,
              type: approved ? 'testCase.approved' : 'testCase.rejected',
              title: `${tc.caseNumber || `Test case #${tc.id}`} ${approved ? 'approved for execution' : 'sent back'}`,
              body: tc.title,
              link: `/qa/test-cases/${tc.id}`,
            }),
          ),
      );
    });
  }
}
