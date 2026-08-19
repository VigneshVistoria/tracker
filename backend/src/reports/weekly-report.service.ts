import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Issue, IssueStatus } from '../issues/issue.entity';
import { User } from '../users/user.entity';
import { MailService } from '../mail/mail.service';

interface AssigneeGroup {
  email: string;
  name: string;
  issues: Issue[];
}

@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger(WeeklyReportService.name);

  constructor(
    @InjectRepository(Issue) private issuesRepo: Repository<Issue>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    private mailService: MailService,
  ) {}

  // Fires every Friday at 17:30 server time.
  @Cron('30 17 * * 5')
  async handleWeeklyReportCron() {
    this.logger.log('Running scheduled weekly status report job...');
    await this.sendWeeklyReports();
  }

  async sendWeeklyReports() {
    const { weekStart, weekEnd } = this.currentWeekRange();

    const allIssues = await this.issuesRepo.find();
    const assignedIssues = allIssues.filter((i) => !!i.assigneeEmail);

    const byAssignee = new Map<string, AssigneeGroup>();
    for (const issue of assignedIssues) {
      const key = issue.assigneeEmail;
      if (!byAssignee.has(key)) {
        byAssignee.set(key, { email: key, name: key, issues: [] });
      }
      byAssignee.get(key)!.issues.push(issue);
    }

    if (byAssignee.size === 0) {
      this.logger.log('No assigned issues found - skipping weekly report send.');
      return;
    }

    const users = await this.usersRepo.find();
    const userByEmail = new Map(users.map((u) => [u.email, u]));
    for (const group of byAssignee.values()) {
      const user = userByEmail.get(group.email);
      if (user?.fullName) group.name = user.fullName;
    }

    for (const group of byAssignee.values()) {
      await this.sendReportFor(group, weekStart, weekEnd);
    }

    this.logger.log(`Weekly status reports sent to ${byAssignee.size} assignee(s).`);
  }

  private async sendReportFor(group: AssigneeGroup, weekStart: Date, weekEnd: Date) {
    const completedThisWeek = group.issues.filter(
      (i) =>
        i.status === IssueStatus.COMPLETED &&
        i.closedOn &&
        i.closedOn >= weekStart &&
        i.closedOn <= weekEnd,
    );
    const carryForward = group.issues.filter((i) => i.status !== IssueStatus.COMPLETED);

    const totalAssigned = group.issues.length;
    const totalCompleted = group.issues.filter((i) => i.status === IssueStatus.COMPLETED).length;
    const completionPct = totalAssigned === 0 ? 0 : Math.round((totalCompleted / totalAssigned) * 100);
    const rating = this.ratingFor(completionPct);
    const weekEndLabel = this.formatDate(weekEnd);

    const html = this.renderEmail({
      name: group.name,
      weekEndLabel,
      completedThisWeek,
      carryForward,
      completionPct,
      rating,
    });

    // sendToAssignee already CCs every configured executive automatically -
    // see mail.service.ts. No need to build that list here.
    await this.mailService.sendToAssignee(
      group.email,
      `Weekly Status Report - ${group.name} - Week Ending ${weekEndLabel}`,
      html,
    );
  }

  private ratingFor(pct: number): 'Excellent' | 'Average' | 'Poor' {
    if (pct >= 80) return 'Excellent';
    if (pct >= 50) return 'Average';
    return 'Poor';
  }

  private currentWeekRange() {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 4);
    weekEnd.setHours(23, 59, 59, 999);

    return { weekStart, weekEnd };
  }

  private formatDate(d: Date) {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  private renderEmail(data: {
    name: string;
    weekEndLabel: string;
    completedThisWeek: Issue[];
    carryForward: Issue[];
    completionPct: number;
    rating: string;
  }) {
    const list = (issues: Issue[]) =>
      issues.length
        ? `<ul>${issues
            .map(
              (i) =>
                `<li>#${i.id} - ${this.escape(i.title)}${
                  i.projectName ? ` (${this.escape(i.projectName)})` : ''
                }</li>`,
            )
            .join('')}</ul>`
        : '<p style="color:#666;">None</p>';

    const ratingColor =
      data.rating === 'Excellent' ? '#1a7f37' : data.rating === 'Average' ? '#9a6700' : '#b42318';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="margin-bottom:4px;">Weekly Status Report</h2>
        <p style="color:#555; margin-top:0;">
          Assignee: <strong>${this.escape(data.name)}</strong> &middot; Week Ending ${data.weekEndLabel}
        </p>

        <h3>Completed Items - Current Week</h3>
        ${list(data.completedThisWeek)}

        <h3>Carry-Forward Items for Next Week</h3>
        ${list(data.carryForward)}

        <h3>Performance Summary</h3>
        <p>
          Completion: <strong>${data.completionPct}%</strong><br/>
          Rating: <strong style="color:${ratingColor};">${data.rating}</strong>
        </p>
      </div>
    `;
  }

  private escape(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
