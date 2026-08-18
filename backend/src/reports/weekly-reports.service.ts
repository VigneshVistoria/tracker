import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThan, Not, Repository } from 'typeorm';
import { WeeklyReport } from './weekly-report.entity';
import { Issue, IssueStatus } from '../issues/issue.entity';
import { MailService } from '../mail/mail.service';

// A simple, tunable heuristic turning an issue's current status into a
// "how healthy is this work" score. Not a precise measurement - just a
// consistent way to roll up status distribution into one number per
// assignee. Adjust the weights here if the team wants a different feel.
const STATUS_HEALTH_WEIGHT: Record<IssueStatus, number> = {
  [IssueStatus.BACKLOG]: 20,
  [IssueStatus.IN_PROGRESS]: 60,
  [IssueStatus.IN_REVIEW]: 90,
  [IssueStatus.COMPLETED]: 100,
};

@Injectable()
export class WeeklyReportsService {
  constructor(
    @InjectRepository(WeeklyReport)
    private reportsRepository: Repository<WeeklyReport>,
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    private mailService: MailService,
  ) {}

  // Business week = Monday through Friday. Given any date, returns the
  // Monday..Friday range for the week it falls in.
  private getBusinessWeekRange(date: Date): { start: Date; end: Date } {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = new Date(d);
    start.setDate(d.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 4); // Friday
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private toDateOnly(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  async generate(referenceDate: Date, generatedByUserId?: number): Promise<WeeklyReport> {
    const { start: weekStart, end: weekEnd } = this.getBusinessWeekRange(referenceDate);
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(weekEnd);
    prevWeekEnd.setDate(prevWeekEnd.getDate() - 7);

    const [completedPreviousWeek, newThisWeek, carryForward, allActive] = await Promise.all([
      this.issuesRepository.find({
        where: { status: IssueStatus.COMPLETED, closedOn: Between(prevWeekStart, prevWeekEnd) },
        order: { closedOn: 'ASC' },
      }),
      this.issuesRepository.find({
        where: { createdAt: Between(weekStart, weekEnd) },
        order: { createdAt: 'ASC' },
      }),
      // Existed before this week and still not completed - rolled forward.
      this.issuesRepository.find({
        where: { status: Not(IssueStatus.COMPLETED), createdAt: LessThan(weekStart) },
        order: { createdAt: 'ASC' },
      }),
      // Every non-completed issue right now, for the assignee/performance
      // breakdown below.
      this.issuesRepository.find({ where: { status: Not(IssueStatus.COMPLETED) } }),
    ]);

    const allCompletedEver = await this.issuesRepository.find({ where: { status: IssueStatus.COMPLETED } });

    // Assignee-wise stats: completion percentage (all-time) and a
    // status-weighted "performance" score based on their current open work.
    const byAssignee = new Map<
      string,
      { assigneeEmail: string; totalAssigned: number; completedAllTime: number; currentOpen: Issue[] }
    >();

    const touch = (email: string) => {
      if (!byAssignee.has(email)) {
        byAssignee.set(email, { assigneeEmail: email, totalAssigned: 0, completedAllTime: 0, currentOpen: [] });
      }
      return byAssignee.get(email);
    };

    for (const issue of allActive) {
      if (!issue.assigneeEmail) continue;
      const entry = touch(issue.assigneeEmail);
      entry.totalAssigned += 1;
      entry.currentOpen.push(issue);
    }
    for (const issue of allCompletedEver) {
      if (!issue.assigneeEmail) continue;
      const entry = touch(issue.assigneeEmail);
      entry.totalAssigned += 1;
      entry.completedAllTime += 1;
    }

    const assigneeStats = Array.from(byAssignee.values())
      .map((entry) => {
        const completionPercent =
          entry.totalAssigned > 0 ? Math.round((entry.completedAllTime / entry.totalAssigned) * 100) : 0;
        const performancePercent =
          entry.currentOpen.length > 0
            ? Math.round(
                entry.currentOpen.reduce((sum, i) => sum + (STATUS_HEALTH_WEIGHT[i.status] ?? 0), 0) /
                  entry.currentOpen.length,
              )
            : 100; // nothing open = nothing dragging their score down
        return {
          assigneeEmail: entry.assigneeEmail,
          totalAssigned: entry.totalAssigned,
          completedAllTime: entry.completedAllTime,
          completionPercent,
          currentOpenCount: entry.currentOpen.length,
          performancePercent,
        };
      })
      .sort((a, b) => a.assigneeEmail.localeCompare(b.assigneeEmail));

    const totalIssues = allActive.length + allCompletedEver.length;
    const overall = {
      totalIssues,
      totalCompleted: allCompletedEver.length,
      totalOpen: allActive.length,
      completionPercent: totalIssues > 0 ? Math.round((allCompletedEver.length / totalIssues) * 100) : 0,
      statusBreakdown: {
        [IssueStatus.BACKLOG]: allActive.filter((i) => i.status === IssueStatus.BACKLOG).length,
        [IssueStatus.IN_PROGRESS]: allActive.filter((i) => i.status === IssueStatus.IN_PROGRESS).length,
        [IssueStatus.IN_REVIEW]: allActive.filter((i) => i.status === IssueStatus.IN_REVIEW).length,
        [IssueStatus.COMPLETED]: allCompletedEver.length,
      },
    };

    const data = {
      weekStartDate: this.toDateOnly(weekStart),
      weekEndDate: this.toDateOnly(weekEnd),
      previousWeekStartDate: this.toDateOnly(prevWeekStart),
      previousWeekEndDate: this.toDateOnly(prevWeekEnd),
      completedPreviousWeek: completedPreviousWeek.map(this.toSummary),
      carryForward: carryForward.map(this.toSummary),
      newThisWeek: newThisWeek.map(this.toSummary),
      assigneeStats,
      overall,
    };

    const report = this.reportsRepository.create({
      weekStartDate: this.toDateOnly(weekStart),
      weekEndDate: this.toDateOnly(weekEnd),
      data,
      generatedByUserId: generatedByUserId ?? null,
    });

    return this.reportsRepository.save(report);
  }

  private toSummary(issue: Issue) {
    return {
      id: issue.id,
      title: issue.title,
      status: issue.status,
      assigneeEmail: issue.assigneeEmail,
      projectName: issue.projectName,
      storyPoints: issue.storyPoints,
      createdAt: issue.createdAt,
      closedOn: issue.closedOn,
    };
  }

  findHistory(limit = 20): Promise<WeeklyReport[]> {
    return this.reportsRepository.find({ order: { weekStartDate: 'DESC' }, take: limit });
  }

  async findOne(id: number): Promise<WeeklyReport | null> {
    return this.reportsRepository.findOne({ where: { id } });
  }

  // Emails a plain-text-ish HTML summary of the report to every configured
  // executive - skipped silently if none are configured or SMTP isn't set
  // up yet (MailService handles that gracefully on its own).
  async emailReport(report: WeeklyReport): Promise<void> {
    const executives = this.mailService.getExecutiveEmails();
    if (executives.length === 0) return;

    const { data } = report;
    const html = `
      <h2>Weekly Report: ${data.weekStartDate} to ${data.weekEndDate}</h2>
      <p><strong>Overall completion:</strong> ${data.overall.completionPercent}% (${data.overall.totalCompleted} of ${data.overall.totalIssues} issues)</p>
      <p><strong>Completed last week (${data.previousWeekStartDate} to ${data.previousWeekEndDate}):</strong> ${data.completedPreviousWeek.length}</p>
      <p><strong>Carried forward into this week:</strong> ${data.carryForward.length}</p>
      <p><strong>New this week:</strong> ${data.newThisWeek.length}</p>
      <h3>By assignee</h3>
      <ul>
        ${data.assigneeStats
          .map(
            (a: any) =>
              `<li>${a.assigneeEmail}: ${a.completionPercent}% completion (${a.completedAllTime}/${a.totalAssigned}), performance ${a.performancePercent}%</li>`,
          )
          .join('')}
      </ul>
    `;

    // Send one email to the first executive, cc the rest - simplest way
    // to reuse the existing send() without a dedicated "no primary
    // recipient" path.
    const [primary, ...rest] = executives;
    await this.mailService.send(
      primary,
      `Weekly Report: ${data.weekStartDate} to ${data.weekEndDate}`,
      html,
      rest,
    );
  }
}
