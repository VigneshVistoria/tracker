import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { NON_VERDICT_ROUND_STATUSES, TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { UsersService } from '../users/users.service';
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';
import { effectiveDueDate, isPastEffectiveDue, PM_REVIEW_STATUS } from '../tasks/pm-review';
import { RETURNED_TO_QA_STATUS } from '../tasks/return-to-qa';
import { PerformanceMetricsService } from '../performance-metrics/performance-metrics.service';

// A task in one of these is done and can no longer be "missed" - mirrors
// COMPLETED_STATUSES in TasksService/DeveloperTaskWorkboard.js exactly
// (no shared constants module between features in this codebase, kept in
// sync by hand). 'Junk' tasks are excluded one level up, in
// computeReport() below, same as KpiService.computeMetrics() excludes
// them entirely rather than scoring them as incomplete/overdue.
const TERMINAL_TASK_STATUSES = ['Pass', 'Released - No Showstoppers', 'Released - With Showstoppers'];

// A task is still actually awaiting a review decision in one of these -
// mirrors QA_REVIEW_PENDING_STATUSES in frontend/lib/developerTaskStats.js.
const QA_REVIEW_PENDING_STATUSES = ['Feedback', 'Re-Feedback', 'Peer Review', 'Re-Peer-Review'];

// Not counted for Late to QA (2026-10-27, confirmed with the user): parked
// (Hold), closed without finishing (Closed) or with the PM (Escalated).
const LATE_TO_QA_EXCLUDED_STATUSES = ['Hold', 'Closed', 'Escalated'];

// The "Flagged" thresholds are editable settings (Admin -> Performance
// Metrics Settings, PerformanceMetricSettings) since 2026-10-27 - read per
// report, never fixed here. Flagged if ANY dimension meets its threshold.

// 'submitted_late': the final submission for review came after the
// effective Due date. 'still_with_developer': not submitted (or sent back
// and not resubmitted) and the effective Due date has passed.
export type LateToQaReason = 'submitted_late' | 'still_with_developer';

export interface LateToQaItem {
  taskId: number;
  title: string;
  reason: LateToQaReason;
  dueDate: string;
  // dueDate plus the working days spent waiting for the PM.
  effectiveDueDate: string;
  // The final submission for review (YYYY-MM-DD), or null if none.
  submittedAt: string | null;
  // Calendar days past the effective Due date (to the submission, or to
  // today if still with the developer).
  daysLate: number;
}

export interface OverdueInReviewItem {
  taskId: number;
  title: string;
  status: string;
  submittedAt: string | null;
  qaReviewDueDate: string;
  daysOverdue: number;
}

export interface EscalationItem {
  taskId: number;
  title: string;
  escalatedAt: string | null;
  comment: string | null;
}

export interface VagueNoteItem {
  taskId: number;
  title: string;
  resolutionExcerpt: string;
  reason: string | null;
  submittedAt: string | null;
}

export interface DeveloperNonComplianceRow {
  userId: number;
  email: string;
  fullName: string | null;
  role: UserRole;
  // True if any of the three dimensions below is individually flagged -
  // computed once here so the dashboard/PDF never need to re-derive it
  // (and can't drift out of sync with the per-dimension flags).
  flagged: boolean;
  lateToQa: { count: number; flagged: boolean; items: LateToQaItem[] };
  // Information only - the reviewers' 5-working-day deadline, never
  // counted against the developer or in `flagged`.
  overdueInReview: { count: number; items: OverdueInReviewItem[] };
  rejectionRate: { submissions: number; rejections: number; rate: number; flagged: boolean };
  escalations: { count: number; flagged: boolean; items: EscalationItem[] };
  // Pilot dimension - `checked` is how many of this developer's in-range
  // submissions actually got a Gemini verdict (excludes ones skipped by
  // the rate limiter or lost to an API error), separate from `count`
  // (how many of those checked ones were flagged vague) so a developer
  // with 0 flagged out of 0 checked doesn't read the same as 0 out of 20.
  resolutionQuality: { checked: number; count: number; flagged: boolean; items: VagueNoteItem[] };
}

export interface NonComplianceReportSummary {
  totalDevelopers: number;
  flaggedCount: number;
  flaggedNames: string[];
  // The three totals below are summed across FLAGGED developers only -
  // "how bad is the problem we're flagging", not a whole-team average
  // diluted by developers with nothing wrong.
  lateToQaTotal: number;
  rejectionsTotal: number;
  submissionsTotal: number;
  blendedRejectionRate: number;
  escalationsTotal: number;
  vagueNotesTotal: number;
}

export interface NonComplianceReportResult {
  range: { from: string | null; to: string | null };
  projectId: number | null;
  summary: NonComplianceReportSummary;
  developers: DeveloperNonComplianceRow[];
  thresholds: {
    lateToQaCount: number;
    rejectionRatePercent: number;
    rejectionRateMinSubmissions: number;
    escalationCount: number;
    vagueNotesCount: number;
  };
  // Kept as a seam for any future dimension that isn't ready yet - empty
  // now that dimension 4 (vague/poor resolution notes) is live. The
  // frontend only renders a "Coming soon" card when this is non-empty.
  deferredDimensions: Array<{ key: string; label: string; status: 'deferred'; reason: string }>;
}

function toDateOnly(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

// Inclusive on both ends, matching the date-range filters already used
// elsewhere (e.g. TasksService.findTeam()'s dueFrom/dueTo). Undefined
// from/to means "no bound on that side" (All Time when both are
// undefined).
function inRange(dateStr: string | null, from?: string, to?: string): boolean {
  if (!dateStr) return false;
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Calendar days from one YYYY-MM-DD to a later one.
const daysBetween = (fromDate: string, toDate: string): number =>
  Math.round((new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) / 86400000);

// `resolution` is sanitizeRichText()'d HTML - strip tags and cap length so
// a flagged item's excerpt in the report is plain, scannable text, not a
// wall of markup.
function excerptText(html: string, maxLen = 160): string {
  const plain = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}...` : plain;
}

@Injectable()
export class NonComplianceReportService {
  constructor(
    @InjectRepository(ProjectTask)
    private tasksRepository: Repository<ProjectTask>,
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
    private usersService: UsersService,
    private performanceMetricsService: PerformanceMetricsService,
  ) {}

  // Live query over current data for whatever range is selected -
  // deliberately not a frozen-snapshot model like KpiPeriodScore, since
  // this report is for investigating a specific developer/period on
  // demand, not tracking a score's history over time. Reuses
  // KpiService.computeMetrics()'s query shapes (Not('Junk'), the same
  // "fetch once, reuse across the batch" idiom) without depending on
  // that service directly, since the two features answer different
  // questions (a rolled-up score vs. a drillable list of specific
  // offending tasks/rounds).
  async computeReport(
    tenantId: number,
    projectId: number | undefined,
    from: string | undefined,
    to: string | undefined,
  ): Promise<NonComplianceReportResult> {
    const today = toDateOnly(new Date());
    const settings = await this.performanceMetricsService.getSettings(tenantId);
    const thresholds = {
      lateToQaCount: settings.lateToQaFlagCount,
      rejectionRatePercent: settings.rejectionRateFlagPercent,
      rejectionRateMinSubmissions: settings.rejectionRateMinSubmissions,
      escalationCount: settings.escalationFlagCount,
      vagueNotesCount: settings.vagueNotesFlagCount,
    };

    // SMOKE_TEST_EMAIL is the one automated test account this codebase
    // already documents (scripts/smoke-check.sh, run after every deploy/
    // rollback) - excluding it here reuses that existing identifier
    // rather than hardcoding a new list. There's no general "system
    // account" flag on the User entity, so any *other* test account would
    // still show up - not something this report can detect on its own.
    const smokeTestEmail = process.env.SMOKE_TEST_EMAIL;
    const allUsers = await this.usersService.findAll(tenantId);
    const developers = allUsers.filter(
      (u) => DEVELOPER_EQUIVALENT_ROLES.includes(u.role) && u.email !== smokeTestEmail,
    );
    const developerIds = developers.map((d) => d.id);

    // Same Not('Junk') exclusion as KpiService.computeMetrics() - a task
    // that turned out not to be a real issue shouldn't count against the
    // developer on any of these dimensions.
    const tasks = developerIds.length
      ? await this.tasksRepository.find({
          where: {
            tenantId,
            assigneeUserId: In(developerIds),
            ...(projectId ? { projectId } : {}),
            status: Not('Junk'),
          },
        })
      : [];

    const tasksByDeveloper = new Map<number, ProjectTask[]>();
    for (const task of tasks) {
      const list = tasksByDeveloper.get(task.assigneeUserId) ?? [];
      list.push(task);
      tasksByDeveloper.set(task.assigneeUserId, list);
    }

    const taskIds = tasks.map((t) => t.id);
    const reviews = taskIds.length ? await this.qaReviewsRepository.find({ where: { tenantId, taskId: In(taskIds) } }) : [];
    const reviewsByTaskId = new Map<number, TaskQaReview[]>();
    for (const review of reviews) {
      const list = reviewsByTaskId.get(review.taskId) ?? [];
      list.push(review);
      reviewsByTaskId.set(review.taskId, list);
    }

    const developerRows: DeveloperNonComplianceRow[] = developers.map((dev) => {
      const devTasks = tasksByDeveloper.get(dev.id) ?? [];

      // --- Dimension 1: Late to QA (2026-10-27, replaces "Missed SLA") ---
      // Did the developer hand the work over for review by the effective
      // Due date (dueDate + working days waiting for the PM)? Judged on the
      // FINAL submission, so a rejection fixed after the Due date is late
      // (rework is the developer's time), but time waiting on QA, a peer
      // or the PM never counts. One entry per task at most. Still-open
      // work is judged as of today; a task waiting for a reviewer or done
      // is judged on its final submission.
      const lateToQaItems: LateToQaItem[] = [];
      const overdueInReviewItems: OverdueInReviewItem[] = [];
      for (const task of devTasks) {
        const rounds = (reviewsByTaskId.get(task.id) ?? []).filter((r) => r.reviewType !== 'pm' && r.status !== 'withdrawn');
        const finalSubmit = rounds.reduce<Date | null>((latest, r) => (!latest || r.submittedAt > latest ? r.submittedAt : latest), null);
        const finalSubmitDate = finalSubmit ? toDateOnly(finalSubmit) : null;

        // Information only: waiting for QA / a peer past the QA Review Due
        // Date - the reviewers' deadline, not the developer's.
        if (task.qaReviewDueDate && task.qaReviewDueDate < today && QA_REVIEW_PENDING_STATUSES.includes(task.status) && inRange(task.qaReviewDueDate, from, to)) {
          overdueInReviewItems.push({
            taskId: task.id,
            title: task.title,
            status: task.status,
            submittedAt: finalSubmitDate,
            qaReviewDueDate: task.qaReviewDueDate,
            daysOverdue: daysBetween(task.qaReviewDueDate, today),
          });
        }

        const dueBy = effectiveDueDate(task);
        if (!dueBy || LATE_TO_QA_EXCLUDED_STATUSES.includes(task.status)) continue;
        // With the PM or QA right now (not the developer's turn) - judged
        // on the submission that put it there.
        const handedOver =
          QA_REVIEW_PENDING_STATUSES.includes(task.status) ||
          TERMINAL_TASK_STATUSES.includes(task.status) ||
          task.status === PM_REVIEW_STATUS ||
          task.status === RETURNED_TO_QA_STATUS;
        const base = { taskId: task.id, title: task.title, dueDate: task.dueDate, effectiveDueDate: dueBy, submittedAt: finalSubmitDate };
        if (handedOver) {
          // A finished task with no review round (closed out directly) is
          // judged on when it was completed.
          const handedOverOn = finalSubmitDate ?? (task.completedAt ? toDateOnly(task.completedAt) : null);
          if (handedOverOn && handedOverOn > dueBy && inRange(handedOverOn, from, to)) {
            lateToQaItems.push({ ...base, reason: 'submitted_late', daysLate: daysBetween(dueBy, handedOverOn) });
          }
        } else if (isPastEffectiveDue(task, today) && inRange(dueBy, from, to)) {
          lateToQaItems.push({ ...base, reason: 'still_with_developer', daysLate: daysBetween(dueBy, today) });
        }
      }

      // --- Dimension 2: QA/Peer Review rejection rate ---
      // QA and Peer Review rounds are deliberately combined - they share
      // the same table/roundNumber sequence "on purpose" per
      // TaskQaReview's own comment, so a peer rejection counts exactly
      // like a QA one here too.
      // A reverted round (TaskQaReviewsService.revertDecision()) is the
      // same submission as the pending round that replaced it - leave it
      // out so it isn't a second submission or a rejection.
      // PM review rounds (the gate before QA) aren't QA/Peer submissions or
      // rejections either - the QA round the PM opens is the submission.
      // Nor is a round a PM pulled back from QA before QA decided it
      // ('withdrawn') - it counts nowhere, as agreed with the user.
      const devReviews = devTasks
        .flatMap((t) => reviewsByTaskId.get(t.id) ?? [])
        .filter((r) => !NON_VERDICT_ROUND_STATUSES.includes(r.status) && r.reviewType !== 'pm');
      const submissionsInRange = devReviews.filter((r) => inRange(toDateOnly(r.submittedAt), from, to));
      const rejectionsInRange = submissionsInRange.filter((r) => r.status === 'rejected');
      const submissions = submissionsInRange.length;
      const rejections = rejectionsInRange.length;
      const rate = submissions > 0 ? round2((rejections / submissions) * 100) : 0;

      // --- Dimension 3: escalations ---
      // Only ever a Program Manager tier in this codebase today - no
      // Executive escalation path exists (TaskQaReviewsService.escalate()
      // -> PM Escalation queue only), so this counts "escalated to PM"
      // specifically, not a broader concept.
      const taskById = new Map(devTasks.map((t) => [t.id, t]));
      const escalationItems: EscalationItem[] = devReviews
        .filter((r) => r.status === 'escalated' && inRange(r.reviewedAt ? toDateOnly(r.reviewedAt) : null, from, to))
        .map((r) => ({
          taskId: r.taskId,
          title: taskById.get(r.taskId)?.title ?? `Task #${r.taskId}`,
          escalatedAt: r.reviewedAt ? toDateOnly(r.reviewedAt) : null,
          comment: r.qaComment ?? null,
        }));

      // --- Dimension 4: vague/poor resolution notes (pilot, flag-only) ---
      // Reuses submissionsInRange (dimension 2's own in-range QA/Peer
      // Review rounds) rather than a separate query - this dimension asks
      // "how many of this developer's submissions in this window got a
      // vague verdict", the same population dimension 2 asks "how many
      // got rejected" about.
      const checkedInRange = submissionsInRange.filter((r) => r.noteQualityFlagged !== null);
      const vagueNoteItems: VagueNoteItem[] = submissionsInRange
        .filter((r) => r.noteQualityFlagged === true)
        .map((r) => ({
          taskId: r.taskId,
          title: taskById.get(r.taskId)?.title ?? `Task #${r.taskId}`,
          resolutionExcerpt: excerptText(r.resolution),
          reason: r.noteQualityReason ?? null,
          submittedAt: r.submittedAt ? toDateOnly(r.submittedAt) : null,
        }));

      const lateToQaFlagged = lateToQaItems.length >= thresholds.lateToQaCount;
      const rejectionRateFlagged = submissions >= thresholds.rejectionRateMinSubmissions && rate > thresholds.rejectionRatePercent;
      const escalationsFlagged = escalationItems.length >= thresholds.escalationCount;
      const resolutionQualityFlagged = vagueNoteItems.length >= thresholds.vagueNotesCount;

      return {
        userId: dev.id,
        email: dev.email,
        fullName: dev.fullName ?? null,
        role: dev.role,
        flagged: lateToQaFlagged || rejectionRateFlagged || escalationsFlagged || resolutionQualityFlagged,
        lateToQa: {
          count: lateToQaItems.length,
          flagged: lateToQaFlagged,
          items: lateToQaItems,
        },
        overdueInReview: {
          count: overdueInReviewItems.length,
          items: overdueInReviewItems,
        },
        rejectionRate: {
          submissions,
          rejections,
          rate,
          flagged: rejectionRateFlagged,
        },
        escalations: {
          count: escalationItems.length,
          flagged: escalationsFlagged,
          items: escalationItems,
        },
        resolutionQuality: {
          checked: checkedInRange.length,
          count: vagueNoteItems.length,
          flagged: resolutionQualityFlagged,
          items: vagueNoteItems,
        },
      };
    });

    const flaggedRows = developerRows.filter((d) => d.flagged);
    const lateToQaTotal = flaggedRows.reduce((sum, d) => sum + d.lateToQa.count, 0);
    const rejectionsTotal = flaggedRows.reduce((sum, d) => sum + d.rejectionRate.rejections, 0);
    const submissionsTotal = flaggedRows.reduce((sum, d) => sum + d.rejectionRate.submissions, 0);
    const escalationsTotal = flaggedRows.reduce((sum, d) => sum + d.escalations.count, 0);
    const vagueNotesTotal = flaggedRows.reduce((sum, d) => sum + d.resolutionQuality.count, 0);
    const summary: NonComplianceReportSummary = {
      totalDevelopers: developerRows.length,
      flaggedCount: flaggedRows.length,
      flaggedNames: flaggedRows.map((d) => d.fullName || d.email),
      lateToQaTotal,
      rejectionsTotal,
      submissionsTotal,
      blendedRejectionRate: submissionsTotal > 0 ? round2((rejectionsTotal / submissionsTotal) * 100) : 0,
      escalationsTotal,
      vagueNotesTotal,
    };

    return {
      range: { from: from ?? null, to: to ?? null },
      projectId: projectId ?? null,
      summary,
      developers: developerRows,
      thresholds,
      deferredDimensions: [],
    };
  }
}
