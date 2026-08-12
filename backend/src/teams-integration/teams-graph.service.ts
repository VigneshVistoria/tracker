import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphAuthService } from './graph-auth.service';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

@Injectable()
export class TeamsGraphService {
  private readonly logger = new Logger(TeamsGraphService.name);

  constructor(
    private graphAuth: GraphAuthService,
    private config: ConfigService,
  ) {}

  private async authHeaders() {
    const token = await this.graphAuth.getAccessToken();
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  // Subscribes to new-message events on one channel. Channel message
  // subscriptions can live for a while, but we deliberately renew often
  // (see teams-renewal.service.ts) so a missed renewal never leaves a
  // long silent gap.
  async createChannelMessageSubscription(
    teamId: string,
    channelId: string,
    clientState: string,
  ): Promise<{ id: string; expirationDateTime: string }> {
    const notificationUrl = this.config.get<string>('MS_TEAMS_WEBHOOK_URL');
    if (!notificationUrl) {
      throw new InternalServerErrorException(
        'MS_TEAMS_WEBHOOK_URL is not set - this must be your backend\'s public HTTPS URL + /integrations/teams/webhook.',
      );
    }

    const expirationDateTime = new Date(Date.now() + 55 * 60 * 1000).toISOString(); // ~55 min out

    const res = await fetch(`${GRAPH_BASE}/subscriptions`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl,
        resource: `/teams/${teamId}/channels/${channelId}/messages`,
        expirationDateTime,
        clientState,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Failed to create subscription: ${res.status} ${text}`);
      throw new InternalServerErrorException(`Microsoft Graph rejected the subscription request: ${text}`);
    }

    return res.json();
  }

  async renewSubscription(graphSubscriptionId: string): Promise<{ expirationDateTime: string }> {
    const expirationDateTime = new Date(Date.now() + 55 * 60 * 1000).toISOString();

    const res = await fetch(`${GRAPH_BASE}/subscriptions/${graphSubscriptionId}`, {
      method: 'PATCH',
      headers: await this.authHeaders(),
      body: JSON.stringify({ expirationDateTime }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Failed to renew subscription ${graphSubscriptionId}: ${res.status} ${text}`);
      throw new InternalServerErrorException('Could not renew the Teams subscription.');
    }

    return res.json();
  }

  async deleteSubscription(graphSubscriptionId: string): Promise<void> {
    const res = await fetch(`${GRAPH_BASE}/subscriptions/${graphSubscriptionId}`, {
      method: 'DELETE',
      headers: await this.authHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      this.logger.warn(`Failed to delete subscription ${graphSubscriptionId}: ${res.status} ${text}`);
    }
  }

  // Notifications only tell us "something changed at this URL" - we still
  // have to fetch the actual message content ourselves.
  async getChannelMessage(teamId: string, channelId: string, messageId: string): Promise<any> {
    const res = await fetch(
      `${GRAPH_BASE}/teams/${teamId}/channels/${channelId}/messages/${messageId}`,
      { headers: await this.authHeaders() },
    );

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Failed to fetch message ${messageId}: ${res.status} ${text}`);
      throw new InternalServerErrorException('Could not fetch the Teams message content.');
    }

    return res.json();
  }

  // Resolves a work email to their Azure AD identity, needed to @mention
  // them properly (a plain-text "@Jane" in a message body does not
  // actually notify anyone - Graph requires a structured mention).
  async getUserByEmail(email: string): Promise<{ id: string; displayName: string } | null> {
    const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(email)}`, {
      headers: await this.authHeaders(),
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Failed to resolve user ${email}: ${res.status} ${text}`);
      return null;
    }

    const data = await res.json();
    return { id: data.id, displayName: data.displayName };
  }

  // The reverse lookup: given the Azure AD id of someone @mentioned in a
  // message, find their work email so we can match them against our own
  // user list.
  async getUserById(aadId: string): Promise<{ email: string | null; displayName: string } | null> {
    const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(aadId)}`, {
      headers: await this.authHeaders(),
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Failed to resolve Azure AD user ${aadId}: ${res.status} ${text}`);
      return null;
    }

    const data = await res.json();
    return { email: data.mail || data.userPrincipalName || null, displayName: data.displayName };
  }

  // Posts a message into a channel, optionally @mentioning one person by
  // their Azure AD identity so they get a real Teams notification.
  async sendChannelMessage(
    teamId: string,
    channelId: string,
    htmlContent: string,
    mention?: { aadId: string; displayName: string },
  ): Promise<any> {
    const body: any = {
      body: { contentType: 'html', content: htmlContent },
    };

    if (mention) {
      body.mentions = [
        {
          id: 0,
          mentionText: mention.displayName,
          mentioned: {
            user: { id: mention.aadId, displayName: mention.displayName, userIdentityType: 'aadUser' },
          },
        },
      ];
    }

    const res = await fetch(`${GRAPH_BASE}/teams/${teamId}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Failed to send channel message: ${res.status} ${text}`);
      throw new InternalServerErrorException('Could not post the message to Teams.');
    }

    return res.json();
  }
}
