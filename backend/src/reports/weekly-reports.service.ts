import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThan, Not, Repository } from 'typeorm';
import { WeeklyReport } from './weekly-report.entity';
import { Issue, IssueStatus, IssueCategory } from '../issues/issue.entity';
import { MailService } from '../mail/mail.service';
import { PdfPerformanceReportService, AssigneePerformanceStat } from './pdf-performance-report.service';

// A simple, tunable heuristic turning an issue's current status into a
// "how healthy is this work" score. Not a precise measurement - just a
// consistent way to roll up status distribution into one number per
// assignee. Adjust the weights here if the team wants a different feel.
const STATUS_HEALTH_WEIGHT: Record<IssueStatus, number> = {
  [IssueStatus.BACKLOG]: 20,
  [IssueStatus.IN_PROGRESS]: 60,
  [IssueStatus.IN_REVIEW]: 90,
  [IssueStatus.QA_TESTING]: 95,
  [IssueStatus.QA_FAILED]: 40,
  [IssueStatus.READY_FOR_PRODUCTION]: 100,
};

@Injectable()
export class WeeklyReportsService {
  constructor(
    @InjectRepository(WeeklyReport)
    private reportsRepository: Repository<WeeklyReport>,
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    private mailService: MailService,
    private pdfPerformanceReportService: PdfPerformanceReportService,
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
        where: { status: IssueStatus.READY_FOR_PRODUCTION, closedOn: Between(prevWeekStart, prevWeekEnd) },
        order: { closedOn: 'ASC' },
      }),
      this.issuesRepository.find({
        where: { createdAt: Between(weekStart, weekEnd) },
        order: { createdAt: 'ASC' },
      }),
      // Existed before this week and still not completed - rolled forward.
      this.issuesRepository.find({
        where: { status: Not(IssueStatus.READY_FOR_PRODUCTION), createdAt: LessThan(weekStart) },
        order: { createdAt: 'ASC' },
      }),
      // Every non-completed issue right now, for the assignee/performance
      // breakdown below.
      this.issuesRepository.find({ where: { status: Not(IssueStatus.READY_FOR_PRODUCTION) } }),
    ]);

    const allCompletedEver = await this.issuesRepository.find({ where: { status: IssueStatus.READY_FOR_PRODUCTION } });

    // Most recent prior report (any week before this one) - used purely to
    // compute a week-over-week trend per assignee below. Best-effort: if
    // there isn't one yet (first report ever), everyone is just "new".
    const prevReport = await this.reportsRepository.findOne({
      where: { weekStartDate: LessThan(this.toDateOnly(weekStart)) },
      order: { weekStartDate: 'DESC' },
    });
    const prevStatsByEmail = new Map<string, any>(
      ((prevReport?.data?.assigneeStats as any[]) || []).map((s: any) => [s.assigneeEmail, s]),
    );

    // Dependency Log lookups: only OPEN children can still be "blocking" -
    // a completed dependency ticket no longer holds anything up. Built from
    // allActive so this stays a simple in-memory index, no extra query.
    const openChildrenByParentId = new Map<number, Issue[]>();
    for (const issue of allActive) {
      if (issue.parentIssueId == null) continue;
      if (!openChildrenByParentId.has(issue.parentIssueId)) {
        openChildrenByParentId.set(issue.parentIssueId, []);
      }
      openChildrenByParentId.get(issue.parentIssueId).push(issue);
    }

    const DELAYED_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days with no status movement
    const now = new Date();
    const isDelayed = (issue: Issue) => now.getTime() - new Date(issue.updatedAt).getTime() >= DELAYED_AFTER_MS;
    const isRiskCategory = (issue: Issue) =>
      issue.showstopper === true ||
      issue.category === IssueCategory.CRITICAL ||
      issue.category === IssueCategory.SHOWSTOPPER;

    // Assignee-wise stats: completion percentage (all-time), the existing
    // status-weighted "performance" score, plus the richer breakdown the
    // per-assignee PDF performance report needs (delayed/blocked/risk
    // items, this-week completions, and a penalty-adjusted performance
    // rate). All of this is additive - the original fields above are
    // untouched, so the existing admin Weekly Reports UI keeps working.
    const byAssignee = new Map<
      string,
      {
        assigneeEmail: string;
        totalAssigned: number;
        completedAllTime: number;
        currentOpen: Issue[];
        completedThisWeek: Issue[];
      }
    >();

    const touch = (email: string) => {
      if (!byAssignee.has(email)) {
        byAssignee.set(email, {
          assigneeEmail: email,
          totalAssigned: 0,
          completedAllTime: 0,
          currentOpen: [],
          completedThisWeek: [],
        });
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
      if (issue.closedOn && issue.closedOn >= weekStart && issue.closedOn <= weekEnd) {
        entry.completedThisWeek.push(issue);
      }
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

        const blockedItems = entry.currentOpen.filter((i) => (openChildrenByParentId.get(i.id) || []).length > 0);
        const blockedIds = new Set(blockedItems.map((i) => i.id));
        const delayedItems = entry.currentOpen.filter((i) => isDelayed(i));
        const carryForwardItems = entry.currentOpen.filter((i) => new Date(i.createdAt) < weekStart);
        const dependencyItems = Array.from(
          new Map(
            blockedItems
              .flatMap((i) => (openChildrenByParentId.get(i.id) || []).map((dep) => [dep.id, dep] as const))
          ).values(),
        );
        const riskItems = entry.currentOpen.filter((i) => blockedIds.has(i.id) || isRiskCategory(i));

        // Performance Rate: completion % minus a flat penalty per Delayed
        // and per Blocked item, floored at 0. Deliberately simple and
        // tunable - see the report doc for the agreed definition.
        const performanceRate = Math.max(
          0,
          completionPercent - delayedItems.length * 5 - blockedItems.length * 5,
        );

        // Week-over-week trend vs the most recent prior report, if any.
        const prevStat = prevStatsByEmail.get(entry.assigneeEmail);
        const trend =
          !prevStat || prevStat.performanceRate == null
            ? { direction: 'new' as const, performanceRateDelta: null, completionPercentDelta: null }
            : (() => {
                const performanceRateDelta = performanceRate - prevStat.performanceRate;
                const completionPercentDelta = completionPercent - prevStat.completionPercent;
                const direction =
                  performanceRateDelta > 0 ? ('up' as const) : performanceRateDelta < 0 ? ('down' as const) : ('flat' as const);
                return { direction, performanceRateDelta, completionPercentDelta };
              })();

        return {
          assigneeEmail: entry.assigneeEmail,
          totalAssigned: entry.totalAssigned,
          completedAllTime: entry.completedAllTime,
          completionPercent,
          currentOpenCount: entry.currentOpen.length,
          performancePercent,
          currentOpenItems: entry.currentOpen.map(this.toSummary),
          completedThisWeek: entry.completedThisWeek.map(this.toSummary),
          carryForwardItems: carryForwardItems.map(this.toSummary),
          delayedItems: delayedItems.map(this.toSummary),
          blockedItems: blockedItems.map(this.toSummary),
          dependencyItems: dependencyItems.map(this.toSummary),
          riskItems: riskItems.map(this.toSummary),
          performanceRate,
          trend,
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
        [IssueStatus.QA_TESTING]: allActive.filter((i) => i.status === IssueStatus.QA_TESTING).length,
        [IssueStatus.QA_FAILED]: allActive.filter((i) => i.status === IssueStatus.QA_FAILED).length,
        [IssueStatus.READY_FOR_PRODUCTION]: allCompletedEver.length,
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
      // Additive fields for the per-assignee PDF performance report -
      // existing consumers (admin Weekly Reports UI) simply ignore these.
      updatedAt: issue.updatedAt,
      category: issue.category,
      showstopper: issue.showstopper,
      parentIssueId: issue.parentIssueId,
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

  // Builds one PDF per assignee (executive summary, KPIs, task details,
  // carry-forward, dependencies & risks, performance insights) and emails
  // it to that assignee with a short summary in the body. Skips anyone
  // with no assigneeEmail on file. A broken PDF or send for one assignee
  // is logged-and-skipped by the underlying services rather than aborting
  // the whole batch, so one bad record can't block everyone else's report.
  async emailPerformanceReports(report: WeeklyReport): Promise<{ sent: string[]; skipped: string[] }> {
    const { data } = report;
    const meta = {
      weekStartDate: data.weekStartDate,
      weekEndDate: data.weekEndDate,
      previousWeekStartDate: data.previousWeekStartDate,
      previousWeekEndDate: data.previousWeekEndDate,
    };

    const sent: string[] = [];
    const skipped: string[] = [];

    for (const stat of data.assigneeStats as AssigneePerformanceStat[]) {
      if (!stat.assigneeEmail) {
        skipped.push('(no email on file)');
        continue;
      }
      try {
        const pdfBuffer = await this.pdfPerformanceReportService.buildAssigneeReport(meta, stat);
        const subject = `Weekly Performance Report – ${meta.weekEndDate}`;
        const html = this.buildPerformanceEmailHtml(meta, stat);
        await this.mailService.sendToAssignee(stat.assigneeEmail, subject, html, [
          {
            filename: `weekly-performance-report-${meta.weekEndDate}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ]);
        sent.push(stat.assigneeEmail);
      } catch (err: any) {
        skipped.push(stat.assigneeEmail);
      }
    }

    return { sent, skipped };
  }

  // Builds a single assignee's performance PDF without emailing anyone -
  // used by the admin-only manual "download" endpoint so a report can be
  // previewed/reviewed before deciding to send it out for real. Returns
  // null if that assignee has no stats in this report (e.g. bad/unknown
  // email), so the controller can turn that into a clean 404.
  async buildPerformancePdfBuffer(
    report: WeeklyReport,
    assigneeEmail: string,
  ): Promise<{ buffer: Buffer; filename: string } | null> {
    const { data } = report;
    const meta = {
      weekStartDate: data.weekStartDate,
      weekEndDate: data.weekEndDate,
      previousWeekStartDate: data.previousWeekStartDate,
      previousWeekEndDate: data.previousWeekEndDate,
    };

    const stat = (data.assigneeStats as AssigneePerformanceStat[]).find(
      (s) => s.assigneeEmail?.toLowerCase() === assigneeEmail?.toLowerCase(),
    );
    if (!stat) {
      return null;
    }

    const buffer = await this.pdfPerformanceReportService.buildAssigneeReport(meta, stat);
    const filename = `weekly-performance-report-${meta.weekEndDate}-${assigneeEmail}.pdf`;
    return { buffer, filename };
  }

  private buildPerformanceEmailHtml(meta: any, stat: AssigneePerformanceStat): string {
    const dependencyNote =
      stat.dependencyItems.length > 0
        ? `${stat.dependencyItems.length} open dependency ticket(s): ${stat.dependencyItems
            .map((d: any) => `#${d.id} ${d.title}`)
            .join(', ')}`
        : 'None';
    return `
      <h2>Weekly Performance Report – ${meta.weekEndDate}</h2>
      <p>Hi ${stat.assigneeEmail},</p>
      <p>Your performance report for the week of ${meta.weekStartDate} to ${meta.weekEndDate} is attached as a PDF. Summary:</p>
      <ul>
        <li><strong>Overall completion:</strong> ${stat.completionPercent}%</li>
        <li><strong>Performance rate:</strong> ${stat.performanceRate}%</li>
        <li><strong>Open items:</strong> ${stat.currentOpenCount} (${stat.delayedItems.length} delayed, ${stat.blockedItems.length} blocked)</li>
        <li><strong>Carry-forward items:</strong> ${stat.carryForwardItems.length}</li>
        <li><strong>Key dependencies:</strong> ${dependencyNote}</li>
      </ul>
      <p>See the attached PDF for full task details, risks, and recommended next steps.</p>
    `;
  }
}
