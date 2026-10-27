// QA "Not ready for testing" (2026-10-27, confirmed with the user): one of
// the two kinds of QA Reject. "Test failed" is the normal rejection
// (TaskQaReviewsService.reject(), round 'rejected', task 'Failed').
// "Not ready" means QA could not start testing - the build isn't deployed,
// test steps or evidence are missing, and so on. QA picks a reason from an
// editable list (team_settings.qaNotReadyReasons) and writes a comment.
//
// The round is closed as 'not_ready' (TaskQaReview.notReadyReason holds the
// reason, qaComment the comment) and the task goes to 'Not Ready for
// Testing' until the developer resubmits. It is not a QA decision: it never
// counts as a rejection (KPI, rejection rate, QA acceptance rate), the QA
// review due date is cleared, and the resubmission is a first-time
// Feedback unless an earlier QA verdict still stands. It is counted
// separately as an "incomplete submission" on the Non-compliance report,
// per developer, and per QA for information. The developer's own due date
// keeps running - the not-ready submission is not a hand-over.
export const NOT_READY_STATUS = 'Not Ready for Testing';

// The day this went live. Earlier QA returns were all recorded as
// rejections and are not reclassified - the Non-compliance report prints
// "Not ready counts start on <this date>". Set on deploy day.
export const NOT_READY_SINCE = '2026-10-27';

export const DEFAULT_QA_NOT_READY_REASONS = [
  'Build not deployed',
  'Test steps missing',
  'Evidence missing',
  'Environment not available',
  'Blocked by a dependency',
  'Description unclear',
  // Defect triage Stage 2 (2026-10-27): the developer's submission
  // checklist was filled in but not usable.
  'Submission incomplete',
];

export const QA_NOT_READY_REASON_MAX = 100;
export const QA_NOT_READY_REASONS_MAX_COUNT = 30;
// The comment is required and must say something - a lone "." is not a comment.
export const QA_NOT_READY_COMMENT_MIN = 10;
