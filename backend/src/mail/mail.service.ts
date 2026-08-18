import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// Sends real email once SMTP_* env vars are set. Until then, every call
// just logs what would have been sent and returns - so the rest of the
// app (assignment/review/approval notifications, weekly reports) can be
// built and tested today, and start actually emailing the moment SMTP
// credentials are added later, with no code changes needed.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.configService.get<number>('SMTP_PORT', 587),
        secure: this.configService.get<string>('SMTP_SECURE') === 'true',
        auth: {
          user: this.configService.get<string>('SMTP_USER'),
          pass: this.configService.get<string>('SMTP_PASS'),
        },
      });
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

  async send(to: string, subject: string, html: string, cc?: string[]): Promise<void> {
    if (!this.transporter) {
      this.logger.debug(
        `Email not sent (SMTP not configured yet) - would have sent "${subject}" to ${to}` +
          (cc && cc.length ? ` (cc: ${cc.join(', ')})` : ''),
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM') || this.configService.get<string>('SMTP_USER'),
        to,
        cc: cc && cc.length ? cc.join(',') : undefined,
        subject,
        html,
      });
    } catch (err: any) {
      // A broken mail server should never break the workflow action that
      // triggered the notification - log it and move on.
      this.logger.error(`Failed to send email "${subject}" to ${to}: ${err.message}`);
    }
  }

  // Convenience for the common case: notify one person, cc every
  // configured executive.
  sendToAssignee(to: string, subject: string, html: string): Promise<void> {
    return this.send(to, subject, html, this.getExecutiveEmails());
  }
}
