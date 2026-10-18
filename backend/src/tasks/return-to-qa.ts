// Return to QA (2026-10-18, confirmed with the user): a Program Manager
// sends a ticket that is with the developer back to a QA - for a defect,
// the QA who raised it (e.g. it was filed with the wrong evidence); for a
// task, the QA who last reviewed it, or one the PM picks. The ticket sits
// in 'Returned to QA' until that QA sends it back to Development with an
// optional note. While it is there the developer cannot submit it, and
// the days it waits do not count against the developer: they are added
// to pmWaitWorkingDays, the same allowance PM review time uses.
//
// Who it was returned to, by whom and why live in the audit entry
// (TASK_RETURNED_TO_QA) - no new column - and the latest one for the
// ticket is the current return.
export const RETURNED_TO_QA_STATUS = 'Returned to QA';

// Developer-side statuses a PM can return a ticket from.
export const RETURN_TO_QA_FROM_STATUSES = ['Development', 'Failed', 'PM Feedback'];

export const RETURN_TO_QA_REASON_MIN = 10;
export const RETURN_TO_QA_TEXT_MAX = 1000;

// Audit actions, kept with the feature.
export const RETURN_TO_QA_AUDIT = {
  RETURNED: 'task_returned_to_qa',
  SENT_BACK: 'task_return_to_qa_sent_back',
  EVIDENCE_ADDED: 'task_defect_evidence_added',
  EVIDENCE_REMOVED: 'task_defect_evidence_removed',
  SCREENSHOT_REMOVED: 'task_defect_screenshot_removed',
} as const;

export interface TaskReturnedToQaEvent {
  tenantId: number;
  taskId: number;
  title: string;
  qaUserId: number;
  assigneeUserId: number | null;
  actorUserId: number;
  actorEmail: string;
  reason: string;
}

export interface TaskReturnToQaSentBackEvent {
  tenantId: number;
  taskId: number;
  title: string;
  assigneeUserId: number | null;
  pmUserId: number;
  actorUserId: number;
  actorEmail: string;
  note: string | null;
}
