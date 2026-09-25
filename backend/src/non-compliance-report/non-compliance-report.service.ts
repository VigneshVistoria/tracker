import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { UsersService } from '../users/users.service';
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';

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

// Fixed thresholds (confirmed with the user) rather than an admin-
// configurable setting, same choice made for
// TasksService.QA_REVIEW_DUE_DATE_BUSINESS_DAYS - simplest to build, easy
// to change in code later if these numbers turn out wrong.
const MISSED_SLA_FLAG_THRESHOLD = 3;
const REJECTION_RATE_FLAG_PERCENT = 20;
// Below this many submissions in the period, a rejection rate is noise
// (e.g. 1 rejection out of 1 submission = 100%) - not enough signal to
// flag someone off of.
const REJECTION_RATE_MIN_SUBMISSIONS = 3;
// Unlike the other two dimensions, a single escalation is already a
// notable event worth surfacing - no grace count.
const ESCALATION_FLAG_THRESHOLD = 1;
// Pilot threshold for dimension 4 (Vague/Poor Resolution Notes) - same
// "fixed for now, easy to change in code later" reasoning as the other
// three. This dimension is flag-only (NoteQualityService never blocks a
// submission), so this threshold only affects whether a developer shows
// up in the Flagged Developers table, not whether their work is accepted.
const VAGUE_NOTES_FLAG_THRESHOLD = 3;

export type MissedSlaReason = 'resolved_late' | 'open_past_due' | 'review_overdue';

export interface MissedSlaItem {
  taskId: number;
  title: string;
  reason: MissedSlaReason;
  dueDate: string | null;
  qaReviewDueDate: string | null;
  completedAt: string | null;
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
  missedSla: { count: number; flagged: boolean; items: MissedSlaItem[] };
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
  missedSlaTotal: number;
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
    missedSlaCount: number;
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

      // --- Dimension 1: missed SLA / due dates ---
      // Three independent sub-cases, all in scope at once - a task can
      // legitimately appear under more than one reason (e.g. still
      // pending review past both its own Due Date and its QA Review Due
      // Date), which is two distinct problems, not a duplicate.
      const missedSlaItems: MissedSlaItem[] = [];
      for (const task of devTasks) {
        if (task.completedAt && task.dueDate) {
          const completedDate = toDateOnly(task.completedAt);
          if (completedDate > task.dueDate && inRange(completedDate, from, to)) {
            missedSlaItems.push({
              taskId: task.id,
              title: task.title,
              reason: 'resolved_late',
              dueDate: task.dueDate,
              qaReviewDueDate: task.qaReviewDueDate,
              completedAt: completedDate,
            });
          }
        }
        if (
          task.dueDate &&
          task.dueDate < today &&
          !TERMINAL_TASK_STATUSES.includes(task.status) &&
          inRange(task.dueDate, from, to)
        ) {
          missedSlaItems.push({
            taskId: task.id,
            title: task.title,
            reason: 'open_past_due',
            dueDate: task.dueDate,
            qaReviewDueDate: task.qaReviewDueDate,
            completedAt: null,
          });
        }
        if (
          task.qaReviewDueDate &&
          task.qaReviewDueDate < today &&
          QA_REVIEW_PENDING_STATUSES.includes(task.status) &&
          inRange(task.qaReviewDueDate, from, to)
        ) {
          missedSlaItems.push({
            taskId: task.id,
            title: task.title,
            reason: 'review_overdue',
            dueDate: task.dueDate,
            qaReviewDueDate: task.qaReviewDueDate,
            completedAt: null,
          });
        }
      }

      // --- Dimension 2: QA/Peer Review rejection rate ---
      // QA and Peer Review rounds are deliberately combined - they share
      // the same table/roundNumber sequence "on purpose" per
      // TaskQaReview's own comment, so a peer rejection counts exactly
      // like a QA one here too.
      const devReviews = devTasks.flatMap((t) => reviewsByTaskId.get(t.id) ?? []);
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

      const missedSlaFlagged = missedSlaItems.length >= MISSED_SLA_FLAG_THRESHOLD;
      const rejectionRateFlagged = submissions >= REJECTION_RATE_MIN_SUBMISSIONS && rate > REJECTION_RATE_FLAG_PERCENT;
      const escalationsFlagged = escalationItems.length >= ESCALATION_FLAG_THRESHOLD;
      const resolutionQualityFlagged = vagueNoteItems.length >= VAGUE_NOTES_FLAG_THRESHOLD;

      return {
        userId: dev.id,
        email: dev.email,
        fullName: dev.fullName ?? null,
        role: dev.role,
        flagged: missedSlaFlagged || rejectionRateFlagged || escalationsFlagged || resolutionQualityFlagged,
        missedSla: {
          count: missedSlaItems.length,
          flagged: missedSlaFlagged,
          items: missedSlaItems,
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
    const missedSlaTotal = flaggedRows.reduce((sum, d) => sum + d.missedSla.count, 0);
    const rejectionsTotal = flaggedRows.reduce((sum, d) => sum + d.rejectionRate.rejections, 0);
    const submissionsTotal = flaggedRows.reduce((sum, d) => sum + d.rejectionRate.submissions, 0);
    const escalationsTotal = flaggedRows.reduce((sum, d) => sum + d.escalations.count, 0);
    const vagueNotesTotal = flaggedRows.reduce((sum, d) => sum + d.resolutionQuality.count, 0);
    const summary: NonComplianceReportSummary = {
      totalDevelopers: developerRows.length,
      flaggedCount: flaggedRows.length,
      flaggedNames: flaggedRows.map((d) => d.fullName || d.email),
      missedSlaTotal,
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
      thresholds: {
        missedSlaCount: MISSED_SLA_FLAG_THRESHOLD,
        rejectionRatePercent: REJECTION_RATE_FLAG_PERCENT,
        rejectionRateMinSubmissions: REJECTION_RATE_MIN_SUBMISSIONS,
        escalationCount: ESCALATION_FLAG_THRESHOLD,
        vagueNotesCount: VAGUE_NOTES_FLAG_THRESHOLD,
      },
      deferredDimensions: [],
    };
  }
}
