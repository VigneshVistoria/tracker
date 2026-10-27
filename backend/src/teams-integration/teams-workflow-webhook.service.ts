import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Posts an Adaptive Card to a Teams group chat through a Teams Workflows
// webhook ("Post to a chat when a webhook request is received"), set up in
// Teams on the chat itself - confirmed with the user 2026-10-12 as the way
// to reach a group chat. The existing Graph integration
// (TeamsGraphService) can only target channels and is left untouched.
//
// TEAMS_QA_WEBHOOK_URL holds the workflow's address. It carries its own
// signature, so it is treated as a secret: it is never logged, never
// returned, and error messages never include it. Unset = feature off.
//
// postCard() never throws and never takes longer than SEND_TIMEOUT_MS - a
// Teams outage must never block or roll back the ticket action that
// triggered it. Callers fire it from event listeners, after the action
// has already been saved.

const SEND_TIMEOUT_MS = 5000;
const MAX_TEXT = 500;

export interface TicketCardInput {
  // e.g. 'QA rejected task' - shown as the card heading.
  heading: string;
  ticketLabel: string; // e.g. 'Task #123: Login page crashes'
  facts: Array<{ title: string; value: string | null | undefined }>;
  // Free text (reject reason, defect description) - plain text, cut to MAX_TEXT.
  text?: { label: string; value: string | null | undefined };
  // Who to @mention. Workflows resolves the mention by work email.
  mention?: { email: string; name: string } | null;
  url: string;
}

// Plain text only, single spaces, no control characters, cut to `max`.
export function cleanText(value: string | null | undefined, max = MAX_TEXT): string {
  const text = (value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// The Workflows webhook payload: one Adaptive Card. Pure, so the card can
// be checked in tests without sending anything.
export function buildTicketCard(input: TicketCardInput) {
  const mentionText = input.mention ? `<at>${cleanText(input.mention.name, 100)}</at>` : null;
  const body: any[] = [
    { type: 'TextBlock', text: cleanText(input.heading, 100), weight: 'Bolder', size: 'Medium', wrap: true },
    { type: 'TextBlock', text: cleanText(input.ticketLabel, 300), wrap: true, spacing: 'Small' },
    {
      type: 'FactSet',
      facts: input.facts
        .map((f) => ({ title: cleanText(f.title, 40), value: cleanText(f.value, 200) }))
        .filter((f) => f.value !== ''),
    },
  ];
  if (mentionText) body.push({ type: 'TextBlock', text: `Assigned to ${mentionText}`, wrap: true });
  const text = input.text ? cleanText(input.text.value) : '';
  if (input.text && text) {
    body.push({ type: 'TextBlock', text: `${cleanText(input.text.label, 40)}:`, weight: 'Bolder', wrap: true, spacing: 'Medium' });
    body.push({ type: 'TextBlock', text, wrap: true, spacing: 'None' });
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          actions: [{ type: 'Action.OpenUrl', title: 'Open in Tracker', url: input.url }],
          ...(mentionText
            ? {
                msteams: {
                  entities: [
                    { type: 'mention', text: mentionText, mentioned: { id: input.mention!.email, name: cleanText(input.mention!.name, 100) } },
                  ],
                },
              }
            : {}),
        },
      },
    ],
  };
}

@Injectable()
export class TeamsWorkflowWebhookService {
  private readonly logger = new Logger(TeamsWorkflowWebhookService.name);

  constructor(private readonly config: ConfigService) {}

  private webhookUrl(): string | null {
    const url = (this.config.get<string>('TEAMS_QA_WEBHOOK_URL') || '').trim();
    return url.startsWith('https://') ? url : null;
  }

  isConfigured(): boolean {
    return this.webhookUrl() !== null;
  }

  // The Tracker link for a ticket - FRONTEND_URL is already set for CORS.
  ticketUrl(taskId: number): string {
    const base = (this.config.get<string>('FRONTEND_URL') || '').replace(/\/+$/, '');
    return `${base}/tasks/${taskId}`;
  }

  // Sends one card. Returns true if Teams accepted it. Never throws.
  // `context` (e.g. 'task #123 rejected') is the only thing that identifies
  // the message in logs - never the address, never the card content.
  async postCard(card: unknown, context: string): Promise<boolean> {
    const url = this.webhookUrl();
    if (!url) {
      this.logger.debug(`Teams QA notification skipped for ${context}: TEAMS_QA_WEBHOOK_URL is not set.`);
      return false;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Status only - the response body can echo request details.
        this.logger.warn(`Teams QA notification failed for ${context}: HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      // Name/code only - a fetch error's message or cause can include the host.
      const reason = err?.name === 'TimeoutError' ? `timed out after ${SEND_TIMEOUT_MS}ms` : err?.cause?.code || err?.name || 'error';
      this.logger.warn(`Teams QA notification failed for ${context}: ${reason}`);
      return false;
    }
  }
}
