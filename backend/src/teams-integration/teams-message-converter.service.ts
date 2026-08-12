import { Injectable, Logger } from '@nestjs/common';
import { IssuesService } from '../issues/issues.service';
import { Issue, IssueMode } from '../issues/issue.entity';
import { TeamsSubscription } from './teams-subscription.entity';
import { TeamsGraphService } from './teams-graph.service';
import { UsersService } from '../users/users.service';

const SYSTEM_EMAIL = 'teams-integration@system.local';

function stripHtml(input: string): string {
  return (input || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '\u2026';
}

@Injectable()
export class TeamsMessageConverterService {
  private readonly logger = new Logger(TeamsMessageConverterService.name);

  constructor(
    private issuesService: IssuesService,
    private usersService: UsersService,
    private teamsGraph: TeamsGraphService,
  ) {}

  // Only creates a ticket if the message actually @mentions someone who
  // is a real user in this app (matched by email) - an ordinary message
  // with no recognized teammate tagged is ignored entirely. The tagged
  // person becomes the ticket's assignee automatically.
  //
  // `message` is a Microsoft Graph chatMessage resource:
  // https://learn.microsoft.com/graph/api/resources/chatmessage
  async convertAndCreateIssue(message: any, subscription: TeamsSubscription): Promise<Issue | null> {
    const assigneeUserId = await this.resolveTaggedLocalUser(message);

    if (!assigneeUserId) {
      this.logger.debug('No recognized teammate was tagged in this message - skipping ticket creation.');
      return null;
    }

    const rawBody = message?.body?.content || '';
    const text = message?.body?.contentType === 'html' ? stripHtml(rawBody) : rawBody;

    const title = truncate(text || `New message in ${subscription.channelName || 'Teams channel'}`, 120);

    const description = [
      text,
      '',
      `\u2014 Automatically created from a Microsoft Teams message in "${subscription.channelName || subscription.channelId}".`,
    ].join('\n');

    return this.issuesService.create(
      {
        title,
        description,
        mode: IssueMode.AUTO,
        projectId: subscription.projectId || undefined,
        assigneeUserId,
      },
      // Auto-created issues are attributed to a system identity, not a
      // real logged-in user, since there's no session for a Teams message.
      null,
      SYSTEM_EMAIL,
    );
  }

  // Walks the message's @mentions, resolves each mentioned person's
  // Azure AD identity to a work email via Graph, and returns the first
  // one that matches an existing user in this app.
  private async resolveTaggedLocalUser(message: any): Promise<number | null> {
    const mentions = message?.mentions || [];

    for (const mention of mentions) {
      const aadId = mention?.mentioned?.user?.id;
      if (!aadId) continue;

      const person = await this.teamsGraph.getUserById(aadId);
      if (!person?.email) continue;

      const localUser = await this.usersService.findByEmail(person.email);
      if (localUser) return localUser.id;
    }

    return null;
  }
}
