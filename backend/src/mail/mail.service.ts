import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail, { MailDataRequired } from '@sendgrid/mail';

type MailAttachment = { filename: string; content: Buffer; contentType?: string };

// Sends real email via SendGrid's API once SENDGRID_API_KEY and MAIL_FROM
// are set (switched from SMTP 2026-09-26 - no admin access to enable
// Microsoft 365 SMTP AUTH). Until then, every call just logs what would
// have been sent and returns - so the rest of the app (assignment/review/
// approval notifications, weekly reports) keeps working, and starts
// actually emailing the moment the key is added, with no code changes.
// MAIL_FROM must be a sender verified in SendGrid (Sender Authentication)
// or every send is rejected.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string | null;
  private readonly configured: boolean;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    this.from = this.configService.get<string>('MAIL_FROM') || null;
    this.configured = Boolean(apiKey && this.from);
    if (this.configured) {
      sgMail.setApiKey(apiKey);
    } else if (apiKey || this.from) {
      this.logger.warn('Email disabled - SENDGRID_API_KEY and MAIL_FROM must both be set.');
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  // Same { filename, content: Buffer, contentType } shape callers have
  // always passed - SendGrid wants base64 strings, so convert here.
  private buildMessage(to: string[], subject: string, html: string, cc?: string[], attachments?: MailAttachment[]): MailDataRequired {
    // SendGrid rejects a message that lists the same address in both to
    // and cc (e.g. an executive who is also the assignee).
    const toLower = new Set(to.map((t) => t.toLowerCase()));
    const ccList = [...new Set((cc || []).filter((c) => !toLower.has(c.toLowerCase())))];
    return {
      from: this.from,
      to,
      cc: ccList.length ? ccList : undefined,
      subject,
      html,
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
        type: a.contentType,
        disposition: 'attachment',
      })),
    };
  }

  private describeError(err: any): string {
    const details = err?.response?.body?.errors?.map((e: any) => e.message).join('; ');
    return details || err?.message || String(err);
  }

  // For a user-triggered send (someone clicked "Email" and is waiting on
  // the result) - unlike send(), missing config or a SendGrid error is
  // thrown back to the caller instead of logged and swallowed.
  async sendOrThrow(to: string[], subject: string, html: string, attachments?: MailAttachment[]): Promise<void> {
    if (!this.configured) {
      throw new ServiceUnavailableException('Email is not set up on this server yet (SendGrid settings are missing).');
    }
    try {
      await sgMail.send(this.buildMessage(to, subject, html, undefined, attachments));
    } catch (err: any) {
      this.logger.error(`Failed to send email "${subject}" to ${to.join(', ')}: ${this.describeError(err)}`);
      throw new ServiceUnavailableException('The email service rejected the email - please try again later.');
    }
  }

  // Comma-separated list in EXECUTIVE_EMAILS, e.g.
  // "cfo@vistoriasystems.com,coo@vistoriasystems.com"
  getExecutiveEmails(): string[] {
    const raw = this.configService.get<string>('EXECUTIVE_EMAILS', '');
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async send(to: string, subject: string, html: string, cc?: string[], attachments?: MailAttachment[]): Promise<void> {
    if (!this.configured) {
      this.logger.debug(
        `Email not sent (SendGrid not configured yet) - would have sent "${subject}" to ${to}` +
          (cc && cc.length ? ` (cc: ${cc.join(', ')})` : '') +
          (attachments && attachments.length
            ? ` (attachments: ${attachments.map((a) => a.filename).join(', ')})`
            : ''),
      );
      return;
    }

    try {
      await sgMail.send(this.buildMessage([to], subject, html, cc, attachments));
    } catch (err: any) {
      // A broken mail service should never break the workflow action that
      // triggered the notification - log it and move on.
      this.logger.error(`Failed to send email "${subject}" to ${to}: ${this.describeError(err)}`);
    }
  }

  // Convenience for the common case: notify one person, cc every
  // configured executive.
  sendToAssignee(to: string, subject: string, html: string, attachments?: MailAttachment[]): Promise<void> {
    return this.send(to, subject, html, this.getExecutiveEmails(), attachments);
  }
}
