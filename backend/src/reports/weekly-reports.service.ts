import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, Not, Repository } from 'typeorm';
import { WeeklyReport } from './weekly-report.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskPriority } from '../tasks/task-priority.enum';
import { HOLD_CLOSED_STATUSES, JUNK_STATUS } from '../tasks/tasks.service';
import {
  TaskStatusPercent,
  TASK_STATUSES,
  TASK_STATUS_PERCENT_DEFAULTS,
} from '../task-status-config/task-status-percent.entity';
import { TeamSettings } from '../team-settings/team-settings.entity';
import { TEAM_SETTINGS_DEFAULTS, dateInZone, isValidTimeZone, startOfDayInZone } from '../team-settings/time-zone';
import { MailService } from '../mail/mail.service';
import { PdfPerformanceReportService, AssigneePerformanceStat } from './pdf-performance-report.service';
import { UsersService } from '../users/users.service';

// Reads project_tasks (tasks and defects, isDefect) - the old issues table
// this used to read is empty since the move to project tasks (fixed
// 2026-10-26). Done = Pass/Released, dated by completedAt. Junk is left
// out everywhere, same as the rest of the app. Hold/Closed are neither
// open nor done (same rule as TasksService/KPI): they only show in the
// status breakdown, never in open/carry-forward/delayed counts.
const DONE_STATUSES = ['Pass', 'Released - No Showstoppers', 'Released - With Showstoppers'];
const NOT_OPEN_STATUSES = [...DONE_STATUSES, ...HOLD_CLOSED_STATUSES, JUNK_STATUS];

// YYYY-MM-DD arithmetic in UTC, so the server's own zone never matters.
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class WeeklyReportsService {
  constructor(
    @InjectRepository(WeeklyReport)
    private reportsRepository: Repository<WeeklyReport>,
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TeamSettings)
    private teamSettingsRepository: Repository<TeamSettings>,
    @InjectRepository(TaskStatusPercent)
    private statusPercentRepository: Repository<TaskStatusPercent>,
    private mailService: MailService,
    private pdfPerformanceReportService: PdfPerformanceReportService,
    private usersService: UsersService,
  ) {}

  // Business week = Monday 00:00 through Friday 23:59:59.999 in the team's
  // time zone (team_settings, default Africa/Addis_Ababa) - not the
  // server's zone, which is UTC. Returns the instants for the queries and
  // the YYYY-MM-DD Monday/Friday for display.
  private async getBusinessWeekRange(
    date: Date,
    tenantId: number,
  ): Promise<{ start: Date; end: Date; mondayDate: string; fridayDate: string }> {
    const settings = await this.teamSettingsRepository.findOne({ where: { tenantId } });
    const timeZone = isValidTimeZone(settings?.timeZone) ? settings!.timeZone : TEAM_SETTINGS_DEFAULTS.timeZone;
    const today = dateInZone(date, timeZone);
    const mondayDate = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const fridayDate = addDays(mondayDate, 4);
    const start = startOfDayInZone(mondayDate, timeZone);
    const end = new Date(startOfDayInZone(addDays(mondayDate, 5), timeZone).getTime() - 1);
    return { start, end, mondayDate, fridayDate };
  }

  async generate(referenceDate: Date, tenantId: number, generatedByUserId?: number): Promise<WeeklyReport> {
    const week = await this.getBusinessWeekRange(referenceDate, tenantId);
    const { start: weekStart, end: weekEnd } = week;
    const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevWeekEnd = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [completedPreviousWeek, newThisWeek, carryForward, allActive, allCompletedEver, holdClosed] = await Promise.all([
      this.tasksRepository.find({
        where: { status: In(DONE_STATUSES), completedAt: Between(prevWeekStart, prevWeekEnd), tenantId },
        order: { completedAt: 'ASC' },
      }),
      this.tasksRepository.find({
        where: { status: Not(JUNK_STATUS), createdAt: Between(weekStart, weekEnd), tenantId },
        order: { createdAt: 'ASC' },
      }),
      // Existed before this week and still open - rolled forward.
      this.tasksRepository.find({
        where: { status: Not(In(NOT_OPEN_STATUSES)), createdAt: LessThan(weekStart), tenantId },
        order: { createdAt: 'ASC' },
      }),
      // Every open task/defect right now, for the assignee/performance
      // breakdown below.
      this.tasksRepository.find({ where: { status: Not(In(NOT_OPEN_STATUSES)), tenantId } }),
      this.tasksRepository.find({ where: { status: In(DONE_STATUSES), tenantId } }),
      this.tasksRepository.find({ where: { status: In(HOLD_CLOSED_STATUSES), tenantId } }),
    ]);

    // Per-status "how far along" weights for the performance score - the
    // admin-editable Task Status % config, falling back to its seed
    // defaults for any status with no row.
    const percentRows = await this.statusPercentRepository.find({ where: { tenantId } });
    const statusWeight: Record<string, number> = {
      ...TASK_STATUS_PERCENT_DEFAULTS,
      ...Object.fromEntries(percentRows.map((r) => [r.status, r.percent])),
    };

    // Most recent prior report (any week before this one) - used purely to
    // compute a week-over-week trend per assignee below. Best-effort: if
    // there isn't one yet (first report ever), everyone is just "new".
    const prevReport = await this.reportsRepository.findOne({
      where: { weekStartDate: LessThan(week.mondayDate), tenantId },
      order: { weekStartDate: 'DESC' },
    });
    const prevStatsByEmail = new Map<string, any>(
      ((prevReport?.data?.assigneeStats as any[]) || []).map((s: any) => [s.assigneeEmail, s]),
    );

    // For display only (PDF header, "By assignee" summary, email greeting) -
    // the actual send-to address everywhere else stays assigneeEmail.
    const allUsers = await this.usersService.findAll(tenantId);
    const fullNameByEmail = new Map(allUsers.map((u) => [u.email, u.fullName]));

    // Dependency Log lookups: only OPEN children can still be "blocking" -
    // a completed dependency ticket no longer holds anything up. Built from
    // allActive so this stays a simple in-memory index, no extra query.
    const openChildrenByParentId = new Map<number, ProjectTask[]>();
    for (const issue of allActive) {
      if (issue.parentTaskId == null) continue;
      if (!openChildrenByParentId.has(issue.parentTaskId)) {
        openChildrenByParentId.set(issue.parentTaskId, []);
      }
      openChildrenByParentId.get(issue.parentTaskId).push(issue);
    }

    const DELAYED_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days with no status movement
    const now = new Date();
    const isDelayed = (issue: ProjectTask) => now.getTime() - new Date(issue.updatedAt).getTime() >= DELAYED_AFTER_MS;
    const isRiskCategory = (issue: ProjectTask) =>
      issue.priority === TaskPriority.IMMEDIATE || issue.status === 'Escalated';

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
        currentOpen: ProjectTask[];
        completedThisWeek: ProjectTask[];
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
      if (issue.completedAt && issue.completedAt >= weekStart && issue.completedAt <= weekEnd) {
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
                entry.currentOpen.reduce((sum, i) => sum + (statusWeight[i.status] ?? 0), 0) /
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
          assigneeFullName: fullNameByEmail.get(entry.assigneeEmail) || entry.assigneeEmail,
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

    // Completion % is done / (open + done) - Hold/Closed sit outside it,
    // shown only in the breakdown. Breakdown keys are the real task
    // statuses in workflow order, Junk left out, zero-count ones dropped.
    const totalIssues = allActive.length + allCompletedEver.length;
    const everyCounted = [...allActive, ...allCompletedEver, ...holdClosed];
    const countSplit = (isDefect: boolean) => ({
      open: allActive.filter((i) => i.isDefect === isDefect).length,
      completed: allCompletedEver.filter((i) => i.isDefect === isDefect).length,
      newThisWeek: newThisWeek.filter((i) => i.isDefect === isDefect).length,
      completedThisWeek: allCompletedEver.filter(
        (i) => i.isDefect === isDefect && i.completedAt && i.completedAt >= weekStart && i.completedAt <= weekEnd,
      ).length,
    });
    const overall = {
      totalIssues,
      totalCompleted: allCompletedEver.length,
      totalOpen: allActive.length,
      completionPercent: totalIssues > 0 ? Math.round((allCompletedEver.length / totalIssues) * 100) : 0,
      tasks: countSplit(false),
      defects: countSplit(true),
      statusBreakdown: Object.fromEntries(
        TASK_STATUSES.filter((s) => s !== JUNK_STATUS)
          .map((s) => [s, everyCounted.filter((i) => i.status === s).length] as const)
          .filter(([, n]) => n > 0),
      ),
    };

    const data = {
      weekStartDate: week.mondayDate,
      weekEndDate: week.fridayDate,
      previousWeekStartDate: addDays(week.mondayDate, -7),
      previousWeekEndDate: addDays(week.fridayDate, -7),
      completedPreviousWeek: completedPreviousWeek.map(this.toSummary),
      carryForward: carryForward.map(this.toSummary),
      newThisWeek: newThisWeek.map(this.toSummary),
      assigneeStats,
      overall,
    };

    const report = this.reportsRepository.create({
      weekStartDate: week.mondayDate,
      weekEndDate: week.fridayDate,
      data,
      generatedByUserId: generatedByUserId ?? null,
      tenantId,
    });

    return this.reportsRepository.save(report);
  }

  private toSummary(issue: ProjectTask) {
    return {
      id: issue.id,
      title: issue.title,
      status: issue.status,
      isDefect: issue.isDefect,
      assigneeEmail: issue.assigneeEmail,
      projectName: issue.projectName,
      createdAt: issue.createdAt,
      closedOn: issue.completedAt,
      // Additive fields for the per-assignee PDF performance report -
      // existing consumers (admin Weekly Reports UI) simply ignore these.
      updatedAt: issue.updatedAt,
      priority: issue.priority,
      parentIssueId: issue.parentTaskId,
    };
  }

  findHistory(tenantId: number, limit = 20): Promise<WeeklyReport[]> {
    // Newest generation first within a week - a week can have several
    // saved reports (Monday job, Saturday job, manual regenerate).
    return this.reportsRepository.find({
      where: { tenantId },
      order: { weekStartDate: 'DESC', generatedAt: 'DESC' },
      take: limit,
    });
  }

  async findOne(id: number, tenantId: number): Promise<WeeklyReport | null> {
    return this.reportsRepository.findOne({ where: { id, tenantId } });
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
              `<li>${a.assigneeFullName || a.assigneeEmail}: ${a.completionPercent}% completion (${a.completedAllTime}/${a.totalAssigned}), performance ${a.performancePercent}%</li>`,
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
      <p>Hi ${stat.assigneeFullName || stat.assigneeEmail},</p>
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
