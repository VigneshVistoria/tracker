import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeamsSubscription } from './teams-subscription.entity';
import { TeamsGraphService } from './teams-graph.service';
import { Issue } from '../issues/issue.entity';

@Injectable()
export class TeamsAssignmentNotifierService {
  private readonly logger = new Logger(TeamsAssignmentNotifierService.name);

  constructor(
    @InjectRepository(TeamsSubscription)
    private subscriptionsRepo: Repository<TeamsSubscription>,
    private teamsGraph: TeamsGraphService,
  ) {}

  @OnEvent('issue.assigned')
  async handleIssueAssigned(payload: { issue: Issue }): Promise<void> {
    const { issue } = payload;

    try {
      await this.notify(issue);
    } catch (err) {
      // A Teams outage or misconfiguration should never break ticket
      // assignment itself - log it and move on.
      this.logger.error(`Failed to send Teams assignment notification for issue #${issue.id}: ${err.message}`);
    }
  }

  private async notify(issue: Issue): Promise<void> {
    if (!issue.assigneeEmail) return;

    // Reuses the same channel-per-project mapping set up for inbound
    // ticket creation - no separate "notification channel" to configure.
    if (!issue.projectId) {
      this.logger.debug(`Issue #${issue.id} has no project - nowhere to post the notification.`);
      return;
    }

    const subscription = await this.subscriptionsRepo.findOne({
      where: { projectId: issue.projectId, active: true },
    });

    if (!subscription) {
      this.logger.debug(`No Teams channel connected for project #${issue.projectId} - skipping notification.`);
      return;
    }

    const person = await this.teamsGraph.getUserByEmail(issue.assigneeEmail);
    if (!person) {
      this.logger.warn(`Could not resolve ${issue.assigneeEmail} to a Teams account - skipping mention.`);
      return;
    }

    const html = `<at id="0">${person.displayName}</at> you\u2019ve been assigned issue #${issue.id}: <strong>${issue.title}</strong>`;

    await this.teamsGraph.sendChannelMessage(subscription.teamId, subscription.channelId, html, {
      aadId: person.id,
      displayName: person.displayName,
    });
  }
}
