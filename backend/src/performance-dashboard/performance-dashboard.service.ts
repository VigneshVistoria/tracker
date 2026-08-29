import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Issue, IssueStatus } from '../issues/issue.entity';
import { UsersService } from '../users/users.service';
import { SlaService } from '../sla/sla.service';
import { PerformanceScoringService } from '../performance-scoring/performance-scoring.service';

export type PeriodType = 'day' | 'week' | 'month';
export type PerformanceStatus = 'Excellent' | 'Good' | 'Needs Improvement';

const DAY_MS = 24 * 60 * 60 * 1000;

function statusFor(score: number): PerformanceStatus {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Good';
  return 'Needs Improvement';
}

// Monday..Sunday, matching the business-week convention
// WeeklyReportsService already uses (Monday start), extended through
// Sunday rather than stopping at Friday - a performance dashboard's
// "this week" should cover every day's completions, not just business
// days.
function getPeriodWindow(period: PeriodType, referenceDate: Date): { start: Date; end: Date } {
  const d = new Date(referenceDate);
  d.setHours(0, 0, 0, 0);

  if (period === 'day') {
    const start = new Date(d);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (period === 'week') {
    const day = d.getDay(); // 0=Sun..6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = new Date(d);
    start.setDate(d.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function isWithin(date: Date | null, start: Date, end: Date): boolean {
  if (!date) return false;
  const t = new Date(date).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export interface AssigneeRow {
  assigneeEmail: string;
  assigneeName: string;
  totalAssigned: number;
  completed: number; // within the selected period
  completedAllTime: number;
  inProgress: number; // live
  overdue: number; // live
  qaFailed: number; // live
  reopened: number; // all-time, current issues
  lateDependencies: number; // within the selected period
  completionPercent: number; // all-time
  performanceScore: number;
  status: PerformanceStatus;
}

export interface TrendPoint {
  label: string;
  completed: number;
}

export interface OverdueAnalysisRow {
  issueId: number;
  title: string;
  assigneeEmail: string;
  projectName: string;
  daysLate: number;
}

export interface QaFailedAnalysisRow {
  issueId: number;
  title: string;
  assigneeEmail: string;
  projectName: string;
  qaReviewedAt: Date;
}

export interface PerformanceDashboardResult {
  period: PeriodType;
  periodStart: string;
  periodEnd: string;
  scope: 'all' | 'self';
  rows: AssigneeRow[];
  trend: TrendPoint[];
  overdueAnalysis: OverdueAnalysisRow[];
  qaFailedAnalysis: QaFailedAnalysisRow[];
  topPerformers: AssigneeRow[] | null;
  bottomPerformers: AssigneeRow[] | null;
}

@Injectable()
export class PerformanceDashboardService {
  constructor(
    @InjectRepository(Issue)
    private issuesRepository: Repository<Issue>,
    private usersService: UsersService,
    private slaService: SlaService,
    private performanceScoringService: PerformanceScoringService,
  ) {}

  async getDashboard(params: {
    period: PeriodType;
    referenceDate: Date;
    tenantId: number;
    projectId?: number;
    onlyAssigneeEmail?: string; // set for Developer/QA - restricts everything to just this person
  }): Promise<PerformanceDashboardResult> {
    const { period, referenceDate, tenantId, projectId, onlyAssigneeEmail } = params;
    const { start, end } = getPeriodWindow(period, referenceDate);

    const where: any = { assigneeUserId: Not(IsNull()), tenantId };
    if (projectId) where.projectId = projectId;
    const allAssignedIssues = await this.issuesRepository.find({ where });

    const [slaConfig, scoringConfig, users] = await Promise.all([
      this.slaService.getConfig(tenantId),
      this.performanceScoringService.getEffectiveConfig(tenantId),
      this.usersService.findAll(tenantId),
    ]);
    const nameByEmail = new Map(users.map((u) => [u.email, u.fullName || u.email]));

    const byAssignee = new Map<string, Issue[]>();
    for (const issue of allAssignedIssues) {
      if (!issue.assigneeEmail) continue;
      if (onlyAssigneeEmail && issue.assigneeEmail !== onlyAssigneeEmail) continue;
      if (!byAssignee.has(issue.assigneeEmail)) byAssignee.set(issue.assigneeEmail, []);
      byAssignee.get(issue.assigneeEmail).push(issue);
    }

    // Late-dependency attribution is independent of who the dependency
    // itself is assigned to - it's whoever owned the PARENT issue at the
    // moment it was created (see the Issue entity comments on both
    // columns). Computed as its own pass keyed by that attributed user,
    // not by filtering each assignee's own issues array, since the two
    // are frequently different people (confirmed by testing: a
    // dependency assigned to one person can still penalize another).
    const userIdToEmail = new Map(users.map((u) => [u.id, u.email]));
    const lateDependencyCountByEmail = new Map<string, number>();
    for (const issue of allAssignedIssues) {
      if (!issue.wasCreatedMidDevelopment || issue.lateDependencyAttributedToUserId == null) continue;
      if (!isWithin(issue.createdAt, start, end)) continue;
      const attributedEmail = userIdToEmail.get(issue.lateDependencyAttributedToUserId);
      if (!attributedEmail) continue;
      if (onlyAssigneeEmail && attributedEmail !== onlyAssigneeEmail) continue;
      lateDependencyCountByEmail.set(attributedEmail, (lateDependencyCountByEmail.get(attributedEmail) || 0) + 1);
      // Make sure they show up as a row even if they have no other
      // currently-assigned issues of their own right now.
      if (!byAssignee.has(attributedEmail)) byAssignee.set(attributedEmail, []);
    }

    const now = referenceDate;
    const rows: AssigneeRow[] = Array.from(byAssignee.entries()).map(([email, issues]) => {
      const totalAssigned = issues.length;
      const completedIssues = issues.filter((i) => i.status === IssueStatus.READY_FOR_PRODUCTION);
      const completedAllTime = completedIssues.length;
      const completionPercent = totalAssigned > 0 ? Math.round((completedAllTime / totalAssigned) * 100) : 0;

      const completedInPeriod = completedIssues.filter((i) => isWithin(i.closedOn, start, end));
      const inProgress = issues.filter((i) => i.status === IssueStatus.IN_PROGRESS).length;
      const qaFailed = issues.filter((i) => i.status === IssueStatus.QA_FAILED).length;
      const reopened = issues.reduce((sum, i) => sum + (i.reopenedCount || 0), 0);
      const lateDependencies = lateDependencyCountByEmail.get(email) || 0;

      // Overdue (live) + the penalty inputs, both derived from each
      // issue's resolved SLA state rather than a separate due-date
      // concept - reuses Feature 2's SlaService directly.
      let overdue = 0;
      let overduePenaltyTotal = 0;
      let earlyCompletedInPeriod = 0;
      for (const issue of issues) {
        const sla = this.slaService.computeForIssue(issue, slaConfig);
        const isOpen = issue.status !== IssueStatus.READY_FOR_PRODUCTION;

        if (isOpen && sla.state === 'Breached') {
          overdue += 1;
          const daysLate = Math.max(0, Math.floor((now.getTime() - new Date(sla.dueAt).getTime()) / DAY_MS));
          overduePenaltyTotal += this.performanceScoringService.resolveOverduePenaltyPercent(daysLate, scoringConfig);
        } else if (!isOpen && sla.state === 'Breached' && isWithin(issue.closedOn, start, end)) {
          const daysLate = Math.max(
            0,
            Math.floor((new Date(issue.closedOn).getTime() - new Date(sla.dueAt).getTime()) / DAY_MS),
          );
          overduePenaltyTotal += this.performanceScoringService.resolveOverduePenaltyPercent(daysLate, scoringConfig);
        }

        if (!isOpen && sla.state === 'Met' && isWithin(issue.closedOn, start, end)) {
          earlyCompletedInPeriod += 1;
        }
      }

      const { config } = scoringConfig;
      const rawScore =
        completionPercent -
        overduePenaltyTotal -
        qaFailed * config.qaFailedWeightPercent -
        reopened * config.reopenedWeightPercent -
        lateDependencies * config.lateDependencyWeightPercent +
        earlyCompletedInPeriod * config.earlyCompletionBonusPercent;
      const performanceScore = Math.max(0, Math.min(100, Math.round(rawScore)));

      return {
        assigneeEmail: email,
        assigneeName: nameByEmail.get(email) || email,
        totalAssigned,
        completed: completedInPeriod.length,
        completedAllTime,
        inProgress,
        overdue,
        qaFailed,
        reopened,
        lateDependencies,
        completionPercent,
        performanceScore,
        status: statusFor(performanceScore),
      };
    });

    rows.sort((a, b) => b.performanceScore - a.performanceScore);

    const scope: 'all' | 'self' = onlyAssigneeEmail ? 'self' : 'all';
    const relevantIssuesForAnalysis = onlyAssigneeEmail
      ? allAssignedIssues.filter((i) => i.assigneeEmail === onlyAssigneeEmail)
      : allAssignedIssues;

    return {
      period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      scope,
      rows,
      trend: this.buildTrend(period, referenceDate, relevantIssuesForAnalysis),
      overdueAnalysis: this.buildOverdueAnalysis(relevantIssuesForAnalysis, slaConfig, now),
      qaFailedAnalysis: this.buildQaFailedAnalysis(relevantIssuesForAnalysis),
      topPerformers: scope === 'all' ? rows.slice(0, 3) : null,
      bottomPerformers: scope === 'all' ? rows.slice(-3).reverse() : null,
    };
  }

  // N buckets of "how many completed" leading up to and including the
  // reference date's period - 7 days, 8 weeks, or 6 months, matching
  // whichever granularity is currently selected.
  private buildTrend(period: PeriodType, referenceDate: Date, issues: Issue[]): TrendPoint[] {
    const bucketCount = period === 'day' ? 7 : period === 'week' ? 8 : 6;
    const points: TrendPoint[] = [];

    for (let i = bucketCount - 1; i >= 0; i--) {
      const bucketDate = new Date(referenceDate);
      if (period === 'day') bucketDate.setDate(bucketDate.getDate() - i);
      else if (period === 'week') bucketDate.setDate(bucketDate.getDate() - i * 7);
      else bucketDate.setMonth(bucketDate.getMonth() - i);

      const { start, end } = getPeriodWindow(period, bucketDate);
      const completed = issues.filter(
        (issue) => issue.status === IssueStatus.READY_FOR_PRODUCTION && isWithin(issue.closedOn, start, end),
      ).length;

      const label =
        period === 'day'
          ? start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : period === 'week'
            ? `Week of ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
            : start.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

      points.push({ label, completed });
    }

    return points;
  }

  private buildOverdueAnalysis(issues: Issue[], slaConfig: any, now: Date): OverdueAnalysisRow[] {
    return issues
      .filter((i) => i.status !== IssueStatus.READY_FOR_PRODUCTION)
      .map((issue) => {
        const sla = this.slaService.computeForIssue(issue, slaConfig);
        if (sla.state !== 'Breached') return null;
        const daysLate = Math.max(0, Math.floor((now.getTime() - new Date(sla.dueAt).getTime()) / DAY_MS));
        return {
          issueId: issue.id,
          title: issue.title,
          assigneeEmail: issue.assigneeEmail,
          projectName: issue.projectName,
          daysLate,
        };
      })
      .filter((r): r is OverdueAnalysisRow => r !== null)
      .sort((a, b) => b.daysLate - a.daysLate);
  }

  private buildQaFailedAnalysis(issues: Issue[]): QaFailedAnalysisRow[] {
    return issues
      .filter((i) => i.status === IssueStatus.QA_FAILED)
      .map((issue) => ({
        issueId: issue.id,
        title: issue.title,
        assigneeEmail: issue.assigneeEmail,
        projectName: issue.projectName,
        qaReviewedAt: issue.qaReviewedAt,
      }))
      .sort((a, b) => new Date(b.qaReviewedAt).getTime() - new Date(a.qaReviewedAt).getTime());
  }
}
